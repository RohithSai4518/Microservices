/**
 * Enterprise Microservices - Inventory & Warehouse Service
 * Port: 8006
 * Manages real-time SKU stock levels, warehouse allocations, reservation TTLs, and compensation releases.
 */

const { HttpServer } = require('../../shared/http');
const { DocumentStore } = require('../../shared/storage');
const { EventBusClient } = require('../../shared/event-bus');
const { ServiceRegistryClient } = require('../../shared/service-registry');
const { Logger } = require('../../shared/logger');
const { ValidationError, NotFoundError, ConflictError } = require('../../shared/errors');

const PORT = process.env.INVENTORY_SERVICE_PORT || 8006;
const logger = new Logger('inventory-service');
const server = new HttpServer({ logger });

const inventoryStore = new DocumentStore('inventory_items');
const reservationsStore = new DocumentStore('stock_reservations');
const eventBus = new EventBusClient('inventory-service');
const registry = new ServiceRegistryClient({
  serviceName: 'inventory-service',
  port: PORT,
  metadata: { version: '1.0.0', type: 'warehouse-core' }
});

// Health check
server.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    service: 'inventory-service',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// Get all inventory items
server.get('/', async (req, res) => {
  const items = await inventoryStore.find({});
  res.json({ total: items.length, items });
});

// Get stock for specific SKU
server.get('/:sku', async (req, res) => {
  const sku = req.params.sku.toUpperCase();
  const item = await inventoryStore.findOne({ sku });
  if (!item) {
    throw new NotFoundError('Inventory Item for SKU', sku);
  }
  res.json(item);
});

// Reserve stock for an order (Saga Step 1)
server.post('/reserve', async (req, res) => {
  const { orderId, items } = req.body;

  if (!orderId || !Array.isArray(items) || items.length === 0) {
    throw new ValidationError('orderId and non-empty items array are required');
  }

  // Check if reservation already exists
  const existingRes = await reservationsStore.findOne({ orderId });
  if (existingRes && existingRes.status === 'RESERVED') {
    return res.json({ success: true, message: 'Stock already reserved', reservationId: existingRes.id });
  }

  // Pre-check stock availability for all items
  for (const itm of items) {
    const sku = itm.sku.toUpperCase();
    const qty = parseInt(itm.quantity, 10) || 1;
    let invItem = await inventoryStore.findOne({ sku });

    if (!invItem) {
      // Auto-initialize inventory if product exists
      invItem = await inventoryStore.insert({
        sku,
        availableStock: 50,
        reservedStock: 0,
        totalStock: 50,
        warehouse: 'MAIN-WAREHOUSE-1'
      });
    }

    if (invItem.availableStock < qty) {
      await eventBus.publish('inventory.reservation_failed', {
        orderId,
        sku,
        requestedQuantity: qty,
        availableQuantity: invItem.availableStock
      }, { traceId: res.traceId });

      throw new ConflictError(`Insufficient stock for SKU '${sku}'. Requested: ${qty}, Available: ${invItem.availableStock}`);
    }
  }

  // Execute atomic reservations
  for (const itm of items) {
    const sku = itm.sku.toUpperCase();
    const qty = parseInt(itm.quantity, 10) || 1;
    const invItem = await inventoryStore.findOne({ sku });

    await inventoryStore.updateById(invItem.id, {
      availableStock: invItem.availableStock - qty,
      reservedStock: (invItem.reservedStock || 0) + qty
    });
  }

  const reservation = await reservationsStore.insert({
    orderId,
    items,
    status: 'RESERVED',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 min TTL
  });

  logger.info(`Stock reserved for order ${orderId}`, { reservationId: reservation.id });

  await eventBus.publish('inventory.reserved', {
    orderId,
    reservationId: reservation.id,
    items
  }, { traceId: res.traceId });

  res.status(200).json({
    success: true,
    reservationId: reservation.id,
    orderId,
    status: 'RESERVED'
  });
});

// Commit reserved stock (Saga Final Step)
server.post('/commit', async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) throw new ValidationError('orderId is required');

  const reservation = await reservationsStore.findOne({ orderId });
  if (!reservation) {
    throw new NotFoundError('Reservation for order', orderId);
  }

  if (reservation.status === 'COMMITTED') {
    return res.json({ success: true, message: 'Reservation already committed' });
  }

  for (const itm of reservation.items) {
    const sku = itm.sku.toUpperCase();
    const qty = parseInt(itm.quantity, 10) || 1;
    const invItem = await inventoryStore.findOne({ sku });
    if (invItem) {
      await inventoryStore.updateById(invItem.id, {
        reservedStock: Math.max(0, (invItem.reservedStock || 0) - qty),
        totalStock: Math.max(0, (invItem.totalStock || 0) - qty)
      });
    }
  }

  await reservationsStore.updateById(reservation.id, { status: 'COMMITTED' });
  logger.info(`Stock committed for order ${orderId}`);
  res.json({ success: true, status: 'COMMITTED' });
});

// Release reserved stock (Saga Compensation Flow)
server.post('/release', async (req, res) => {
  const { orderId, reason } = req.body;
  if (!orderId) throw new ValidationError('orderId is required');

  const reservation = await reservationsStore.findOne({ orderId });
  if (!reservation || reservation.status === 'RELEASED') {
    return res.json({ success: true, message: 'No active reservation to release' });
  }

  for (const itm of reservation.items) {
    const sku = itm.sku.toUpperCase();
    const qty = parseInt(itm.quantity, 10) || 1;
    const invItem = await inventoryStore.findOne({ sku });
    if (invItem) {
      await inventoryStore.updateById(invItem.id, {
        availableStock: invItem.availableStock + qty,
        reservedStock: Math.max(0, (invItem.reservedStock || 0) - qty)
      });
    }
  }

  await reservationsStore.updateById(reservation.id, {
    status: 'RELEASED',
    releaseReason: reason || 'Order cancellation / Saga compensation'
  });

  logger.info(`Stock released for order ${orderId}. Reason: ${reason}`);

  await eventBus.publish('inventory.released', {
    orderId,
    reason: reason || 'Compensation'
  }, { traceId: res.traceId });

  res.json({ success: true, status: 'RELEASED' });
});

// Restock inventory
server.post('/restock', async (req, res) => {
  const { sku, quantity, warehouse } = req.body;
  if (!sku || !quantity) throw new ValidationError('sku and quantity are required');

  const normalizedSku = sku.toUpperCase().trim();
  const qty = parseInt(quantity, 10);

  let item = await inventoryStore.findOne({ sku: normalizedSku });
  if (!item) {
    item = await inventoryStore.insert({
      sku: normalizedSku,
      availableStock: qty,
      reservedStock: 0,
      totalStock: qty,
      warehouse: warehouse || 'MAIN-WAREHOUSE-1'
    });
  } else {
    item = await inventoryStore.updateById(item.id, {
      availableStock: item.availableStock + qty,
      totalStock: item.totalStock + qty
    });
  }

  await eventBus.publish('inventory.restocked', {
    sku: normalizedSku,
    addedQuantity: qty,
    newAvailable: item.availableStock
  }, { traceId: res.traceId });

  res.json({ success: true, item });
});

server.listen(PORT, () => {
  logger.info(`Inventory & Warehouse Service running on port ${PORT}`);
  registry.register().catch(() => {});
});

module.exports = { server };

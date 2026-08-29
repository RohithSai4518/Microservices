/**
 * Enterprise Microservices - Order & Saga Orchestration Service
 * Port: 8004
 * Manages distributed order lifecycles and coordinates compensating Saga transactions across inventory and payments.
 */

const http = require('http');
const url = require('url');
const { HttpServer } = require('../../shared/http');
const { DocumentStore } = require('../../shared/storage');
const { EventBusClient } = require('../../shared/event-bus');
const { ServiceRegistryClient } = require('../../shared/service-registry');
const { Logger } = require('../../shared/logger');
const { ValidationError, NotFoundError, SagaFailedError } = require('../../shared/errors');

const PORT = process.env.ORDER_SERVICE_PORT || 8004;
const logger = new Logger('order-service');
const server = new HttpServer({ logger });

const ordersStore = new DocumentStore('orders');
const sagaStore = new DocumentStore('saga_transactions');
const eventBus = new EventBusClient('order-service');
const registry = new ServiceRegistryClient({
  serviceName: 'order-service',
  port: PORT,
  metadata: { version: '1.0.0', type: 'orchestrator-core' }
});

// Helper for HTTP inter-service RPC calls
async function callService(serviceName, fallbackPort, endpoint, method, body, traceId) {
  let host = 'localhost';
  let port = fallbackPort;

  try {
    const instance = await registry.discover(serviceName);
    if (instance) {
      host = instance.host;
      port = instance.port;
    }
  } catch (e) {}

  const postData = body ? JSON.stringify(body) : '';
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: host,
      port,
      path: endpoint,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'X-Trace-Id': traceId || `tr_${Date.now()}`
      },
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, data: parsed });
        } catch {
          resolve({ status: res.statusCode, ok: false, data });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout contacting service ${serviceName}`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (postData) req.write(postData);
    req.end();
  });
}

// Health check
server.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    service: 'order-service',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// List orders
server.get('/', async (req, res) => {
  const userId = req.query.userId;
  const limit = parseInt(req.query.limit, 10) || 50;
  let filter = {};
  if (userId) filter.userId = userId;

  const orders = await ordersStore.find(filter, { limit, sort: { createdAt: -1 } });
  res.json({ total: orders.length, orders });
});

// Get order details + saga execution history
server.get('/:id', async (req, res) => {
  const { id } = req.params;
  const order = await ordersStore.findById(id);
  if (!order) {
    throw new NotFoundError('Order', id);
  }

  const sagaLogs = await sagaStore.find({ orderId: id });
  res.json({ order, saga: sagaLogs });
});

// Distributed Saga Checkout Orchestrator
server.post('/checkout', async (req, res) => {
  const { userId, items, shippingAddress, paymentMethod } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new ValidationError('Checkout requires at least one product item');
  }

  // Calculate order total
  let totalAmount = 0;
  const sanitizedItems = items.map(itm => {
    const qty = parseInt(itm.quantity, 10) || 1;
    const price = parseFloat(itm.price) || 0;
    const subtotal = qty * price;
    totalAmount += subtotal;
    return {
      productId: itm.productId || itm.id,
      sku: itm.sku ? itm.sku.toUpperCase() : 'SKU-ITEM',
      name: itm.name || 'Product',
      price,
      quantity: qty,
      subtotal
    };
  });

  // Create initial order record
  const order = await ordersStore.insert({
    userId: userId || 'anonymous',
    items: sanitizedItems,
    totalAmount: Math.round(totalAmount * 100) / 100,
    currency: 'USD',
    shippingAddress: shippingAddress || { city: 'New York', country: 'USA' },
    status: 'PENDING_SAGA',
    history: [{ status: 'PENDING_SAGA', timestamp: new Date().toISOString(), note: 'Checkout initiated' }]
  });

  const sagaId = `saga_${order.id}`;
  logger.info(`Starting Distributed Saga Orchestration [${sagaId}] for order ${order.id} ($${order.totalAmount})`);

  await sagaStore.insert({
    id: sagaId,
    orderId: order.id,
    status: 'STARTED',
    steps: []
  });

  const recordStep = async (stepName, status, details = {}) => {
    const saga = await sagaStore.findById(sagaId);
    if (saga) {
      const steps = saga.steps || [];
      steps.push({ stepName, status, timestamp: new Date().toISOString(), details });
      await sagaStore.updateById(sagaId, { steps, status: status === 'FAILED' ? 'FAILED' : 'IN_PROGRESS' });
    }
  };

  try {
    // --- STEP 1: Reserve Inventory ---
    logger.info(`[Saga ${sagaId}] Step 1: Reserving inventory...`);
    const invRes = await callService('inventory-service', 8006, '/reserve', 'POST', {
      orderId: order.id,
      items: sanitizedItems
    }, res.traceId);

    if (!invRes.ok) {
      await recordStep('INVENTORY_RESERVATION', 'FAILED', invRes.data);
      await ordersStore.updateById(order.id, {
        status: 'FAILED_OUT_OF_STOCK',
        failureReason: invRes.data.error ? invRes.data.error.message : 'Inventory reservation failed'
      });
      throw new SagaFailedError('CheckoutSaga', 'ReserveInventory', invRes.data.error ? invRes.data.error.message : 'Insufficient stock');
    }

    await recordStep('INVENTORY_RESERVATION', 'SUCCESS', invRes.data);
    await ordersStore.updateById(order.id, { status: 'INVENTORY_RESERVED' });

    // --- STEP 2: Process Payment ---
    logger.info(`[Saga ${sagaId}] Step 2: Processing payment of $${order.totalAmount}...`);
    let payRes;
    try {
      payRes = await callService('payment-service', 8005, '/charge', 'POST', {
        orderId: order.id,
        userId: order.userId,
        amount: order.totalAmount,
        currency: order.currency,
        paymentMethod: paymentMethod || { type: 'CREDIT_CARD', last4: '4242' },
        idempotencyKey: `idemp_${order.id}`
      }, res.traceId);
    } catch (payErr) {
      payRes = { ok: false, data: { error: { message: payErr.message } } };
    }

    if (!payRes.ok) {
      // --- COMPENSATION TRIGGER: Release Reserved Inventory ---
      logger.warn(`[Saga ${sagaId}] Payment failed! Initiating compensation: releasing inventory...`);
      await recordStep('PAYMENT_CHARGE', 'FAILED', payRes.data);

      await callService('inventory-service', 8006, '/release', 'POST', {
        orderId: order.id,
        reason: 'Payment charge declined'
      }, res.traceId);

      await recordStep('COMPENSATION_INVENTORY_RELEASE', 'SUCCESS', { reason: 'Payment failed' });

      await ordersStore.updateById(order.id, {
        status: 'PAYMENT_FAILED',
        failureReason: payRes.data.error ? payRes.data.error.message : 'Payment declined'
      });

      await sagaStore.updateById(sagaId, { status: 'COMPENSATED' });

      await eventBus.publish('order.saga.compensated', {
        orderId: order.id,
        sagaId,
        reason: 'Payment failed, inventory released'
      }, { traceId: res.traceId });

      throw new SagaFailedError('CheckoutSaga', 'ProcessPayment', payRes.data.error ? payRes.data.error.message : 'Card declined');
    }

    await recordStep('PAYMENT_CHARGE', 'SUCCESS', payRes.data);

    // --- STEP 3: Commit Inventory ---
    logger.info(`[Saga ${sagaId}] Step 3: Committing stock allocation...`);
    await callService('inventory-service', 8006, '/commit', 'POST', { orderId: order.id }, res.traceId);
    await recordStep('INVENTORY_COMMIT', 'SUCCESS');

    // --- STEP 4: Confirm Order ---
    const confirmedOrder = await ordersStore.updateById(order.id, {
      status: 'CONFIRMED',
      transactionId: payRes.data && payRes.data.data ? payRes.data.data.id : null,
      confirmedAt: new Date().toISOString()
    });

    await sagaStore.updateById(sagaId, { status: 'COMPLETED' });

    // Publish Saga Completed event
    await eventBus.publish('order.saga.completed', {
      orderId: order.id,
      userId: order.userId,
      totalAmount: order.totalAmount,
      itemsCount: sanitizedItems.length,
      items: sanitizedItems
    }, { traceId: res.traceId });

    logger.info(`[Saga ${sagaId}] Completed successfully! Order ${order.id} is CONFIRMED.`);

    res.status(201).json({
      success: true,
      message: 'Order placed and verified via Distributed Saga',
      order: confirmedOrder,
      sagaId
    });

  } catch (err) {
    if (err instanceof SagaFailedError) {
      return res.status(422).json({
        success: false,
        error: {
          code: err.errorCode,
          message: err.message,
          details: err.details
        },
        orderId: order.id
      });
    }
    throw err;
  }
});

// Cancel Order with compensation
server.post('/:id/cancel', async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const order = await ordersStore.findById(id);
  if (!order) {
    throw new NotFoundError('Order', id);
  }

  if (['CANCELLED', 'FAILED_OUT_OF_STOCK'].includes(order.status)) {
    return res.json({ success: true, message: 'Order is already cancelled/failed', order });
  }

  logger.info(`Cancelling order ${id} and rolling back inventory & payments...`);

  // Step 1: Release stock
  await callService('inventory-service', 8006, '/release', 'POST', {
    orderId: id,
    reason: reason || 'Customer cancellation'
  }, res.traceId);

  // Step 2: Refund payment if order was confirmed/paid
  if (order.status === 'CONFIRMED' || order.status === 'INVENTORY_RESERVED') {
    await callService('payment-service', 8005, '/refund', 'POST', {
      orderId: id,
      reason: reason || 'Order cancellation refund'
    }, res.traceId);
  }

  const updatedOrder = await ordersStore.updateById(id, {
    status: 'CANCELLED',
    cancelledAt: new Date().toISOString(),
    cancellationReason: reason || 'User requested cancellation'
  });

  await eventBus.publish('order.cancelled', {
    orderId: id,
    userId: order.userId,
    refundAmount: order.totalAmount,
    reason: reason || 'User requested cancellation'
  }, { traceId: res.traceId });

  res.json({
    success: true,
    message: 'Order cancelled, inventory released, and refund issued',
    order: updatedOrder
  });
});

server.listen(PORT, () => {
  logger.info(`Order & Saga Orchestration Service running on port ${PORT}`);
  registry.register().catch(() => {});
});

module.exports = { server };

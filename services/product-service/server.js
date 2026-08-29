/**
 * Enterprise Microservices - Product & Catalog Service
 * Port: 8003
 * Manages product taxonomy, catalog search, SKU indexing, and dynamic price calculations.
 */

const { HttpServer } = require('../../shared/http');
const { DocumentStore } = require('../../shared/storage');
const { EventBusClient } = require('../../shared/event-bus');
const { ServiceRegistryClient } = require('../../shared/service-registry');
const { Logger } = require('../../shared/logger');
const { ValidationError, NotFoundError } = require('../../shared/errors');

const PORT = process.env.PRODUCT_SERVICE_PORT || 8003;
const logger = new Logger('product-service');
const server = new HttpServer({ logger });

const productsStore = new DocumentStore('products');
const categoriesStore = new DocumentStore('categories');
const eventBus = new EventBusClient('product-service');
const registry = new ServiceRegistryClient({
  serviceName: 'product-service',
  port: PORT,
  metadata: { version: '1.0.0', type: 'catalog-core' }
});

// Health check
server.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    service: 'product-service',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// List products with filtering, search, and pagination
server.get('/', async (req, res) => {
  const category = req.query.category;
  const search = (req.query.search || req.query.q || '').toLowerCase();
  const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice) : null;
  const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice) : null;
  const limit = parseInt(req.query.limit, 10) || 50;
  const skip = parseInt(req.query.skip, 10) || 0;

  let products = await productsStore.find({});

  if (category) {
    products = products.filter(p => p.category && p.category.toLowerCase() === category.toLowerCase());
  }

  if (search) {
    products = products.filter(p =>
      (p.name && p.name.toLowerCase().includes(search)) ||
      (p.description && p.description.toLowerCase().includes(search)) ||
      (p.sku && p.sku.toLowerCase().includes(search)) ||
      (p.tags && p.tags.some(t => t.toLowerCase().includes(search)))
    );
  }

  if (minPrice !== null) {
    products = products.filter(p => p.price >= minPrice);
  }
  if (maxPrice !== null) {
    products = products.filter(p => p.price <= maxPrice);
  }

  const total = products.length;
  const paged = products.slice(skip, skip + limit);

  res.json({
    total,
    count: paged.length,
    skip,
    limit,
    products: paged
  });
});

// Get single product by ID or SKU
server.get('/:id', async (req, res) => {
  const { id } = req.params;
  let product = await productsStore.findById(id);

  if (!product) {
    product = await productsStore.findOne({ sku: id.toUpperCase() });
  }

  if (!product) {
    throw new NotFoundError('Product', id);
  }

  res.json(product);
});

// Create product
server.post('/', async (req, res) => {
  const { name, sku, price, category, description, imageUrl, stock, tags } = req.body;

  if (!name || price === undefined || !sku) {
    throw new ValidationError('Product name, sku, and price are required');
  }

  const normalizedSku = sku.toUpperCase().trim();
  const existing = await productsStore.findOne({ sku: normalizedSku });
  if (existing) {
    throw new ValidationError(`Product SKU '${normalizedSku}' already exists`);
  }

  const product = await productsStore.insert({
    name,
    sku: normalizedSku,
    price: Number(price),
    currency: 'USD',
    category: category || 'General',
    description: description || '',
    imageUrl: imageUrl || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&q=80',
    stock: stock !== undefined ? Number(stock) : 100,
    tags: Array.isArray(tags) ? tags : [],
    status: 'ACTIVE'
  });

  logger.info(`Product created: ${product.name} (SKU: ${product.sku})`);

  await eventBus.publish('product.created', {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    price: product.price,
    initialStock: product.stock
  }, { traceId: res.traceId });

  res.status(201).json(product);
});

// Update product
server.put('/:id', async (req, res) => {
  const { id } = req.params;
  const existing = await productsStore.findById(id);
  if (!existing) {
    throw new NotFoundError('Product', id);
  }

  const oldPrice = existing.price;
  const updated = await productsStore.updateById(id, req.body);

  if (req.body.price !== undefined && req.body.price !== oldPrice) {
    await eventBus.publish('product.price_changed', {
      productId: id,
      sku: existing.sku,
      oldPrice,
      newPrice: Number(req.body.price)
    }, { traceId: res.traceId });
  }

  await eventBus.publish('product.updated', {
    productId: id,
    sku: existing.sku,
    changes: req.body
  }, { traceId: res.traceId });

  res.json(updated);
});

// List categories
server.get('/categories/all', async (req, res) => {
  const categories = await categoriesStore.find({});
  res.json({ total: categories.length, categories });
});

// Add category
server.post('/categories', async (req, res) => {
  const { name, description, slug } = req.body;
  if (!name) throw new ValidationError('Category name is required');

  const cat = await categoriesStore.insert({
    name,
    slug: slug || name.toLowerCase().replace(/\s+/g, '-'),
    description: description || ''
  });

  res.status(201).json(cat);
});

server.listen(PORT, () => {
  logger.info(`Product & Catalog Service running on port ${PORT}`);
  registry.register().catch(() => {});
});

module.exports = { server };

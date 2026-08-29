/**
 * Enterprise Microservices - Telemetry & Analytics Service
 * Port: 8008
 * Real-time event stream ingestion, conversion funnels, financial summaries, and latency metrics.
 */

const { HttpServer } = require('../../shared/http');
const { DocumentStore } = require('../../shared/storage');
const { EventBusClient } = require('../../shared/event-bus');
const { ServiceRegistryClient } = require('../../shared/service-registry');
const { Logger } = require('../../shared/logger');

const PORT = process.env.ANALYTICS_SERVICE_PORT || 8008;
const logger = new Logger('analytics-service');
const server = new HttpServer({ logger });

const metricsStore = new DocumentStore('analytics_metrics');
const eventAuditStore = new DocumentStore('audit_logs');
const eventBus = new EventBusClient('analytics-service');
const registry = new ServiceRegistryClient({
  serviceName: 'analytics-service',
  port: PORT,
  metadata: { version: '1.0.0', type: 'telemetry-core' }
});

// In-memory aggregates for high-speed dashboard telemetry
const aggregates = {
  totalRevenue: 0,
  totalOrders: 0,
  completedOrders: 0,
  failedOrders: 0,
  userSignups: 0,
  productPriceChanges: 0,
  eventCountsByTopic: {},
  revenueByDay: {},
  topProducts: {}
};

// Health check
server.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    service: 'analytics-service',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// Comprehensive Real-time Dashboard Overview
server.get('/metrics/overview', async (req, res) => {
  res.json({
    summary: {
      totalRevenue: Math.round(aggregates.totalRevenue * 100) / 100,
      totalOrders: aggregates.totalOrders,
      completedOrders: aggregates.completedOrders,
      failedOrders: aggregates.failedOrders,
      userSignups: aggregates.userSignups,
      sagaSuccessRate: aggregates.totalOrders > 0 
        ? Math.round((aggregates.completedOrders / aggregates.totalOrders) * 100) 
        : 100
    },
    topProducts: Object.entries(aggregates.topProducts)
      .map(([name, qty]) => ({ name, count: qty }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    eventDistribution: aggregates.eventCountsByTopic,
    systemUptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Real-time Event Stream
server.get('/events/stream', async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const logs = await eventAuditStore.find({}, { limit, sort: { createdAt: -1 } });
  res.json({ total: logs.length, events: logs });
});

// Webhook listener for distributed event ingestion
server.post('/events/webhook', async (req, res) => {
  const event = req.body;
  if (!event || !event.topic) {
    return res.status(400).json({ error: 'Invalid event' });
  }

  // Record audit log
  await eventAuditStore.insert({
    eventId: event.id,
    topic: event.topic,
    sender: event.sender,
    payload: event.payload,
    traceId: event.traceId,
    receivedAt: new Date().toISOString()
  });

  // Track event topic frequency
  aggregates.eventCountsByTopic[event.topic] = (aggregates.eventCountsByTopic[event.topic] || 0) + 1;

  // Process Business Metrics
  if (event.topic === 'auth.user.registered') {
    aggregates.userSignups++;
  } else if (event.topic === 'order.saga.completed') {
    aggregates.totalOrders++;
    aggregates.completedOrders++;
    const amount = Number(event.payload.totalAmount) || 0;
    aggregates.totalRevenue += amount;

    // Track product sales
    if (Array.isArray(event.payload.items)) {
      event.payload.items.forEach(itm => {
        const name = itm.name || itm.sku;
        aggregates.topProducts[name] = (aggregates.topProducts[name] || 0) + (itm.quantity || 1);
      });
    }
  } else if (event.topic === 'order.saga.compensated' || event.topic === 'order.saga.failed') {
    aggregates.totalOrders++;
    aggregates.failedOrders++;
  } else if (event.topic === 'product.price_changed') {
    aggregates.productPriceChanges++;
  }

  res.json({ processed: true });
});

server.listen(PORT, async () => {
  logger.info(`Telemetry & Analytics Service running on port ${PORT}`);
  await registry.register().catch(() => {});

  // Subscribe to wildcard topic on event broker
  await eventBus.registerWebhookSubscription('*', `http://localhost:${PORT}/events/webhook`);
});

module.exports = { server };

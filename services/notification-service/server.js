/**
 * Enterprise Microservices - Notification & Alert Service
 * Port: 8007
 * Multi-channel notification dispatcher with customizable template rendering, queuing, and event listener hooks.
 */

const { HttpServer } = require('../../shared/http');
const { DocumentStore } = require('../../shared/storage');
const { EventBusClient } = require('../../shared/event-bus');
const { ServiceRegistryClient } = require('../../shared/service-registry');
const { Logger } = require('../../shared/logger');
const { ValidationError, NotFoundError } = require('../../shared/errors');

const PORT = process.env.NOTIFICATION_SERVICE_PORT || 8007;
const logger = new Logger('notification-service');
const server = new HttpServer({ logger });

const notificationsStore = new DocumentStore('notifications');
const templatesStore = new DocumentStore('notification_templates');
const eventBus = new EventBusClient('notification-service');
const registry = new ServiceRegistryClient({
  serviceName: 'notification-service',
  port: PORT,
  metadata: { version: '1.0.0', type: 'communication-core' }
});

// Built-in notification template renderer
function renderTemplate(templateStr, data = {}) {
  return templateStr.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => {
    const keys = key.split('.');
    let val = data;
    for (const k of keys) {
      if (val && val[k] !== undefined) {
        val = val[k];
      } else {
        return '';
      }
    }
    return val !== undefined ? String(val) : '';
  });
}

// Seed default templates if empty
async function initTemplates() {
  const count = await templatesStore.count();
  if (count === 0) {
    await templatesStore.insert({
      id: 'tpl_welcome',
      name: 'Welcome Email',
      channel: 'EMAIL',
      subject: 'Welcome to Enterprise Microservices Platform, {{name}}!',
      body: 'Hello {{name}},\n\nThank you for joining our platform. Your account ({{email}}) is now active.'
    });

    await templatesStore.insert({
      id: 'tpl_order_confirmed',
      name: 'Order Confirmation',
      channel: 'EMAIL',
      subject: 'Order Confirmed: #{{orderId}}',
      body: 'Hi {{name}},\n\nYour order #{{orderId}} of ${{totalAmount}} has been confirmed and is being processed.'
    });

    await templatesStore.insert({
      id: 'tpl_order_cancelled',
      name: 'Order Cancellation & Refund',
      channel: 'EMAIL',
      subject: 'Order Cancelled: #{{orderId}}',
      body: 'Your order #{{orderId}} has been cancelled. A refund of ${{refundAmount}} was processed.'
    });
  }
}

// Health check
server.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    service: 'notification-service',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// List notifications
server.get('/', async (req, res) => {
  const userId = req.query.userId;
  const limit = parseInt(req.query.limit, 10) || 50;
  let filter = {};
  if (userId) filter.userId = userId;

  const notifications = await notificationsStore.find(filter, { limit, sort: { createdAt: -1 } });
  res.json({ total: notifications.length, notifications });
});

// Send custom notification
server.post('/send', async (req, res) => {
  const { recipient, channel, subject, message, userId, templateId, templateData } = req.body;

  let finalSubject = subject || 'System Alert';
  let finalMessage = message || '';

  if (templateId) {
    const tpl = await templatesStore.findById(templateId);
    if (tpl) {
      finalSubject = renderTemplate(tpl.subject, templateData || {});
      finalMessage = renderTemplate(tpl.body, templateData || {});
    }
  }

  if (!recipient && !userId) {
    throw new ValidationError('recipient or userId is required');
  }

  const notification = await notificationsStore.insert({
    userId: userId || 'anonymous',
    recipient: recipient || userId,
    channel: channel || 'EMAIL',
    subject: finalSubject,
    message: finalMessage,
    status: 'DELIVERED',
    sentAt: new Date().toISOString()
  });

  logger.info(`Notification dispatched to [${notification.recipient}] via [${notification.channel}]: ${notification.subject}`);

  await eventBus.publish('notification.sent', {
    notificationId: notification.id,
    userId: notification.userId,
    channel: notification.channel,
    subject: notification.subject
  }, { traceId: res.traceId });

  res.status(201).json(notification);
});

// Webhook listener for distributed events
server.post('/events/webhook', async (req, res) => {
  const event = req.body;
  if (!event || !event.topic) {
    return res.status(400).json({ error: 'Invalid event' });
  }

  logger.info(`Notification service handling event: ${event.topic}`);

  if (event.topic === 'auth.user.registered') {
    const { email, name, userId } = event.payload;
    await notificationsStore.insert({
      userId: userId || 'user',
      recipient: email,
      channel: 'EMAIL',
      subject: `Welcome to MicroServices Platform, ${name || 'Customer'}!`,
      message: `Your registration was successful. You can now browse our catalog and place orders.`,
      status: 'DELIVERED',
      sentAt: new Date().toISOString()
    });
  } else if (event.topic === 'order.saga.completed') {
    const { orderId, userId, totalAmount } = event.payload;
    await notificationsStore.insert({
      userId,
      recipient: userId,
      channel: 'EMAIL',
      subject: `Order #${orderId} Confirmed ($${totalAmount})`,
      message: `Your payment was processed and stock allocated. Thank you for your order!`,
      status: 'DELIVERED',
      sentAt: new Date().toISOString()
    });
  } else if (event.topic === 'order.cancelled') {
    const { orderId, userId, refundAmount, reason } = event.payload;
    await notificationsStore.insert({
      userId,
      recipient: userId,
      channel: 'EMAIL',
      subject: `Order #${orderId} Cancelled`,
      message: `Order #${orderId} was cancelled (${reason}). A refund of $${refundAmount || 0} has been credited.`,
      status: 'DELIVERED',
      sentAt: new Date().toISOString()
    });
  }

  res.json({ received: true });
});

// Templates list
server.get('/templates', async (req, res) => {
  const templates = await templatesStore.find({});
  res.json({ total: templates.length, templates });
});

server.listen(PORT, async () => {
  logger.info(`Notification & Alert Service running on port ${PORT}`);
  await registry.register().catch(() => {});
  await initTemplates();

  // Register subscriptions with event broker
  await eventBus.registerWebhookSubscription('auth.user.registered', `http://localhost:${PORT}/events/webhook`);
  await eventBus.registerWebhookSubscription('order.saga.completed', `http://localhost:${PORT}/events/webhook`);
  await eventBus.registerWebhookSubscription('order.cancelled', `http://localhost:${PORT}/events/webhook`);
});

module.exports = { server };

/**
 * Enterprise Microservices - Payment & Transaction Service
 * Port: 8005
 * Manages idempotent transaction processing, mock payment gateway integrations, refunds, and financial ledgers.
 */

const crypto = require('crypto');
const { HttpServer } = require('../../shared/http');
const { DocumentStore } = require('../../shared/storage');
const { EventBusClient } = require('../../shared/event-bus');
const { ServiceRegistryClient } = require('../../shared/service-registry');
const { Logger } = require('../../shared/logger');
const { ValidationError, NotFoundError, UnprocessableEntityError } = require('../../shared/errors');

const PORT = process.env.PAYMENT_SERVICE_PORT || 8005;
const logger = new Logger('payment-service');
const server = new HttpServer({ logger });

const transactionsStore = new DocumentStore('payments');
const ledgersStore = new DocumentStore('payment_ledgers');
const eventBus = new EventBusClient('payment-service');
const registry = new ServiceRegistryClient({
  serviceName: 'payment-service',
  port: PORT,
  metadata: { version: '1.0.0', type: 'financial-core' }
});

// Health check
server.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    service: 'payment-service',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// Charge payment (Saga Step 2)
server.post('/charge', async (req, res) => {
  const { orderId, userId, amount, currency, paymentMethod, idempotencyKey } = req.body;

  if (!orderId || amount === undefined || amount <= 0) {
    throw new ValidationError('Valid orderId and positive amount are required');
  }

  // Idempotency check
  if (idempotencyKey) {
    const existing = await transactionsStore.findOne({ idempotencyKey });
    if (existing) {
      logger.info(`Idempotent transaction hit for key: ${idempotencyKey}`);
      return res.json(existing);
    }
  }

  const existingForOrder = await transactionsStore.findOne({ orderId, status: 'SUCCESS' });
  if (existingForOrder) {
    return res.json(existingForOrder);
  }

  // Simulate gateway validation (fail on specific test trigger e.g. amount == 99999 or card '4000000000000002')
  const shouldFail = (amount === 99999) || (paymentMethod && paymentMethod.cardNumber === '4000000000000002');

  if (shouldFail) {
    const failedTx = await transactionsStore.insert({
      orderId,
      userId: userId || 'anonymous',
      amount: Number(amount),
      currency: currency || 'USD',
      status: 'FAILED',
      failureReason: 'Card declined / Insufficient funds simulation',
      idempotencyKey: idempotencyKey || null,
      gatewayRef: `gw_err_${Date.now()}`
    });

    await eventBus.publish('payment.failed', {
      orderId,
      transactionId: failedTx.id,
      amount,
      reason: failedTx.failureReason
    }, { traceId: res.traceId });

    throw new UnprocessableEntityError('Payment gateway declined the transaction', { transactionId: failedTx.id });
  }

  const transaction = await transactionsStore.insert({
    orderId,
    userId: userId || 'anonymous',
    amount: Number(amount),
    currency: currency || 'USD',
    status: 'SUCCESS',
    paymentMethod: {
      type: (paymentMethod && paymentMethod.type) || 'CREDIT_CARD',
      last4: (paymentMethod && paymentMethod.last4) || '4242'
    },
    idempotencyKey: idempotencyKey || null,
    gatewayRef: `gw_auth_${crypto.randomBytes(6).toString('hex')}`
  });

  // Record into financial ledger
  await ledgersStore.insert({
    transactionId: transaction.id,
    orderId,
    amount: transaction.amount,
    currency: transaction.currency,
    type: 'CREDIT',
    description: `Charge for order ${orderId}`,
    balanceAfter: transaction.amount
  });

  logger.info(`Payment charged successfully for order ${orderId}: $${amount}`, { transactionId: transaction.id });

  await eventBus.publish('payment.successful', {
    orderId,
    transactionId: transaction.id,
    userId,
    amount: transaction.amount,
    currency: transaction.currency
  }, { traceId: res.traceId });

  res.status(201).json(transaction);
});

// Process refund (Saga Compensation Step)
server.post('/refund', async (req, res) => {
  const { orderId, transactionId, reason } = req.body;

  if (!orderId && !transactionId) {
    throw new ValidationError('Either orderId or transactionId is required');
  }

  let tx = null;
  if (transactionId) {
    tx = await transactionsStore.findById(transactionId);
  } else if (orderId) {
    tx = await transactionsStore.findOne({ orderId, status: 'SUCCESS' });
  }

  if (!tx) {
    throw new NotFoundError('Successful Transaction', orderId || transactionId);
  }

  if (tx.status === 'REFUNDED') {
    return res.json({ success: true, message: 'Transaction already refunded', transaction: tx });
  }

  const updatedTx = await transactionsStore.updateById(tx.id, {
    status: 'REFUNDED',
    refundedAt: new Date().toISOString(),
    refundReason: reason || 'Order cancelled / Saga rollback'
  });

  // Record ledger debit
  await ledgersStore.insert({
    transactionId: tx.id,
    orderId: tx.orderId,
    amount: tx.amount,
    currency: tx.currency,
    type: 'DEBIT',
    description: `Refund for order ${tx.orderId}: ${reason || 'Rollback'}`
  });

  logger.info(`Refund processed for order ${tx.orderId}: $${tx.amount}`, { transactionId: tx.id });

  await eventBus.publish('payment.refunded', {
    orderId: tx.orderId,
    transactionId: tx.id,
    amount: tx.amount,
    reason: reason || 'Compensation'
  }, { traceId: res.traceId });

  res.json({ success: true, transaction: updatedTx });
});

// Get transactions
server.get('/transactions', async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const list = await transactionsStore.find({}, { limit, sort: { createdAt: -1 } });
  res.json({ total: list.length, transactions: list });
});

// Get ledgers
server.get('/ledgers', async (req, res) => {
  const list = await ledgersStore.find({}, { limit: 100, sort: { createdAt: -1 } });
  res.json({ total: list.length, ledgers: list });
});

server.listen(PORT, () => {
  logger.info(`Payment & Transaction Service running on port ${PORT}`);
  registry.register().catch(() => {});
});

module.exports = { server };

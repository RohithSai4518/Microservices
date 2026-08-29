/**
 * Enterprise Microservices Distributed Event Bus & Message Broker Server
 * Zero-dependency standalone event broker with topic-based pub/sub, event persistence, and dead-letter queues.
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { Logger } = require('../logger');

class EventBusServer {
  constructor(options = {}) {
    this.port = options.port || 9000;
    this.logger = new Logger('event-bus-broker');
    this.events = [];           // In-memory event log
    this.subscriptions = new Map(); // topic -> Set of callback urls or listener callbacks
    this.deadLetterQueue = [];  // Failed deliveries
    this.maxLogSize = options.maxLogSize || 5000;
    this.server = null;
    this.storagePath = options.storagePath || path.join(process.cwd(), 'data', 'event-bus');

    this._ensureStorage();
  }

  _ensureStorage() {
    try {
      if (!fs.existsSync(this.storagePath)) {
        fs.mkdirSync(this.storagePath, { recursive: true });
      }
    } catch (e) {
      this.logger.error('Failed to create event-bus storage directory', { error: e.message });
    }
  }

  _persistEvent(event) {
    try {
      const file = path.join(this.storagePath, 'events.log');
      fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8');
    } catch (e) {
      // Storage fallback
    }
  }

  subscribe(topic, subscriber) {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
    }
    this.subscriptions.get(topic).add(subscriber);
    this.logger.info(`New subscriber for topic '${topic}'`, { subscriber: typeof subscriber === 'string' ? subscriber : 'internal-handler' });
  }

  unsubscribe(topic, subscriber) {
    if (this.subscriptions.has(topic)) {
      this.subscriptions.get(topic).delete(subscriber);
    }
  }

  async publish(topic, payload, meta = {}) {
    const eventId = `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const event = {
      id: eventId,
      topic,
      payload,
      traceId: meta.traceId || `tr_${Date.now()}`,
      sender: meta.sender || 'anonymous',
      timestamp: new Date().toISOString(),
      status: 'PUBLISHED',
      attempts: 0
    };

    this.events.push(event);
    if (this.events.length > this.maxLogSize) {
      this.events.shift();
    }
    this._persistEvent(event);

    this.logger.info(`[Topic: ${topic}] Event published`, { eventId, sender: event.sender, traceId: event.traceId });

    // Deliver to subscribers
    const subscribers = this.subscriptions.get(topic) || new Set();
    const wildcardSubscribers = this.subscriptions.get('*') || new Set();
    const allSubscribers = new Set([...subscribers, ...wildcardSubscribers]);

    const deliveryPromises = [];
    for (const sub of allSubscribers) {
      deliveryPromises.push(this._deliver(event, sub));
    }

    await Promise.allSettled(deliveryPromises);
    return event;
  }

  async _deliver(event, subscriber) {
    event.attempts++;
    if (typeof subscriber === 'function') {
      try {
        await subscriber(event);
      } catch (err) {
        this.logger.error(`Internal subscriber failed for event ${event.id}`, { error: err.message });
        this.deadLetterQueue.push({ event, subscriber: 'function', error: err.message, failedAt: new Date().toISOString() });
      }
      return;
    }

    if (typeof subscriber === 'string' && subscriber.startsWith('http')) {
      return new Promise((resolve) => {
        const parsed = url.parse(subscriber);
        const postData = JSON.stringify(event);
        const req = http.request({
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'X-Trace-Id': event.traceId,
            'X-Event-Topic': event.topic
          },
          timeout: 3000
        }, (res) => {
          let resData = '';
          res.on('data', chunk => resData += chunk);
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve();
            } else {
              this.logger.warn(`Webhook subscriber ${subscriber} returned status ${res.statusCode}`);
              this.deadLetterQueue.push({ event, subscriber, statusCode: res.statusCode, failedAt: new Date().toISOString() });
              resolve();
            }
          });
        });

        req.on('error', (err) => {
          this.logger.error(`Delivery error to ${subscriber}: ${err.message}`);
          this.deadLetterQueue.push({ event, subscriber, error: err.message, failedAt: new Date().toISOString() });
          resolve();
        });

        req.on('timeout', () => {
          req.destroy();
          this.logger.error(`Delivery timeout to ${subscriber}`);
          this.deadLetterQueue.push({ event, subscriber, error: 'TIMEOUT', failedAt: new Date().toISOString() });
          resolve();
        });

        req.write(postData);
        req.end();
      });
    }
  }

  _parseBody(req) {
    return new Promise(resolve => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          req.body = body ? JSON.parse(body) : {};
        } catch {
          req.body = {};
        }
        resolve();
      });
    });
  }

  start() {
    this.server = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Trace-Id');

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        return res.end();
      }

      await this._parseBody(req);
      const parsed = url.parse(req.url, true);

      // Routing
      if (req.method === 'POST' && parsed.pathname === '/publish') {
        const { topic, payload, meta } = req.body;
        if (!topic) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ success: false, error: 'Topic is required' }));
        }
        const event = await this.publish(topic, payload, meta);
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ success: true, event }));
      }

      if (req.method === 'POST' && parsed.pathname === '/subscribe') {
        const { topic, callbackUrl } = req.body;
        if (!topic || !callbackUrl) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ success: false, error: 'Topic and callbackUrl are required' }));
        }
        this.subscribe(topic, callbackUrl);
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ success: true, message: `Subscribed to ${topic}` }));
      }

      if (req.method === 'GET' && parsed.pathname === '/events') {
        const limit = parseInt(parsed.query.limit, 10) || 50;
        const topic = parsed.query.topic;
        let filtered = this.events;
        if (topic) {
          filtered = filtered.filter(e => e.topic === topic);
        }
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({
          success: true,
          total: filtered.length,
          events: filtered.slice(-limit).reverse()
        }));
      }

      if (req.method === 'GET' && parsed.pathname === '/topics') {
        const topics = Array.from(this.subscriptions.keys()).map(topic => ({
          topic,
          subscribersCount: this.subscriptions.get(topic).size
        }));
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ success: true, topics }));
      }

      if (req.method === 'GET' && parsed.pathname === '/dlq') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({
          success: true,
          total: this.deadLetterQueue.length,
          items: this.deadLetterQueue.slice(-50).reverse()
        }));
      }

      if (req.method === 'GET' && parsed.pathname === '/health') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({
          status: 'UP',
          uptime: process.uptime(),
          totalEventsProcessed: this.events.length,
          dlqCount: this.deadLetterQueue.length,
          activeSubscriptions: this.subscriptions.size
        }));
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, error: 'Not Found' }));
    });

    this.server.listen(this.port, () => {
      this.logger.info(`Event Bus Broker active on port ${this.port}`);
    });
  }

  stop() {
    if (this.server) this.server.close();
  }
}

if (require.main === module) {
  const port = process.env.EVENT_BUS_PORT || 9000;
  const broker = new EventBusServer({ port });
  broker.start();
}

module.exports = {
  EventBusServer
};

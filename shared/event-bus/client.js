/**
 * Enterprise Microservices Event Bus Client SDK
 * Zero-dependency client for publishing and subscribing to distributed domain events.
 */

const http = require('http');
const url = require('url');
const { Logger } = require('../logger');

class EventBusClient {
  constructor(serviceName, options = {}) {
    this.serviceName = serviceName;
    this.brokerUrl = options.brokerUrl || process.env.EVENT_BUS_URL || 'http://localhost:9000';
    this.logger = new Logger(`${serviceName}-event-client`);
    this.parsedBroker = url.parse(this.brokerUrl);
  }

  async publish(topic, payload, meta = {}) {
    const enrichedMeta = {
      sender: this.serviceName,
      traceId: meta.traceId || `tr_${Date.now()}`,
      ...meta
    };

    const postData = JSON.stringify({
      topic,
      payload,
      meta: enrichedMeta
    });

    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: this.parsedBroker.hostname,
        port: this.parsedBroker.port,
        path: '/publish',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'X-Trace-Id': enrichedMeta.traceId
        },
        timeout: 4000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed.event);
            } else {
              this.logger.warn(`Publish to ${topic} returned status ${res.statusCode}`, { data });
              resolve(null);
            }
          } catch (e) {
            resolve(null);
          }
        });
      });

      req.on('error', (err) => {
        this.logger.error(`Event Bus unavailable for publish: ${err.message}`, { topic });
        resolve(null); // Resilient fallback
      });

      req.on('timeout', () => {
        req.destroy();
        this.logger.error(`Event Bus publish timed out`, { topic });
        resolve(null);
      });

      req.write(postData);
      req.end();
    });
  }

  async registerWebhookSubscription(topic, webhookUrl) {
    const postData = JSON.stringify({
      topic,
      callbackUrl: webhookUrl
    });

    return new Promise((resolve) => {
      const req = http.request({
        hostname: this.parsedBroker.hostname,
        port: this.parsedBroker.port,
        path: '/subscribe',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 3000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          this.logger.info(`Registered subscription for topic '${topic}' at ${webhookUrl}`);
          resolve(true);
        });
      });

      req.on('error', (err) => {
        this.logger.warn(`Could not register subscription on broker: ${err.message}`);
        resolve(false);
      });

      req.write(postData);
      req.end();
    });
  }

  async getRecentEvents(topic = null, limit = 50) {
    return new Promise((resolve) => {
      const queryStr = topic ? `?topic=${encodeURIComponent(topic)}&limit=${limit}` : `?limit=${limit}`;
      const req = http.get({
        hostname: this.parsedBroker.hostname,
        port: this.parsedBroker.port,
        path: `/events${queryStr}`,
        timeout: 2000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.events || []);
          } catch {
            resolve([]);
          }
        });
      });

      req.on('error', () => resolve([]));
    });
  }
}

module.exports = {
  EventBusClient
};

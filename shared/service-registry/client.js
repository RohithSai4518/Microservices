/**
 * Enterprise Microservices Service Registry Client SDK
 * Auto-registration, periodic heartbeat dispatch, and client-side service discovery with round-robin balancing.
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const { Logger } = require('../logger');

class ServiceRegistryClient {
  constructor(options = {}) {
    this.serviceName = options.serviceName;
    this.port = options.port;
    this.host = options.host || 'localhost';
    this.registryUrl = options.registryUrl || process.env.REGISTRY_URL || 'http://localhost:9001';
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 10000;
    this.metadata = options.metadata || {};
    
    this.instanceId = `${this.serviceName}-${crypto.randomBytes(4).toString('hex')}`;
    this.logger = new Logger(`${this.serviceName}-registry-client`);
    this.parsedRegistry = url.parse(this.registryUrl);
    this.heartbeatTimer = null;
    this.cachedInstances = new Map(); // serviceName -> { instances: [], lastFetched: number }
    this.rrIndices = new Map(); // serviceName -> number
  }

  async register() {
    const payload = JSON.stringify({
      name: this.serviceName,
      instanceId: this.instanceId,
      host: this.host,
      port: this.port,
      healthUrl: `http://${this.host}:${this.port}/health`,
      metadata: this.metadata
    });

    return new Promise((resolve) => {
      const req = http.request({
        hostname: this.parsedRegistry.hostname,
        port: this.parsedRegistry.port,
        path: '/register',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 3000
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            this.logger.info(`Successfully registered instance ${this.instanceId} with Service Registry`);
            this._startHeartbeat();
            this._setupGracefulExit();
            resolve(true);
          } else {
            this.logger.warn(`Failed to register with registry: status ${res.statusCode}`);
            resolve(false);
          }
        });
      });

      req.on('error', (err) => {
        this.logger.warn(`Registry unreachable on registration: ${err.message}`);
        resolve(false);
      });

      req.write(payload);
      req.end();
    });
  }

  _startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.heartbeatTimer = setInterval(async () => {
      const payload = JSON.stringify({
        name: this.serviceName,
        instanceId: this.instanceId
      });

      const req = http.request({
        hostname: this.parsedRegistry.hostname,
        port: this.parsedRegistry.port,
        path: '/heartbeat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 3000
      }, (res) => {
        if (res.statusCode === 200) {
          // Heartbeat healthy
        } else {
          // Attempt re-registration if heartbeat failed
          this.register().catch(() => {});
        }
      });

      req.on('error', () => {
        // Registry temporarily down, will retry next tick
      });

      req.write(payload);
      req.end();
    }, this.heartbeatIntervalMs);
  }

  async deregister() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    const payload = JSON.stringify({
      name: this.serviceName,
      instanceId: this.instanceId
    });

    return new Promise((resolve) => {
      const req = http.request({
        hostname: this.parsedRegistry.hostname,
        port: this.parsedRegistry.port,
        path: '/deregister',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 2000
      }, () => {
        this.logger.info(`Deregistered from Service Registry`);
        resolve(true);
      });

      req.on('error', () => resolve(false));
      req.write(payload);
      req.end();
    });
  }

  async discover(targetServiceName) {
    const cached = this.cachedInstances.get(targetServiceName);
    const now = Date.now();

    if (cached && (now - cached.lastFetched < 5000)) {
      return this._selectRoundRobin(targetServiceName, cached.instances);
    }

    return new Promise((resolve) => {
      const req = http.get({
        hostname: this.parsedRegistry.hostname,
        port: this.parsedRegistry.port,
        path: `/services/${encodeURIComponent(targetServiceName)}`,
        timeout: 2000
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const instances = parsed.instances || [];
            this.cachedInstances.set(targetServiceName, {
              instances,
              lastFetched: Date.now()
            });
            resolve(this._selectRoundRobin(targetServiceName, instances));
          } catch {
            resolve(null);
          }
        });
      });

      req.on('error', () => {
        if (cached && cached.instances.length > 0) {
          resolve(this._selectRoundRobin(targetServiceName, cached.instances));
        } else {
          resolve(null);
        }
      });
    });
  }

  _selectRoundRobin(serviceName, instances = []) {
    if (!instances || instances.length === 0) return null;
    let idx = this.rrIndices.get(serviceName) || 0;
    const selected = instances[idx % instances.length];
    this.rrIndices.set(serviceName, idx + 1);
    return selected;
  }

  _setupGracefulExit() {
    const cleanup = () => {
      this.deregister().finally(() => process.exit(0));
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }
}

module.exports = {
  ServiceRegistryClient
};

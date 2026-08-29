/**
 * Enterprise Microservices Service Registry & Health Discovery Server
 * Zero-dependency standalone registry with dynamic discovery, heartbeat monitoring, and instance eviction.
 */

const http = require('http');
const url = require('url');
const { Logger } = require('../logger');

class ServiceRegistryServer {
  constructor(options = {}) {
    this.port = options.port || 9001;
    this.logger = new Logger('service-registry');
    this.services = new Map(); // serviceName -> Map(instanceId -> instanceData)
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs || 30000;
    this.healthCheckIntervalMs = options.healthCheckIntervalMs || 10000;
    this.reaperTimer = null;
    this.server = null;
  }

  register(instance) {
    const { name, instanceId, host, port, healthUrl, metadata = {} } = instance;
    if (!name || !instanceId || !port) {
      throw new Error('name, instanceId, and port are required');
    }

    if (!this.services.has(name)) {
      this.services.set(name, new Map());
    }

    const serviceMap = this.services.get(name);
    const existing = serviceMap.get(instanceId);

    const instanceData = {
      name,
      instanceId,
      host: host || 'localhost',
      port,
      baseUrl: `http://${host || 'localhost'}:${port}`,
      healthUrl: healthUrl || `http://${host || 'localhost'}:${port}/health`,
      status: 'UP',
      metadata,
      registeredAt: existing ? existing.registeredAt : new Date().toISOString(),
      lastHeartbeat: Date.now()
    };

    serviceMap.set(instanceId, instanceData);
    this.logger.info(`Service registered: [${name}] instance [${instanceId}] at ${instanceData.baseUrl}`);
    return instanceData;
  }

  heartbeat(name, instanceId) {
    if (this.services.has(name)) {
      const instance = this.services.get(name).get(instanceId);
      if (instance) {
        instance.lastHeartbeat = Date.now();
        instance.status = 'UP';
        return true;
      }
    }
    return false;
  }

  deregister(name, instanceId) {
    if (this.services.has(name)) {
      const serviceMap = this.services.get(name);
      if (serviceMap.delete(instanceId)) {
        this.logger.info(`Service deregistered: [${name}] instance [${instanceId}]`);
        if (serviceMap.size === 0) {
          this.services.delete(name);
        }
        return true;
      }
    }
    return false;
  }

  getInstances(name) {
    if (!this.services.has(name)) return [];
    const now = Date.now();
    return Array.from(this.services.get(name).values())
      .filter(inst => (now - inst.lastHeartbeat) < this.heartbeatTimeoutMs && inst.status === 'UP');
  }

  getAllServices() {
    const result = {};
    const now = Date.now();

    for (const [name, instances] of this.services.entries()) {
      result[name] = Array.from(instances.values()).map(inst => ({
        ...inst,
        isHealthy: (now - inst.lastHeartbeat) < this.heartbeatTimeoutMs && inst.status === 'UP',
        timeSinceHeartbeatSeconds: Math.floor((now - inst.lastHeartbeat) / 1000)
      }));
    }
    return result;
  }

  _startReaper() {
    this.reaperTimer = setInterval(() => {
      const now = Date.now();
      for (const [name, instances] of this.services.entries()) {
        for (const [instanceId, inst] of instances.entries()) {
          const elapsed = now - inst.lastHeartbeat;
          if (elapsed > this.heartbeatTimeoutMs) {
            this.logger.warn(`Instance timeout evicted: [${name}] [${instanceId}] after ${elapsed}ms silence`);
            instances.delete(instanceId);
          }
        }
        if (instances.size === 0) {
          this.services.delete(name);
        }
      }
    }, this.healthCheckIntervalMs);
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
    this._startReaper();

    this.server = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Trace-Id');

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        return res.end();
      }

      await this._parseBody(req);
      const parsed = url.parse(req.url, true);

      // Routing
      if (req.method === 'POST' && parsed.pathname === '/register') {
        try {
          const instance = this.register(req.body);
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ success: true, instance }));
        } catch (e) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ success: false, error: e.message }));
        }
      }

      if (req.method === 'POST' && parsed.pathname === '/heartbeat') {
        const { name, instanceId } = req.body;
        const ok = this.heartbeat(name, instanceId);
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ success: ok }));
      }

      if (req.method === 'POST' && parsed.pathname === '/deregister') {
        const { name, instanceId } = req.body;
        const ok = this.deregister(name, instanceId);
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ success: ok }));
      }

      if (req.method === 'GET' && parsed.pathname === '/services') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({
          success: true,
          services: this.getAllServices()
        }));
      }

      if (req.method === 'GET' && parsed.pathname.startsWith('/services/')) {
        const serviceName = parsed.pathname.replace('/services/', '');
        const instances = this.getInstances(serviceName);
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({
          success: true,
          service: serviceName,
          instances
        }));
      }

      if (req.method === 'GET' && parsed.pathname === '/health') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({
          status: 'UP',
          uptime: process.uptime(),
          registeredServiceCount: this.services.size
        }));
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, error: 'Not Found' }));
    });

    this.server.listen(this.port, () => {
      this.logger.info(`Service Registry active on port ${this.port}`);
    });
  }

  stop() {
    if (this.reaperTimer) clearInterval(this.reaperTimer);
    if (this.server) this.server.close();
  }
}

if (require.main === module) {
  const port = process.env.REGISTRY_PORT || 9001;
  const server = new ServiceRegistryServer({ port });
  server.start();
}

module.exports = {
  ServiceRegistryServer
};

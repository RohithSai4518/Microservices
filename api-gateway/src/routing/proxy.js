/**
 * Enterprise Microservices API Gateway - Reverse Proxy Dispatcher
 * Seamless HTTP request forwarding with connection pooling, circuit breaker checks, and telemetry logging.
 */

const http = require('http');
const url = require('url');
const { CircuitBreakerOpenError, ServiceUnavailableError } = require('../../../shared/errors');
const { Logger } = require('../../../shared/logger');

class ReverseProxy {
  constructor(serviceRegistry, breakerRegistry, options = {}) {
    this.registry = serviceRegistry;
    this.breakerRegistry = breakerRegistry;
    this.logger = new Logger('api-gateway-proxy');
    this.timeoutMs = options.timeoutMs || 8000;
  }

  async forward(req, res, targetServiceName, targetPath, fallbackPort) {
    const breaker = this.breakerRegistry.getBreaker(targetServiceName);

    // Circuit Breaker Check
    if (breaker.isOpen()) {
      return res.error(new CircuitBreakerOpenError(targetServiceName));
    }

    // Dynamic Service Discovery with Static Fallback
    let targetHost = 'localhost';
    let targetPort = fallbackPort;

    if (this.registry) {
      try {
        const instance = await this.registry.discover(targetServiceName);
        if (instance) {
          targetHost = instance.host;
          targetPort = instance.port;
        }
      } catch (err) {
        // Fallback to configured port
      }
    }

    const startTime = Date.now();
    const parsedOriginal = url.parse(req.url, true);
    const queryString = parsedOriginal.search || '';
    const fullPath = `${targetPath}${queryString}`;

    const headers = {
      ...req.headers,
      host: `${targetHost}:${targetPort}`,
      'x-forwarded-for': req.socket.remoteAddress || '127.0.0.1',
      'x-forwarded-proto': 'http',
      'x-trace-id': res.traceId || req.headers['x-trace-id'] || `tr_${Date.now()}`
    };

    if (req.user) {
      headers['x-user-id'] = req.user.id || req.user.userId || '';
      headers['x-user-role'] = req.user.role || '';
      headers['x-user-email'] = req.user.email || '';
    }

    delete headers['connection'];

    const postData = req.rawBody || (req.body ? JSON.stringify(req.body) : null);
    if (postData && typeof postData === 'string') {
      headers['content-length'] = Buffer.byteLength(postData);
    }

    const proxyReq = http.request({
      hostname: targetHost,
      port: targetPort,
      path: fullPath,
      method: req.method,
      headers: headers,
      timeout: this.timeoutMs
    }, (proxyRes) => {
      breaker.recordSuccess();

      // Forward response headers
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        res.setHeader(key, value);
      }
      res.setHeader('X-Trace-Id', headers['x-trace-id']);
      res.setHeader('X-Served-By', `${targetServiceName}@${targetHost}:${targetPort}`);
      res.statusCode = proxyRes.statusCode;

      proxyRes.pipe(res);

      proxyRes.on('end', () => {
        const latency = Date.now() - startTime;
        this.logger.info(`[${req.method}] ${req.pathname} -> ${targetServiceName}${fullPath} (${proxyRes.statusCode}) in ${latency}ms`, {
          traceId: headers['x-trace-id'],
          latencyMs: latency
        });
      });
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      breaker.recordFailure();
      this.logger.error(`Proxy timeout waiting for ${targetServiceName}`, { traceId: headers['x-trace-id'] });
      res.error(new ServiceUnavailableError(`Timeout waiting for upstream service '${targetServiceName}'`, targetServiceName));
    });

    proxyReq.on('error', (err) => {
      breaker.recordFailure();
      this.logger.error(`Proxy error forwarding to ${targetServiceName}: ${err.message}`, { traceId: headers['x-trace-id'] });
      res.error(new ServiceUnavailableError(`Failed to connect to microservice '${targetServiceName}'`, targetServiceName));
    });

    if (postData) {
      proxyReq.write(postData);
    }
    proxyReq.end();
  }
}

module.exports = { ReverseProxy };

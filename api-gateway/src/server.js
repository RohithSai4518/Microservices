/**
 * Enterprise Microservices Central API Gateway
 * Zero-dependency gateway orchestrating authentication, rate limiting, circuit breaker,
 * reverse proxying, service discovery, and hosting the responsive management console.
 */

const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');
const { Logger } = require('../../shared/logger');
const { RateLimiter } = require('./middleware/rate-limiter');
const { CircuitBreakerRegistry } = require('./middleware/circuit-breaker');
const { ReverseProxy } = require('./routing/proxy');
const { ServiceRegistryClient } = require('../../shared/service-registry');

const PORT = process.env.GATEWAY_PORT || 8000;
const logger = new Logger('api-gateway');

// Service Ports Mapping (Defaults)
const SERVICE_ROUTES = [
  { prefix: '/api/auth', serviceName: 'auth-service', defaultPort: 8001 },
  { prefix: '/api/users', serviceName: 'user-service', defaultPort: 8002 },
  { prefix: '/api/products', serviceName: 'product-service', defaultPort: 8003 },
  { prefix: '/api/orders', serviceName: 'order-service', defaultPort: 8004 },
  { prefix: '/api/payments', serviceName: 'payment-service', defaultPort: 8005 },
  { prefix: '/api/inventory', serviceName: 'inventory-service', defaultPort: 8006 },
  { prefix: '/api/notifications', serviceName: 'notification-service', defaultPort: 8007 },
  { prefix: '/api/analytics', serviceName: 'analytics-service', defaultPort: 8008 }
];

const registryClient = new ServiceRegistryClient({
  serviceName: 'api-gateway',
  port: PORT,
  registryUrl: process.env.REGISTRY_URL || 'http://localhost:9001'
});

const breakerRegistry = new CircuitBreakerRegistry();
const rateLimiter = new RateLimiter({ windowMs: 60000, maxRequests: 200 });
const proxy = new ReverseProxy(registryClient, breakerRegistry);

// MIME types for static dashboard assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveStaticFile(req, res, pathname) {
  let relativePath = pathname === '/' || pathname === '/dashboard' ? '/index.html' : pathname.replace(/^\/dashboard/, '');
  if (relativePath === '' || relativePath === '/') relativePath = '/index.html';

  const dashboardDir = path.join(__dirname, '..', '..', 'dashboard');
  const safePath = path.normalize(path.join(dashboardDir, relativePath));

  if (!safePath.startsWith(dashboardDir)) {
    res.statusCode = 403;
    return res.end('Access Denied');
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end('<h1>404 Not Found</h1><p>Dashboard asset not found</p>');
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache');

    const stream = fs.createReadStream(safePath);
    stream.pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || '/';
  req.pathname = pathname;
  req.query = parsedUrl.query || {};
  
  const traceId = req.headers['x-trace-id'] || `tr_gw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  res.traceId = traceId;
  res.setHeader('X-Trace-Id', traceId);

  // Response helper
  res.error = (err) => {
    const status = err.statusCode || 500;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      success: false,
      error: {
        code: err.errorCode || 'GATEWAY_ERROR',
        message: err.message,
        statusCode: status,
        details: err.details || null,
        timestamp: new Date().toISOString(),
        traceId
      }
    }));
  };

  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Trace-Id, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.statusCode = 204;
    return res.end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  // Rate Limiting Check
  let rateLimitPassed = false;
  rateLimiter.middleware()(req, res, () => {
    rateLimitPassed = true;
  });
  if (res.writableEnded) return;

  // System Diagnostics / Status Route
  if (pathname === '/api/system/status' || pathname === '/api/system/topology') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      success: true,
      timestamp: new Date().toISOString(),
      gateway: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        port: PORT
      },
      circuitBreakers: breakerRegistry.getAllStatuses(),
      routes: SERVICE_ROUTES
    }));
  }

  // Gateway Health Route
  if (pathname === '/health') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({
      status: 'UP',
      service: 'api-gateway',
      port: PORT,
      timestamp: new Date().toISOString()
    }));
  }

  // Microservice Reverse Proxy Dispatch
  for (const route of SERVICE_ROUTES) {
    if (pathname.startsWith(route.prefix)) {
      const strippedPath = pathname.substring(route.prefix.length) || '/';
      
      // Buffer request body
      let bodyData = '';
      req.on('data', chunk => bodyData += chunk);
      req.on('end', async () => {
        req.rawBody = bodyData;
        await proxy.forward(req, res, route.serviceName, strippedPath, route.defaultPort);
      });
      return;
    }
  }

  // Static Dashboard Assets
  if (req.method === 'GET' && (!pathname.startsWith('/api') || pathname === '/')) {
    return serveStaticFile(req, res, pathname);
  }

  // 404 Route Not Found
  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Gateway route '${pathname}' was not found.`,
      traceId
    }
  }));
});

server.listen(PORT, () => {
  logger.info(`Enterprise Microservices API Gateway running at http://localhost:${PORT}`);
  logger.info(`Management Dashboard accessible at http://localhost:${PORT}/dashboard`);
  registryClient.register().catch(() => {});
});

module.exports = { server };

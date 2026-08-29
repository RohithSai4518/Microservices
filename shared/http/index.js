/**
 * Enterprise Microservices HTTP Micro-Framework
 * Zero-dependency robust HTTP server, router, middleware chain, and response utilities.
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const { AppError } = require('../errors');

class Router {
  constructor() {
    this.routes = [];
    this.middlewares = [];
  }

  use(...middlewares) {
    for (const mw of middlewares) {
      if (typeof mw === 'function') {
        this.middlewares.push(mw);
      }
    }
    return this;
  }

  _registerRoute(method, pathPattern, ...handlers) {
    const paramNames = [];
    // Convert /users/:id/orders/:orderId into a regex and extract parameter names
    const regexPattern = pathPattern
      .replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
      })
      .replace(/\//g, '\\/');

    const regex = new RegExp(`^${regexPattern}$`);

    this.routes.push({
      method: method.toUpperCase(),
      pathPattern,
      regex,
      paramNames,
      handlers
    });
  }

  get(path, ...handlers) {
    this._registerRoute('GET', path, ...handlers);
    return this;
  }

  post(path, ...handlers) {
    this._registerRoute('POST', path, ...handlers);
    return this;
  }

  put(path, ...handlers) {
    this._registerRoute('PUT', path, ...handlers);
    return this;
  }

  patch(path, ...handlers) {
    this._registerRoute('PATCH', path, ...handlers);
    return this;
  }

  delete(path, ...handlers) {
    this._registerRoute('DELETE', path, ...handlers);
    return this;
  }

  options(path, ...handlers) {
    this._registerRoute('OPTIONS', path, ...handlers);
    return this;
  }

  match(method, pathname) {
    const upperMethod = method.toUpperCase();
    for (const route of this.routes) {
      if (route.method === upperMethod || route.method === 'ALL') {
        const match = pathname.match(route.regex);
        if (match) {
          const params = {};
          route.paramNames.forEach((name, index) => {
            params[name] = decodeURIComponent(match[index + 1]);
          });
          return { route, params };
        }
      }
    }
    return null;
  }
}

class HttpServer {
  constructor(options = {}) {
    this.options = options;
    this.router = new Router();
    this.server = null;
    this.logger = options.logger || console;
  }

  use(...middlewares) {
    this.router.use(...middlewares);
    return this;
  }

  get(path, ...handlers) {
    this.router.get(path, ...handlers);
    return this;
  }

  post(path, ...handlers) {
    this.router.post(path, ...handlers);
    return this;
  }

  put(path, ...handlers) {
    this.router.put(path, ...handlers);
    return this;
  }

  patch(path, ...handlers) {
    this.router.patch(path, ...handlers);
    return this;
  }

  delete(path, ...handlers) {
    this.router.delete(path, ...handlers);
    return this;
  }

  options(path, ...handlers) {
    this.router.options(path, ...handlers);
    return this;
  }

  async _parseBody(req) {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
        // 10MB safety payload limit
        if (body.length > 10 * 1024 * 1024) {
          req.connection.destroy();
        }
      });

      req.on('end', () => {
        req.rawBody = body;
        const contentType = req.headers['content-type'] || '';

        if (body && contentType.includes('application/json')) {
          try {
            req.body = JSON.parse(body);
          } catch (e) {
            req.body = {};
          }
        } else if (body && contentType.includes('application/x-www-form-urlencoded')) {
          const parsed = {};
          new URLSearchParams(body).forEach((value, key) => {
            parsed[key] = value;
          });
          req.body = parsed;
        } else {
          req.body = body ? { raw: body } : {};
        }
        resolve();
      });

      req.on('error', () => {
        req.body = {};
        resolve();
      });
    });
  }

  _enhanceResponse(req, res) {
    res.traceId = req.headers['x-trace-id'] || `tr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    res.setHeader('X-Trace-Id', res.traceId);
    res.setHeader('X-Powered-By', 'PureMicro/1.0');

    res.status = (code) => {
      res.statusCode = code;
      return res;
    };

    res.json = (data, statusCode) => {
      if (statusCode) res.statusCode = statusCode;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      const responsePayload = {
        success: res.statusCode >= 200 && res.statusCode < 400,
        data: data !== undefined ? data : null,
        timestamp: new Date().toISOString(),
        traceId: res.traceId
      };
      res.end(JSON.stringify(responsePayload));
    };

    res.error = (err, statusCode) => {
      const code = statusCode || (err instanceof AppError ? err.statusCode : 500);
      res.statusCode = code;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');

      const isAppErr = err instanceof AppError;
      const errorResponse = {
        success: false,
        error: {
          code: isAppErr ? err.errorCode : 'INTERNAL_SERVER_ERROR',
          message: err.message || 'An unexpected error occurred',
          statusCode: code,
          details: isAppErr ? err.details : null,
          timestamp: new Date().toISOString(),
          traceId: res.traceId
        }
      };
      res.end(JSON.stringify(errorResponse));
    };
  }

  async _handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    req.pathname = parsedUrl.pathname;
    req.query = parsedUrl.query;
    req.traceId = req.headers['x-trace-id'] || `tr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    this._enhanceResponse(req, res);

    // Global CORS preflight support
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Trace-Id, X-Requested-With');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.statusCode = 204;
      return res.end();
    }

    // Default CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      await this._parseBody(req);

      const matched = this.router.match(req.method, req.pathname);
      if (!matched) {
        return res.status(404).error(new AppError(`Route ${req.method} ${req.pathname} not found`, 404, 'ROUTE_NOT_FOUND'));
      }

      req.params = matched.params;

      const pipeline = [...this.router.middlewares, ...matched.route.handlers];
      let index = 0;

      const next = async (err) => {
        if (err) {
          return res.error(err);
        }
        if (index < pipeline.length) {
          const handler = pipeline[index++];
          try {
            await handler(req, res, next);
          } catch (handlerErr) {
            res.error(handlerErr);
          }
        }
      };

      await next();
    } catch (err) {
      res.error(err);
    }
  }

  listen(port, callback) {
    this.server = http.createServer((req, res) => this._handleRequest(req, res));
    this.server.listen(port, () => {
      if (callback) callback();
    });
    return this.server;
  }

  close() {
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = {
  HttpServer,
  Router
};

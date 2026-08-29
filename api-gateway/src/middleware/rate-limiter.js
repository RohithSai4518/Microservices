/**
 * Enterprise Microservices API Gateway - Rate Limiter Middleware
 * Token bucket and sliding window rate limiter implementation.
 */

const { RateLimitExceededError } = require('../../../shared/errors');

class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60 * 1000; // 1 minute window
    this.maxRequests = options.maxRequests || 200; // 200 requests per minute
    this.clients = new Map(); // clientKey -> { count, resetTime }

    // Periodic cleanup of expired clients
    setInterval(() => this._cleanup(), 30000);
  }

  _cleanup() {
    const now = Date.now();
    for (const [key, record] of this.clients.entries()) {
      if (now > record.resetTime) {
        this.clients.delete(key);
      }
    }
  }

  middleware() {
    return (req, res, next) => {
      const pathname = req.pathname || (req.url ? req.url.split('?')[0] : '') || '/';
      // Exclude static assets or health checks from rate limiting
      if (pathname.startsWith('/dashboard') || pathname === '/health' || pathname === '/favicon.ico' || pathname === '/') {
        return next();
      }

      const clientIp = req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '127.0.0.1';
      const key = `${clientIp}_${req.headers['authorization'] ? 'auth' : 'anon'}`;
      const now = Date.now();

      let record = this.clients.get(key);
      if (!record || now > record.resetTime) {
        record = {
          count: 1,
          resetTime: now + this.windowMs
        };
        this.clients.set(key, record);
      } else {
        record.count++;
      }

      const remaining = Math.max(0, this.maxRequests - record.count);
      const resetSeconds = Math.ceil((record.resetTime - now) / 1000);

      res.setHeader('X-RateLimit-Limit', this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', resetSeconds);

      if (record.count > this.maxRequests) {
        return res.error(new RateLimitExceededError(`Rate limit exceeded (${this.maxRequests} req/min). Retry in ${resetSeconds}s`, resetSeconds));
      }

      next();
    };
  }
}

module.exports = { RateLimiter };

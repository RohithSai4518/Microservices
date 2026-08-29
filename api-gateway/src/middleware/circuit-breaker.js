/**
 * Enterprise Microservices API Gateway - Circuit Breaker
 * State-machine protection (CLOSED, OPEN, HALF_OPEN) preventing cascading failure across microservices.
 */

const { CircuitBreakerOpenError } = require('../../../shared/errors');
const { Logger } = require('../../../shared/logger');

const STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

class CircuitBreaker {
  constructor(serviceName, options = {}) {
    this.serviceName = serviceName;
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 15000; // 15 seconds cooldown
    this.successThreshold = options.successThreshold || 2;
    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
    this.logger = new Logger(`circuit-breaker-${serviceName}`);
  }

  isOpen() {
    if (this.state === STATES.OPEN) {
      if (Date.now() >= this.nextAttempt) {
        this.state = STATES.HALF_OPEN;
        this.logger.info(`Circuit breaker transitioned to HALF_OPEN for service: ${this.serviceName}`);
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess() {
    if (this.state === STATES.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = STATES.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.logger.info(`Circuit breaker CLOSED (recovered) for service: ${this.serviceName}`);
      }
    } else if (this.state === STATES.CLOSED) {
      this.failureCount = 0;
    }
  }

  recordFailure() {
    this.failureCount++;
    if (this.state === STATES.HALF_OPEN || this.failureCount >= this.failureThreshold) {
      this.state = STATES.OPEN;
      this.nextAttempt = Date.now() + this.resetTimeout;
      this.logger.warn(`Circuit breaker tripped to OPEN for service: ${this.serviceName}. Failures: ${this.failureCount}`);
    }
  }

  getStatus() {
    return {
      service: this.serviceName,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      nextAttempt: this.state === STATES.OPEN ? new Date(this.nextAttempt).toISOString() : null
    };
  }
}

class CircuitBreakerRegistry {
  constructor() {
    this.breakers = new Map();
  }

  getBreaker(serviceName, options = {}) {
    if (!this.breakers.has(serviceName)) {
      this.breakers.set(serviceName, new CircuitBreaker(serviceName, options));
    }
    return this.breakers.get(serviceName);
  }

  getAllStatuses() {
    const statuses = {};
    for (const [name, breaker] of this.breakers.entries()) {
      statuses[name] = breaker.getStatus();
    }
    return statuses;
  }
}

module.exports = {
  CircuitBreaker,
  CircuitBreakerRegistry,
  STATES
};

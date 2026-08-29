/**
 * CQRS Pipeline Middleware Behaviors (Logging, Validation, Performance, Caching)
 */
const { Logger } = require('../../../shared/logger');

class LoggingBehavior {
  constructor(serviceName) {
    this.logger = new Logger(`pipeline-${serviceName}`);
  }

  async handle(request, next) {
    const requestName = request.constructor.name || 'AnonymousRequest';
    this.logger.info(`Handling ${requestName}`, { payloadKeys: Object.keys(request) });
    const response = await next(request);
    this.logger.info(`Handled ${requestName} successfully`);
    return response;
  }
}

class PerformanceBehavior {
  constructor(thresholdMs = 500) {
    this.thresholdMs = thresholdMs;
    this.logger = new Logger('pipeline-perf');
  }

  async handle(request, next) {
    const start = Date.now();
    const response = await next(request);
    const duration = Date.now() - start;

    if (duration > this.thresholdMs) {
      this.logger.warn(`Long running request: ${request.constructor.name} took ${duration}ms`);
    }
    return response;
  }
}

class ValidationBehavior {
  constructor(validatorMap = new Map()) {
    this.validatorMap = validatorMap;
  }

  async handle(request, next) {
    const requestName = request.constructor.name;
    const validator = this.validatorMap.get(requestName);

    if (validator && typeof validator.validate === 'function') {
      const result = validator.validate(request);
      if (!result.isValid) {
        throw new Error(`Validation failed for ${requestName}: ${result.errors.join(', ')}`);
      }
    }

    return next(request);
  }
}

module.exports = {
  LoggingBehavior,
  PerformanceBehavior,
  ValidationBehavior
};

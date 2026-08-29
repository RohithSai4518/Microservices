/**
 * Enterprise Microservices Domain & HTTP Error Hierarchy
 * Zero-dependency standardized error classes and response serializers.
 */

class AppError extends Error {
  constructor(message, statusCode = 500, errorCode = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.isOperational = true;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(traceId = null) {
    return {
      success: false,
      error: {
        code: this.errorCode,
        message: this.message,
        statusCode: this.statusCode,
        details: this.details,
        timestamp: this.timestamp,
        traceId: traceId || 'no-trace-id'
      }
    };
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = null) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Bad request', details = null) {
    super(message, 400, 'BAD_REQUEST', details);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required or token expired', details = null) {
    super(message, 401, 'UNAUTHORIZED', details);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Access denied for current role', details = null) {
    super(message, 403, 'FORBIDDEN', details);
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource', id = '') {
    const msg = id ? `${resource} with ID '${id}' was not found` : `${resource} not found`;
    super(msg, 404, 'NOT_FOUND', { resource, id });
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource state conflict', details = null) {
    super(message, 409, 'CONFLICT', details);
  }
}

class UnprocessableEntityError extends AppError {
  constructor(message = 'Unprocessable entity', details = null) {
    super(message, 422, 'UNPROCESSABLE_ENTITY', details);
  }
}

class RateLimitExceededError extends AppError {
  constructor(message = 'Too many requests. Please try again later.', retryAfter = 60) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED', { retryAfter });
  }
}

class CircuitBreakerOpenError extends AppError {
  constructor(serviceName = 'Target Service') {
    super(`Service '${serviceName}' is currently unavailable due to circuit breaker trip`, 503, 'CIRCUIT_BREAKER_OPEN', { service: serviceName });
  }
}

class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', serviceName = null) {
    super(message, 503, 'SERVICE_UNAVAILABLE', { service: serviceName });
  }
}

class SagaFailedError extends AppError {
  constructor(sagaName, stepName, reason) {
    super(`Distributed Saga '${sagaName}' failed at step '${stepName}': ${reason}`, 500, 'SAGA_TRANSACTION_FAILED', {
      sagaName,
      stepName,
      reason
    });
  }
}

module.exports = {
  AppError,
  ValidationError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  RateLimitExceededError,
  CircuitBreakerOpenError,
  ServiceUnavailableError,
  SagaFailedError
};

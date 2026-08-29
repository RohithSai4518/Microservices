/**
 * Enterprise Value Objects Collection
 * Immutable domain building blocks ensuring domain invariants at instantiation.
 */

class ValueObject {
  equals(other) {
    if (!other || other.constructor !== this.constructor) return false;
    return JSON.stringify(this) === JSON.stringify(other);
  }
}

class Money extends ValueObject {
  constructor(amount, currency = 'USD') {
    super();
    if (typeof amount !== 'number' || isNaN(amount) || amount < 0) {
      throw new Error('Money amount must be a non-negative number');
    }
    this.amount = Math.round(amount * 100) / 100;
    this.currency = String(currency).toUpperCase();
    Object.freeze(this);
  }

  add(other) {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: cannot add ${other.currency} to ${this.currency}`);
    }
    return new Money(this.amount + other.amount, this.currency);
  }

  subtract(other) {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: cannot subtract ${other.currency} from ${this.currency}`);
    }
    if (this.amount < other.amount) {
      throw new Error('Insufficient funds: result would be negative');
    }
    return new Money(this.amount - other.amount, this.currency);
  }

  multiply(multiplier) {
    if (typeof multiplier !== 'number' || multiplier < 0) {
      throw new Error('Multiplier must be a non-negative number');
    }
    return new Money(this.amount * multiplier, this.currency);
  }

  format() {
    return `${this.currency} ${this.amount.toFixed(2)}`;
  }
}

class EmailAddress extends ValueObject {
  constructor(value) {
    super();
    const normalized = String(value || '').trim().toLowerCase();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(normalized)) {
      throw new Error(`Invalid email address format: '${value}'`);
    }
    this.value = normalized;
    this.domain = normalized.split('@')[1];
    Object.freeze(this);
  }
}

class PhoneNumber extends ValueObject {
  constructor(value) {
    super();
    const sanitized = String(value || '').replace(/[^0-9+]/g, '');
    if (sanitized.length < 7 || sanitized.length > 15) {
      throw new Error(`Invalid phone number format: '${value}'`);
    }
    this.value = sanitized;
    Object.freeze(this);
  }
}

class SkuCode extends ValueObject {
  constructor(value) {
    super();
    const sanitized = String(value || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,30}$/.test(sanitized)) {
      throw new Error(`Invalid SKU code: '${value}'. Must be alphanumeric and 3-30 chars`);
    }
    this.value = sanitized;
    Object.freeze(this);
  }
}

class DateRange extends ValueObject {
  constructor(startDate, endDate) {
    super();
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error('Invalid dates provided for DateRange');
    }
    if (start > end) {
      throw new Error('DateRange start date cannot be after end date');
    }
    this.startDate = start.toISOString();
    this.endDate = end.toISOString();
    this.durationMs = end.getTime() - start.getTime();
    this.durationDays = Math.ceil(this.durationMs / (1000 * 60 * 60 * 24));
    Object.freeze(this);
  }

  contains(date) {
    const target = new Date(date).getTime();
    return target >= new Date(this.startDate).getTime() && target <= new Date(this.endDate).getTime();
  }
}

module.exports = {
  ValueObject,
  Money,
  EmailAddress,
  PhoneNumber,
  SkuCode,
  DateRange
};

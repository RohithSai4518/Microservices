/**
 * PaymentAuthorizedEvent - Domain Event
 * Immutable event record emitted during state transitions.
 */
class PaymentAuthorizedEvent {
  constructor(payload = {}, metadata = {}) {
    this.eventName = 'PaymentAuthorizedEvent';
    this.domain = 'payment';
    this.payload = payload;
    this.metadata = metadata;
    this.occurredAt = new Date().toISOString();
  }

  toJSON() {
    return {
      eventName: this.eventName,
      domain: this.domain,
      payload: this.payload,
      metadata: this.metadata,
      occurredAt: this.occurredAt
    };
  }
}

module.exports = { PaymentAuthorizedEvent };

/**
 * OrderConfirmedEvent - Domain Event
 * Immutable event record emitted during state transitions.
 */
class OrderConfirmedEvent {
  constructor(payload = {}, metadata = {}) {
    this.eventName = 'OrderConfirmedEvent';
    this.domain = 'order';
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

module.exports = { OrderConfirmedEvent };

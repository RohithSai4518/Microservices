/**
 * MetricAggregatedEvent - Domain Event
 * Immutable event record emitted during state transitions.
 */
class MetricAggregatedEvent {
  constructor(payload = {}, metadata = {}) {
    this.eventName = 'MetricAggregatedEvent';
    this.domain = 'analytics';
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

module.exports = { MetricAggregatedEvent };

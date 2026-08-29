/**
 * Enterprise Event Sourcing & Snapshot Engine
 * Reconstitutes aggregate state by replaying historical domain event streams.
 */
const { DocumentStore } = require('../../../shared/storage');

class EventSourcingEngine {
  constructor(streamName, options = {}) {
    this.streamName = streamName;
    this.eventStore = new DocumentStore(`events_${streamName}`, options);
    this.snapshotStore = new DocumentStore(`snapshots_${streamName}`, options);
    this.snapshotThreshold = options.snapshotThreshold || 10;
  }

  async appendEvents(aggregateId, events = [], expectedVersion = null) {
    const records = [];
    let currentVersion = expectedVersion !== null ? expectedVersion : 0;

    for (const event of events) {
      currentVersion++;
      const record = {
        aggregateId,
        streamName: this.streamName,
        version: currentVersion,
        eventName: event.eventName || event.constructor.name,
        payload: event.payload || event,
        timestamp: new Date().toISOString()
      };
      await this.eventStore.insert(record);
      records.push(record);
    }

    // Check if snapshot needed
    if (currentVersion % this.snapshotThreshold === 0) {
      await this.saveSnapshot(aggregateId, currentVersion, events[events.length - 1]);
    }

    return records;
  }

  async getEvents(aggregateId, fromVersion = 0) {
    const all = await this.eventStore.find({ aggregateId });
    return all
      .filter(e => e.version > fromVersion)
      .sort((a, b) => a.version - b.version);
  }

  async saveSnapshot(aggregateId, version, state) {
    const snapshot = {
      aggregateId,
      version,
      state: JSON.parse(JSON.stringify(state)),
      snapshotAt: new Date().toISOString()
    };
    const existing = await this.snapshotStore.findOne({ aggregateId });
    if (existing) {
      return this.snapshotStore.updateById(existing.id, snapshot);
    }
    return this.snapshotStore.insert(snapshot);
  }

  async getLatestSnapshot(aggregateId) {
    return this.snapshotStore.findOne({ aggregateId });
  }

  async rehydrate(aggregateId, AggregateClass) {
    const snapshot = await this.getLatestSnapshot(aggregateId);
    let aggregate = new AggregateClass({ id: aggregateId });
    let fromVersion = 0;

    if (snapshot) {
      aggregate = Object.assign(aggregate, snapshot.state);
      fromVersion = snapshot.version;
    }

    const events = await this.getEvents(aggregateId, fromVersion);
    for (const event of events) {
      const applyMethod = `apply${event.eventName}`;
      if (typeof aggregate[applyMethod] === 'function') {
        aggregate[applyMethod](event.payload);
      }
    }

    return aggregate;
  }
}

module.exports = { EventSourcingEngine };

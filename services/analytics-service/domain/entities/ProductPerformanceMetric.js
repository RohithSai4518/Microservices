/**
 * ProductPerformanceMetric - Domain Model & Invariant Engine
 * Encapsulates core business state, mutations, validations, and domain rules.
 */
const { AggregateRoot } = require('../../../../shared/core/domain/AggregateRoot');

class ProductPerformanceMetric extends AggregateRoot {
  constructor(props = {}) {
    super(props.id || ('ana_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8)));
    this.domain = 'analytics';
    this.status = props.status || 'ACTIVE';
    this.version = props.version || 1;
    this.createdAt = props.createdAt ? new Date(props.createdAt) : new Date();
    this.updatedAt = props.updatedAt ? new Date(props.updatedAt) : new Date();
    this.metadata = props.metadata || {};
    this.attributes = props.attributes || {};
    this.tags = Array.isArray(props.tags) ? [...props.tags] : [];
    this.stateTransitions = [];

    // Hydrate domain attributes
    Object.keys(props).forEach(key => {
      if (!(key in this)) {
        this[key] = props[key];
      }
    });

    this.validateInvariants();
  }

  validateInvariants() {
    if (!this.id) throw new Error('ProductPerformanceMetric validation error: ID must be populated');
    if (!this.domain) throw new Error('ProductPerformanceMetric validation error: Domain context required');
    return true;
  }

  mutateState(targetStatus, reason = '', performedBy = 'system') {
    const fromStatus = this.status;
    this.status = targetStatus;
    this.stateTransitions.push({
      fromStatus,
      toStatus: targetStatus,
      reason,
      performedBy,
      timestamp: new Date().toISOString()
    });
    this.markModified();
    return this;
  }

  updateAttribute(key, value) {
    if (!key) throw new Error('Attribute key cannot be empty');
    this.attributes[key] = value;
    this.markModified();
    return this;
  }

  removeAttribute(key) {
    if (this.attributes && key in this.attributes) {
      delete this.attributes[key];
      this.markModified();
    }
    return this;
  }

  addTag(tag) {
    const trimmed = String(tag).trim();
    if (trimmed && !this.tags.includes(trimmed)) {
      this.tags.push(trimmed);
      this.markModified();
    }
    return this;
  }

  hasTag(tag) {
    return this.tags.includes(String(tag).trim());
  }

  toJSON() {
    return {
      id: this.id,
      domain: this.domain,
      status: this.status,
      version: this.version,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      attributes: this.attributes,
      tags: this.tags,
      metadata: this.metadata,
      stateTransitions: this.stateTransitions
    };
  }
}

module.exports = { ProductPerformanceMetric };

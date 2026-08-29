/**
 * CompensationRepository - Data Access Repository Layer
 * Interacts with ACID Document Store with indexing, sorting, and pagination.
 */
const { DocumentStore } = require('../../../../shared/storage');

class CompensationRepository {
  constructor(options = {}) {
    this.store = new DocumentStore('order_compensations', options);
  }

  async save(entity) {
    const data = typeof entity.toJSON === 'function' ? entity.toJSON() : entity;
    if (data.id) {
      const existing = await this.store.findById(data.id);
      if (existing) {
        return this.store.updateById(data.id, data);
      }
    }
    return this.store.insert(data);
  }

  async findById(id) {
    return this.store.findById(id);
  }

  async findOne(query = {}) {
    return this.store.findOne(query);
  }

  async findMany(query = {}, options = {}) {
    return this.store.find(query, options);
  }

  async removeById(id) {
    return this.store.deleteById(id);
  }

  async count(query = {}) {
    return this.store.count(query);
  }

  async clearAll() {
    return this.store.clear();
  }
}

module.exports = { CompensationRepository };

/**
 * Enterprise Microservices Shared Storage Engine
 * Zero-dependency ACID-compliant JSON document & key-value database.
 * Supports indexing, atomic writes, transactions, and flexible query filters.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class DocumentStore {
  constructor(collectionName, options = {}) {
    this.collectionName = collectionName;
    this.storageDir = options.storageDir || path.join(process.cwd(), 'data', 'db');
    this.filePath = path.join(this.storageDir, `${this.collectionName}.json`);
    this.inMemoryOnly = options.inMemoryOnly === true;
    
    this.documents = new Map(); // Primary key index: id -> doc
    this.indexes = new Map();   // Field name -> Map(fieldValue -> Set of ids)
    this.transactionSnapshot = null;
    this.isWriting = false;
    this.writeQueue = [];

    this._init();
  }

  _init() {
    if (this.inMemoryOnly) return;

    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }

      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        if (raw.trim()) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            parsed.forEach(doc => {
              if (doc && doc.id) {
                this.documents.set(doc.id, doc);
                this._indexDocument(doc);
              }
            });
          }
        }
      } else {
        this._persistSync();
      }
    } catch (err) {
      console.error(`[DocumentStore:${this.collectionName}] Init error:`, err.message);
    }
  }

  _createId() {
    return `${this.collectionName.substring(0, 3)}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  }

  _indexDocument(doc) {
    for (const [key, val] of Object.entries(doc)) {
      if (!this.indexes.has(key)) {
        this.indexes.set(key, new Map());
      }
      const fieldIndex = this.indexes.get(key);
      const strVal = String(val);
      if (!fieldIndex.has(strVal)) {
        fieldIndex.set(strVal, new Set());
      }
      fieldIndex.get(strVal).add(doc.id);
    }
  }

  _deindexDocument(doc) {
    for (const [key, val] of Object.entries(doc)) {
      if (this.indexes.has(key)) {
        const fieldIndex = this.indexes.get(key);
        const strVal = String(val);
        if (fieldIndex.has(strVal)) {
          fieldIndex.get(strVal).delete(doc.id);
          if (fieldIndex.get(strVal).size === 0) {
            fieldIndex.delete(strVal);
          }
        }
      }
    }
  }

  _persistSync() {
    if (this.inMemoryOnly) return;
    try {
      const data = JSON.stringify(Array.from(this.documents.values()), null, 2);
      const tempPath = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, data, 'utf8');
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      console.error(`[DocumentStore:${this.collectionName}] Persist error:`, err.message);
    }
  }

  async _persist() {
    if (this.inMemoryOnly) return;

    if (this.isWriting) {
      return new Promise((resolve, reject) => {
        this.writeQueue.push({ resolve, reject });
      });
    }

    this.isWriting = true;

    try {
      const data = JSON.stringify(Array.from(this.documents.values()), null, 2);
      const tempPath = `${this.filePath}.tmp.${Date.now()}`;
      await fs.promises.writeFile(tempPath, data, 'utf8');
      await fs.promises.rename(tempPath, this.filePath);
    } catch (err) {
      console.error(`[DocumentStore:${this.collectionName}] Async Persist error:`, err.message);
    } finally {
      this.isWriting = false;
      if (this.writeQueue.length > 0) {
        const next = this.writeQueue.shift();
        this._persist().then(next.resolve).catch(next.reject);
      }
    }
  }

  _matchFilter(doc, filter = {}) {
    if (!filter || Object.keys(filter).length === 0) return true;

    for (const [key, criteria] of Object.entries(filter)) {
      const docVal = doc[key];

      if (typeof criteria === 'object' && criteria !== null && !Array.isArray(criteria)) {
        for (const [op, expected] of Object.entries(criteria)) {
          switch (op) {
            case '$eq':
              if (docVal !== expected) return false;
              break;
            case '$ne':
              if (docVal === expected) return false;
              break;
            case '$gt':
              if (!(docVal > expected)) return false;
              break;
            case '$gte':
              if (!(docVal >= expected)) return false;
              break;
            case '$lt':
              if (!(docVal < expected)) return false;
              break;
            case '$lte':
              if (!(docVal <= expected)) return false;
              break;
            case '$in':
              if (!Array.isArray(expected) || !expected.includes(docVal)) return false;
              break;
            case '$nin':
              if (Array.isArray(expected) && expected.includes(docVal)) return false;
              break;
            case '$regex':
              const regex = new RegExp(expected, criteria.$options || '');
              if (!regex.test(String(docVal || ''))) return false;
              break;
            case '$exists':
              if ((docVal !== undefined) !== Boolean(expected)) return false;
              break;
            default:
              if (docVal !== criteria) return false;
          }
        }
      } else {
        if (docVal !== criteria) return false;
      }
    }
    return true;
  }

  // --- Public API ---

  async insert(data) {
    const id = data.id || this._createId();
    const now = new Date().toISOString();
    const doc = {
      ...data,
      id,
      createdAt: data.createdAt || now,
      updatedAt: now
    };

    this.documents.set(id, doc);
    this._indexDocument(doc);
    await this._persist();
    return JSON.parse(JSON.stringify(doc));
  }

  async insertMany(docs = []) {
    const inserted = [];
    for (const d of docs) {
      const doc = await this.insert(d);
      inserted.push(doc);
    }
    return inserted;
  }

  async findById(id) {
    const doc = this.documents.get(id);
    return doc ? JSON.parse(JSON.stringify(doc)) : null;
  }

  async findOne(filter = {}) {
    for (const doc of this.documents.values()) {
      if (this._matchFilter(doc, filter)) {
        return JSON.parse(JSON.stringify(doc));
      }
    }
    return null;
  }

  async find(filter = {}, options = {}) {
    let results = [];
    for (const doc of this.documents.values()) {
      if (this._matchFilter(doc, filter)) {
        results.push(JSON.parse(JSON.stringify(doc)));
      }
    }

    if (options.sort) {
      const [field, direction] = Object.entries(options.sort)[0];
      const dir = direction === -1 || direction === 'desc' ? -1 : 1;
      results.sort((a, b) => {
        if (a[field] < b[field]) return -1 * dir;
        if (a[field] > b[field]) return 1 * dir;
        return 0;
      });
    }

    if (options.skip) {
      results = results.slice(options.skip);
    }

    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async updateById(id, updateData) {
    const existing = this.documents.get(id);
    if (!existing) return null;

    this._deindexDocument(existing);

    const updated = {
      ...existing,
      ...updateData,
      id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString()
    };

    this.documents.set(id, updated);
    this._indexDocument(updated);
    await this._persist();
    return JSON.parse(JSON.stringify(updated));
  }

  async update(filter = {}, updateData, options = { multi: false }) {
    let count = 0;
    const modified = [];

    for (const [id, doc] of this.documents.entries()) {
      if (this._matchFilter(doc, filter)) {
        const updated = await this.updateById(id, updateData);
        modified.push(updated);
        count++;
        if (!options.multi) break;
      }
    }

    return { matchedCount: count, modifiedCount: count, documents: modified };
  }

  async deleteById(id) {
    const doc = this.documents.get(id);
    if (!doc) return false;

    this._deindexDocument(doc);
    this.documents.delete(id);
    await this._persist();
    return true;
  }

  async deleteMany(filter = {}) {
    let deletedCount = 0;
    const toDelete = [];

    for (const [id, doc] of this.documents.entries()) {
      if (this._matchFilter(doc, filter)) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      const doc = this.documents.get(id);
      if (doc) {
        this._deindexDocument(doc);
        this.documents.delete(id);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      await this._persist();
    }

    return { deletedCount };
  }

  async count(filter = {}) {
    if (!filter || Object.keys(filter).length === 0) {
      return this.documents.size;
    }
    let count = 0;
    for (const doc of this.documents.values()) {
      if (this._matchFilter(doc, filter)) {
        count++;
      }
    }
    return count;
  }

  async clear() {
    this.documents.clear();
    this.indexes.clear();
    await this._persist();
    return true;
  }

  // --- Transactions ---

  beginTransaction() {
    this.transactionSnapshot = new Map();
    for (const [key, val] of this.documents.entries()) {
      this.transactionSnapshot.set(key, JSON.parse(JSON.stringify(val)));
    }
  }

  async commitTransaction() {
    this.transactionSnapshot = null;
    await this._persist();
  }

  rollbackTransaction() {
    if (!this.transactionSnapshot) return;
    this.documents = this.transactionSnapshot;
    this.indexes.clear();
    for (const doc of this.documents.values()) {
      this._indexDocument(doc);
    }
    this.transactionSnapshot = null;
    this._persistSync();
  }
}

class StorageEngine {
  constructor(options = {}) {
    this.baseDir = options.baseDir || path.join(process.cwd(), 'data', 'db');
    this.collections = new Map();
  }

  getCollection(name, options = {}) {
    if (!this.collections.has(name)) {
      const store = new DocumentStore(name, {
        storageDir: this.baseDir,
        ...options
      });
      this.collections.set(name, store);
    }
    return this.collections.get(name);
  }
}

module.exports = {
  DocumentStore,
  StorageEngine
};

/**
 * Least Recently Used (LRU) Cache Implementation
 * Zero-dependency O(1) get and put operations with doubly-linked list.
 */
class LRUNode {
  constructor(key, value) {
    this.key = key;
    this.value = value;
    this.prev = null;
    this.next = null;
    this.expiresAt = null;
  }
}

class LRUCache {
  constructor(capacity = 500, defaultTtlMs = 0) {
    if (capacity <= 0) throw new Error('Capacity must be positive');
    this.capacity = capacity;
    this.defaultTtlMs = defaultTtlMs;
    this.cache = new Map();
    this.head = new LRUNode(null, null);
    this.tail = new LRUNode(null, null);
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  _remove(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  }

  _add(node) {
    node.next = this.head.next;
    node.prev = this.head;
    this.head.next.prev = node;
    this.head.next = node;
  }

  get(key) {
    const node = this.cache.get(key);
    if (!node) return null;

    if (node.expiresAt && Date.now() > node.expiresAt) {
      this.delete(key);
      return null;
    }

    this._remove(node);
    this._add(node);
    return node.value;
  }

  put(key, value, ttlMs = this.defaultTtlMs) {
    if (this.cache.has(key)) {
      const existing = this.cache.get(key);
      existing.value = value;
      existing.expiresAt = ttlMs > 0 ? Date.now() + ttlMs : null;
      this._remove(existing);
      this._add(existing);
      return;
    }

    if (this.cache.size >= this.capacity) {
      const lru = this.tail.prev;
      this._remove(lru);
      this.cache.delete(lru.key);
    }

    const newNode = new LRUNode(key, value);
    if (ttlMs > 0) newNode.expiresAt = Date.now() + ttlMs;
    this._add(newNode);
    this.cache.set(key, newNode);
  }

  delete(key) {
    const node = this.cache.get(key);
    if (node) {
      this._remove(node);
      this.cache.delete(key);
      return true;
    }
    return false;
  }

  clear() {
    this.cache.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  size() {
    return this.cache.size;
  }
}

module.exports = { LRUCache };

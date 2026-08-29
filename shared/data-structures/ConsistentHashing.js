/**
 * Consistent Hash Ring for Distributed Partitioning and Load Balancing
 */
const crypto = require('crypto');

class ConsistentHashRing {
  constructor(replicas = 100) {
    this.replicas = replicas;
    this.ring = new Map(); // hash -> nodeKey
    this.sortedKeys = [];
    this.nodes = new Set();
  }

  _hash(key) {
    const hash = crypto.createHash('md5').update(key).digest('hex');
    return parseInt(hash.substring(0, 8), 16);
  }

  addNode(nodeKey) {
    this.nodes.add(nodeKey);
    for (let i = 0; i < this.replicas; i++) {
      const vNodeKey = `${nodeKey}#${i}`;
      const hash = this._hash(vNodeKey);
      this.ring.set(hash, nodeKey);
      this.sortedKeys.push(hash);
    }
    this.sortedKeys.sort((a, b) => a - b);
  }

  removeNode(nodeKey) {
    this.nodes.delete(nodeKey);
    for (let i = 0; i < this.replicas; i++) {
      const vNodeKey = `${nodeKey}#${i}`;
      const hash = this._hash(vNodeKey);
      this.ring.delete(hash);
    }
    this.sortedKeys = Array.from(this.ring.keys()).sort((a, b) => a - b);
  }

  getNode(resourceKey) {
    if (this.sortedKeys.length === 0) return null;
    const hash = this._hash(resourceKey);

    // Binary search for closest virtual node
    let low = 0;
    let high = this.sortedKeys.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.sortedKeys[mid] >= hash) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    const targetIdx = low === this.sortedKeys.length ? 0 : low;
    const targetHash = this.sortedKeys[targetIdx];
    return this.ring.get(targetHash);
  }
}

module.exports = { ConsistentHashRing };

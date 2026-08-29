/**
 * Probabilistic Bloom Filter
 * Efficient set membership testing with low false-positive probability.
 */
class BloomFilter {
  constructor(size = 1024 * 8, hashCount = 4) {
    this.size = size;
    this.hashCount = hashCount;
    this.bitArray = new Uint8Array(Math.ceil(size / 8));
  }

  _hash(str, seed) {
    let hash = seed;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(hash) % this.size;
  }

  add(item) {
    const str = String(item);
    for (let i = 0; i < this.hashCount; i++) {
      const idx = this._hash(str, i * 7 + 13);
      const byteIdx = Math.floor(idx / 8);
      const bitOffset = idx % 8;
      this.bitArray[byteIdx] |= (1 << bitOffset);
    }
  }

  has(item) {
    const str = String(item);
    for (let i = 0; i < this.hashCount; i++) {
      const idx = this._hash(str, i * 7 + 13);
      const byteIdx = Math.floor(idx / 8);
      const bitOffset = idx % 8;
      if (!(this.bitArray[byteIdx] & (1 << bitOffset))) {
        return false;
      }
    }
    return true;
  }
}

module.exports = { BloomFilter };

/**
 * Performance & Operational Metrics Collector (Counter, Gauge, Histogram)
 */
class Counter {
  constructor(name, help = '') {
    this.name = name;
    this.help = help;
    this.value = 0;
    this.labels = new Map();
  }

  inc(val = 1, labelMap = {}) {
    const key = JSON.stringify(labelMap);
    const curr = this.labels.get(key) || 0;
    this.labels.set(key, curr + val);
    this.value += val;
  }

  get() {
    return this.value;
  }
}

class Gauge {
  constructor(name, help = '') {
    this.name = name;
    this.help = help;
    this.value = 0;
  }

  set(val) {
    this.value = val;
  }

  inc(val = 1) {
    this.value += val;
  }

  dec(val = 1) {
    this.value -= val;
  }

  get() {
    return this.value;
  }
}

class Histogram {
  constructor(name, help = '', buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]) {
    this.name = name;
    this.help = help;
    this.buckets = buckets.sort((a, b) => a - b);
    this.bucketCounts = new Array(this.buckets.length).fill(0);
    this.count = 0;
    this.sum = 0;
  }

  observe(val) {
    this.count++;
    this.sum += val;
    for (let i = 0; i < this.buckets.length; i++) {
      if (val <= this.buckets[i]) {
        this.bucketCounts[i]++;
      }
    }
  }

  getSummary() {
    return {
      name: this.name,
      count: this.count,
      sum: this.sum,
      average: this.count > 0 ? this.sum / this.count : 0,
      buckets: this.buckets.map((b, i) => ({ le: b, count: this.bucketCounts[i] }))
    };
  }
}

class MetricsRegistry {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
  }

  counter(name, help) {
    if (!this.counters.has(name)) {
      this.counters.set(name, new Counter(name, help));
    }
    return this.counters.get(name);
  }

  gauge(name, help) {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, new Gauge(name, help));
    }
    return this.gauges.get(name);
  }

  histogram(name, help, buckets) {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, new Histogram(name, help, buckets));
    }
    return this.histograms.get(name);
  }

  exportMetrics() {
    const res = {
      timestamp: new Date().toISOString(),
      counters: {},
      gauges: {},
      histograms: {}
    };

    for (const [name, c] of this.counters.entries()) {
      res.counters[name] = c.get();
    }
    for (const [name, g] of this.gauges.entries()) {
      res.gauges[name] = g.get();
    }
    for (const [name, h] of this.histograms.entries()) {
      res.histograms[name] = h.getSummary();
    }

    return res;
  }
}

module.exports = { Counter, Gauge, Histogram, MetricsRegistry };

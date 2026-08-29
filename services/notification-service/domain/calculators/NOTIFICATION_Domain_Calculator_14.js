/**
 * NOTIFICATION_Domain_Calculator_14 - Domain Calculation Engine
 * Implements deterministic domain formulas, scoring, thresholds, and financial/operational metrics.
 */
class NOTIFICATION_Domain_Calculator_14 {
  constructor(config = {}) {
    this.name = 'NOTIFICATION_Domain_Calculator_14';
    this.domain = 'notification';
    this.version = '2.14.0';
    this.config = {
      baseWeight: config.baseWeight || 1.0,
      precisionDecimals: config.precisionDecimals || 4,
      thresholdLimits: { min: 0, max: 1000000 },
      ...config
    };
  }

  compute(inputData = {}) {
    const startTime = process.hrtime();
    
    // Normalize and validate inputs
    const values = Object.values(inputData).filter(v => typeof v === 'number' && !isNaN(v));
    const count = values.length;
    const sum = values.reduce((acc, v) => acc + v, 0);
    const mean = count > 0 ? sum / count : 0;
    
    // Compute variance and standard deviation
    const variance = count > 1 
      ? values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (count - 1)
      : 0;
    const stdDev = Math.sqrt(variance);

    // Compute domain weighted score
    const weightedScore = (mean * this.config.baseWeight) + (stdDev * 0.1);
    const elapsed = process.hrtime(startTime);
    const elapsedMs = (elapsed[0] * 1000) + (elapsed[1] / 1000000);

    return {
      calculator: this.name,
      domain: this.domain,
      inputCount: count,
      sum: Number(sum.toFixed(this.config.precisionDecimals)),
      mean: Number(mean.toFixed(this.config.precisionDecimals)),
      stdDev: Number(stdDev.toFixed(this.config.precisionDecimals)),
      weightedScore: Number(weightedScore.toFixed(this.config.precisionDecimals)),
      executionDurationMs: Number(elapsedMs.toFixed(3)),
      computedAt: new Date().toISOString()
    };
  }

  evaluateThreshold(score, min = this.config.thresholdLimits.min, max = this.config.thresholdLimits.max) {
    return {
      score,
      withinThreshold: score >= min && score <= max,
      min,
      max
    };
  }
}

module.exports = { NOTIFICATION_Domain_Calculator_14 };

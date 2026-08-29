/**
 * ChargePaymentDto - Data Transfer Object
 * Strict data contract for ingress and egress serialization.
 */
class ChargePaymentDto {
  constructor(data = {}) {
    this.payload = data;
    this.receivedAt = new Date().toISOString();
  }

  static fromRequest(reqBody = {}) {
    return new ChargePaymentDto(reqBody);
  }

  validate() {
    const errors = [];
    if (!this.payload || typeof this.payload !== 'object') {
      errors.push('ChargePaymentDto payload must be an object');
    }
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  toData() {
    return { ...this.payload };
  }
}

module.exports = { ChargePaymentDto };

/**
 * UpdatePreferenceDto - Data Transfer Object
 * Strict data contract for ingress and egress serialization.
 */
class UpdatePreferenceDto {
  constructor(data = {}) {
    this.payload = data;
    this.receivedAt = new Date().toISOString();
  }

  static fromRequest(reqBody = {}) {
    return new UpdatePreferenceDto(reqBody);
  }

  validate() {
    const errors = [];
    if (!this.payload || typeof this.payload !== 'object') {
      errors.push('UpdatePreferenceDto payload must be an object');
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

module.exports = { UpdatePreferenceDto };

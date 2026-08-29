/**
 * SendNotificationDto - Data Transfer Object
 * Strict data contract for ingress and egress serialization.
 */
class SendNotificationDto {
  constructor(data = {}) {
    this.payload = data;
    this.receivedAt = new Date().toISOString();
  }

  static fromRequest(reqBody = {}) {
    return new SendNotificationDto(reqBody);
  }

  validate() {
    const errors = [];
    if (!this.payload || typeof this.payload !== 'object') {
      errors.push('SendNotificationDto payload must be an object');
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

module.exports = { SendNotificationDto };

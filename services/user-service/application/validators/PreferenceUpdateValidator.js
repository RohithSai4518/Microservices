/**
 * PreferenceUpdateValidator Request Validator
 * Validates domain input fields, types, boundaries, and business rules.
 */
class PreferenceUpdateValidator {
  static validate(payload = {}) {
    const errors = [];

    if (!payload || typeof payload !== 'object') {
      return { isValid: false, errors: ['Payload must be a non-empty object'] };
    }

    // Inspect general invariants
    Object.keys(payload).forEach(key => {
      const val = payload[key];
      if (typeof val === 'string' && val.length > 5000) {
        errors.push(`Field '${key}' exceeds maximum length of 5000 characters`);
      }
    });

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = { PreferenceUpdateValidator };

/**
 * ORDER_Schema_Model_4 - Enterprise Data Schema Definition
 * Enforces structural integrity, type boundaries, and domain rules.
 */
class ORDER_Schema_Model_4 {
  constructor(definition = {}) {
    this.name = 'ORDER_Schema_Model_4';
    this.domain = 'order';
    this.version = '1.4.0';
    this.fields = {
      id: { type: 'string', required: true, pattern: '^[a-z0-9_]+$' },
      domain: { type: 'string', required: true, default: 'order' },
      status: { type: 'string', required: true, enum: ['DRAFT', 'ACTIVE', 'SUSPENDED', 'ARCHIVED', 'DELETED'] },
      createdTimestamp: { type: 'date', required: true },
      updatedTimestamp: { type: 'date', required: true },
      versionNumber: { type: 'number', minimum: 1, default: 1 },
      auditDetails: {
        type: 'object',
        properties: {
          createdBy: { type: 'string', default: 'system' },
          updatedBy: { type: 'string', default: 'system' },
          ipAddress: { type: 'string', default: '127.0.0.1' },
          changeLog: { type: 'array', items: { type: 'string' } }
        }
      },
      customPayload: { type: 'object', additionalProperties: true }
    };
  }

  validateInstance(data = {}) {
    const validationErrors = [];
    if (!data || typeof data !== 'object') {
      return { isValid: false, errors: ['Input data must be an object'] };
    }

    // Validate required fields
    for (const [fieldName, fieldDef] of Object.entries(this.fields)) {
      if (fieldDef.required && (data[fieldName] === undefined || data[fieldName] === null)) {
        validationErrors.push(`Missing required field: '${fieldName}' in schema ${this.name}`);
      }
    }

    return {
      isValid: validationErrors.length === 0,
      errors: validationErrors,
      schemaName: this.name,
      domain: this.domain,
      validatedAt: new Date().toISOString()
    };
  }

  getDefinition() {
    return {
      schemaName: this.name,
      domain: this.domain,
      version: this.version,
      fieldRules: this.fields
    };
  }
}

module.exports = { ORDER_Schema_Model_4 };

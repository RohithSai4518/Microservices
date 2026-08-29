/**
 * Zero-dependency Query Builder and Filter Expression Engine
 */
class QueryBuilder {
  constructor(collectionName) {
    this.collectionName = collectionName;
    this.criteria = {};
    this.sortFields = {};
    this.limitCount = null;
    this.skipCount = 0;
    this.projections = [];
  }

  where(field, operator, value) {
    if (value === undefined) {
      this.criteria[field] = operator;
      return this;
    }
    switch (operator) {
      case '=':
      case 'eq':
        this.criteria[field] = { $eq: value };
        break;
      case '!=':
      case 'ne':
        this.criteria[field] = { $ne: value };
        break;
      case '>':
      case 'gt':
        this.criteria[field] = { $gt: value };
        break;
      case '>=':
      case 'gte':
        this.criteria[field] = { $gte: value };
        break;
      case '<':
      case 'lt':
        this.criteria[field] = { $lt: value };
        break;
      case '<=':
      case 'lte':
        this.criteria[field] = { $lte: value };
        break;
      case 'in':
        this.criteria[field] = { $in: Array.isArray(value) ? value : [value] };
        break;
      case 'nin':
        this.criteria[field] = { $nin: Array.isArray(value) ? value : [value] };
        break;
      case 'like':
      case 'regex':
        this.criteria[field] = { $regex: value, $options: 'i' };
        break;
      default:
        this.criteria[field] = value;
    }
    return this;
  }

  andWhere(field, operator, value) {
    return this.where(field, operator, value);
  }

  orderBy(field, direction = 'ASC') {
    const dir = direction.toUpperCase() === 'DESC' ? -1 : 1;
    this.sortFields[field] = dir;
    return this;
  }

  limit(count) {
    this.limitCount = parseInt(count, 10);
    return this;
  }

  offset(count) {
    this.skipCount = parseInt(count, 10);
    return this;
  }

  select(...fields) {
    this.projections = fields.flat();
    return this;
  }

  build() {
    return {
      criteria: this.criteria,
      options: {
        sort: Object.keys(this.sortFields).length > 0 ? this.sortFields : undefined,
        limit: this.limitCount,
        skip: this.skipCount,
        projections: this.projections.length > 0 ? this.projections : undefined
      }
    };
  }
}

module.exports = { QueryBuilder };

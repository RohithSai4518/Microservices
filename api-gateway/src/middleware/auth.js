/**
 * Enterprise Microservices API Gateway - Auth Guard Middleware
 * Zero-dependency JWT authentication and Role-Based Access Control (RBAC).
 */

const { JwtUtil } = require('../../../shared/security');
const { UnauthorizedError, ForbiddenError } = require('../../../shared/errors');

function authGuard(requiredRoles = []) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.error(new UnauthorizedError('Missing or malformed Authorization header'));
    }

    const token = authHeader.substring(7).trim();
    try {
      const payload = JwtUtil.verify(token);
      req.user = payload;

      // Role check if specific roles are required
      if (requiredRoles.length > 0) {
        const userRole = payload.role || 'user';
        if (!requiredRoles.includes(userRole) && userRole !== 'admin') {
          return res.error(new ForbiddenError(`Required role [${requiredRoles.join(', ')}] not held by user role [${userRole}]`));
        }
      }

      next();
    } catch (err) {
      return res.error(new UnauthorizedError(`Authentication failed: ${err.message}`));
    }
  };
}

module.exports = { authGuard };

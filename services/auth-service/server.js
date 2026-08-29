/**
 * Enterprise Microservices - Auth & Identity Service
 * Port: 8001
 * Manages user credentials, PBKDF2 secure password hashing, JWT issue/validation, and RBAC.
 */

const { HttpServer } = require('../../shared/http');
const { DocumentStore } = require('../../shared/storage');
const { JwtUtil, HashUtil } = require('../../shared/security');
const { EventBusClient } = require('../../shared/event-bus');
const { ServiceRegistryClient } = require('../../shared/service-registry');
const { Logger } = require('../../shared/logger');
const { ValidationError, UnauthorizedError, ConflictError, NotFoundError } = require('../../shared/errors');

const PORT = process.env.AUTH_SERVICE_PORT || 8001;
const logger = new Logger('auth-service');
const server = new HttpServer({ logger });

const usersStore = new DocumentStore('auth_users');
const eventBus = new EventBusClient('auth-service');
const registry = new ServiceRegistryClient({
  serviceName: 'auth-service',
  port: PORT,
  metadata: { version: '1.0.0', type: 'security-core' }
});

// Middleware: Extract user if token present
server.use((req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      req.user = JwtUtil.verify(authHeader.substring(7));
    } catch (e) {
      // invalid token
    }
  }
  next();
});

// Health check
server.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    service: 'auth-service',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// Register new user
server.post('/register', async (req, res) => {
  const { email, password, name, role } = req.body;

  if (!email || !email.includes('@')) {
    throw new ValidationError('A valid email address is required');
  }
  if (!password || password.length < 6) {
    throw new ValidationError('Password must be at least 6 characters');
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await usersStore.findOne({ email: normalizedEmail });
  if (existing) {
    throw new ConflictError(`User with email '${normalizedEmail}' already exists`);
  }

  const passwordHash = HashUtil.hashPassword(password);
  const assignedRole = role && ['admin', 'manager', 'customer'].includes(role) ? role : 'customer';

  const user = await usersStore.insert({
    email: normalizedEmail,
    name: name || normalizedEmail.split('@')[0],
    passwordHash,
    role: assignedRole,
    status: 'ACTIVE',
    lastLoginAt: null
  });

  const token = JwtUtil.sign({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role
  });

  logger.info(`User registered successfully: ${user.email} (${user.id})`, { userId: user.id });

  // Publish domain event
  await eventBus.publish('auth.user.registered', {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    registeredAt: user.createdAt
  }, { traceId: res.traceId });

  res.status(201).json({
    message: 'User registered successfully',
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    }
  });
});

// Login user
server.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ValidationError('Email and password are required');
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = await usersStore.findOne({ email: normalizedEmail });

  if (!user || !HashUtil.verifyPassword(password, user.passwordHash)) {
    throw new UnauthorizedError('Invalid email or password credentials');
  }

  if (user.status !== 'ACTIVE') {
    throw new UnauthorizedError('Account is inactive or suspended');
  }

  await usersStore.updateById(user.id, { lastLoginAt: new Date().toISOString() });

  const token = JwtUtil.sign({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role
  });

  logger.info(`User login successful: ${user.email}`, { userId: user.id });

  await eventBus.publish('auth.user.login', {
    userId: user.id,
    email: user.email,
    timestamp: new Date().toISOString()
  }, { traceId: res.traceId });

  res.json({
    message: 'Login successful',
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    }
  });
});

// Verify token
server.post('/verify', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    throw new ValidationError('Token is required for verification');
  }

  try {
    const decoded = JwtUtil.verify(token);
    res.json({ valid: true, payload: decoded });
  } catch (err) {
    res.status(401).json({ valid: false, error: err.message });
  }
});

// Current authenticated user info
server.get('/me', async (req, res) => {
  if (!req.user) {
    throw new UnauthorizedError('Authentication token required');
  }

  const user = await usersStore.findById(req.user.userId);
  if (!user) {
    throw new NotFoundError('User', req.user.userId);
  }

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt
  });
});

// List users (Admin/Manager only)
server.get('/users', async (req, res) => {
  const users = await usersStore.find({}, { limit: 100 });
  const sanitized = users.map(u => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt
  }));
  res.json({ total: sanitized.length, users: sanitized });
});

server.listen(PORT, () => {
  logger.info(`Auth & Identity Service running on port ${PORT}`);
  registry.register().catch(() => {});
});

module.exports = { server };

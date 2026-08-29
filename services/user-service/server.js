/**
 * Enterprise Microservices - User Management Service
 * Port: 8002
 * Manages rich customer profiles, address books, preferences, and profile sync.
 */

const { HttpServer } = require('../../shared/http');
const { DocumentStore } = require('../../shared/storage');
const { EventBusClient } = require('../../shared/event-bus');
const { ServiceRegistryClient } = require('../../shared/service-registry');
const { Logger } = require('../../shared/logger');
const { ValidationError, NotFoundError } = require('../../shared/errors');

const PORT = process.env.USER_SERVICE_PORT || 8002;
const logger = new Logger('user-service');
const server = new HttpServer({ logger });

const profilesStore = new DocumentStore('user_profiles');
const addressesStore = new DocumentStore('user_addresses');
const eventBus = new EventBusClient('user-service');
const registry = new ServiceRegistryClient({
  serviceName: 'user-service',
  port: PORT,
  metadata: { version: '1.0.0', type: 'domain-core' }
});

// Health check
server.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    service: 'user-service',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// Get user profile by userId or profile id
server.get('/profile/:userId', async (req, res) => {
  const { userId } = req.params;
  let profile = await profilesStore.findOne({ userId });

  if (!profile) {
    profile = await profilesStore.findById(userId);
  }

  if (!profile) {
    throw new NotFoundError('User Profile', userId);
  }

  const addresses = await addressesStore.find({ userId: profile.userId || userId });
  res.json({
    ...profile,
    addresses
  });
});

// Update user profile
server.put('/profile/:userId', async (req, res) => {
  const { userId } = req.params;
  const { name, phone, company, bio, preferences } = req.body;

  let profile = await profilesStore.findOne({ userId });
  if (!profile) {
    profile = await profilesStore.insert({
      userId,
      name: name || 'User',
      phone: phone || '',
      company: company || '',
      bio: bio || '',
      preferences: preferences || { currency: 'USD', theme: 'dark', emailNotifications: true }
    });
  } else {
    profile = await profilesStore.updateById(profile.id, {
      ...(name && { name }),
      ...(phone !== undefined && { phone }),
      ...(company !== undefined && { company }),
      ...(bio !== undefined && { bio }),
      ...(preferences && { preferences })
    });
  }

  logger.info(`Profile updated for user: ${userId}`);

  await eventBus.publish('user.profile.updated', {
    userId,
    profileId: profile.id,
    updatedFields: Object.keys(req.body)
  }, { traceId: res.traceId });

  res.json(profile);
});

// List all addresses for user
server.get('/addresses/:userId', async (req, res) => {
  const { userId } = req.params;
  const addresses = await addressesStore.find({ userId });
  res.json({ total: addresses.length, addresses });
});

// Add new address for user
server.post('/addresses/:userId', async (req, res) => {
  const { userId } = req.params;
  const { street, city, state, postalCode, country, isDefault, label } = req.body;

  if (!street || !city || !country) {
    throw new ValidationError('Street, city, and country are required');
  }

  if (isDefault) {
    // Unset other default addresses for this user
    const existing = await addressesStore.find({ userId, isDefault: true });
    for (const addr of existing) {
      await addressesStore.updateById(addr.id, { isDefault: false });
    }
  }

  const address = await addressesStore.insert({
    userId,
    label: label || 'Home',
    street,
    city,
    state: state || '',
    postalCode: postalCode || '',
    country,
    isDefault: Boolean(isDefault)
  });

  logger.info(`Address added for user ${userId}: ${address.id}`);

  await eventBus.publish('user.address.added', {
    userId,
    addressId: address.id,
    city,
    country
  }, { traceId: res.traceId });

  res.status(201).json(address);
});

// Webhook listener for async event bus integration
server.post('/events/webhook', async (req, res) => {
  const event = req.body;
  if (!event || !event.topic) {
    return res.status(400).json({ error: 'Invalid event' });
  }

  logger.info(`Received event: ${event.topic}`, { eventId: event.id });

  if (event.topic === 'auth.user.registered') {
    const { userId, email, name } = event.payload;
    const existing = await profilesStore.findOne({ userId });
    if (!existing) {
      await profilesStore.insert({
        userId,
        email,
        name,
        phone: '',
        company: '',
        bio: 'Microservices Platform Customer',
        preferences: {
          currency: 'USD',
          theme: 'dark',
          emailNotifications: true,
          smsAlerts: false
        }
      });
      logger.info(`Default profile initialized for newly registered user: ${userId}`);
    }
  }

  res.json({ received: true });
});

// Search profiles
server.get('/search', async (req, res) => {
  const query = (req.query.q || '').toLowerCase();
  const profiles = await profilesStore.find({});
  const filtered = profiles.filter(p => 
    (p.name && p.name.toLowerCase().includes(query)) ||
    (p.email && p.email.toLowerCase().includes(query)) ||
    (p.company && p.company.toLowerCase().includes(query))
  );

  res.json({ total: filtered.length, profiles: filtered.slice(0, 50) });
});

server.listen(PORT, async () => {
  logger.info(`User Management Service running on port ${PORT}`);
  await registry.register().catch(() => {});
  // Subscribe to auth events
  await eventBus.registerWebhookSubscription('auth.user.registered', `http://localhost:${PORT}/events/webhook`);
});

module.exports = { server };

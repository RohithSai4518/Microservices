/**
 * Enterprise Microservices Synthetic Data Seeder
 * Generates initial rich, non-sensitive mock domain data for testing and demonstrations.
 */

const { DocumentStore } = require('../shared/storage');
const { HashUtil } = require('../shared/security');

async function seed() {
  console.log('[Seeder] Starting synthetic domain data seeding...');

  // 1. Seed Auth Users
  const authStore = new DocumentStore('auth_users');
  await authStore.clear();

  const admin = await authStore.insert({
    email: 'admin@microservices.local',
    name: 'System Admin',
    passwordHash: HashUtil.hashPassword('Admin@12345'),
    role: 'admin',
    status: 'ACTIVE',
    lastLoginAt: null
  });

  const customer1 = await authStore.insert({
    email: 'customer@microservices.local',
    name: 'Alex Johnson',
    passwordHash: HashUtil.hashPassword('Customer@12345'),
    role: 'customer',
    status: 'ACTIVE',
    lastLoginAt: null
  });

  console.log(`[Seeder] Auth users created: Admin (${admin.email}), Customer (${customer1.email})`);

  // 2. Seed User Profiles
  const profileStore = new DocumentStore('user_profiles');
  await profileStore.clear();

  await profileStore.insert({
    userId: customer1.id,
    email: customer1.email,
    name: customer1.name,
    phone: '+1 (555) 019-2834',
    company: 'Enterprise Solutions LLC',
    bio: 'Lead Cloud Architect & Developer',
    preferences: {
      currency: 'USD',
      theme: 'dark',
      emailNotifications: true,
      smsAlerts: false
    }
  });

  // 3. Seed Categories & Products
  const catStore = new DocumentStore('categories');
  const prodStore = new DocumentStore('products');
  const invStore = new DocumentStore('inventory_items');

  await catStore.clear();
  await prodStore.clear();
  await invStore.clear();

  const categories = [
    { name: 'Cloud Hardware', slug: 'cloud-hardware', description: 'Enterprise servers, networking, and rack units' },
    { name: 'Developer Tools', slug: 'developer-tools', description: 'Monitors, mechanical keyboards, ergonomic accessories' },
    { name: 'Security Keys', slug: 'security-keys', description: 'Hardware 2FA tokens and encryption keys' }
  ];

  for (const cat of categories) {
    await catStore.insert(cat);
  }

  const products = [
    {
      name: 'Titan Enterprise Server Node X8',
      sku: 'SKU-TITAN-X8',
      price: 2499.00,
      category: 'Cloud Hardware',
      description: '64-Core High Density Compute Blade with 256GB ECC RAM',
      stock: 35,
      tags: ['server', 'compute', 'datacenter']
    },
    {
      name: 'UltraWide 49" Curved Dev Monitor',
      sku: 'SKU-MON-49UW',
      price: 1099.99,
      category: 'Developer Tools',
      description: '144Hz 5K Dual-QHD IPS display for high productivity programming',
      stock: 45,
      tags: ['display', 'hardware', 'productivity']
    },
    {
      name: 'HHKB Pro Hybrid Silent Keyboard',
      sku: 'SKU-KEY-HHKB',
      price: 320.00,
      category: 'Developer Tools',
      description: 'Topre capacitive key switches with Bluetooth and USB-C connectivity',
      stock: 75,
      tags: ['keyboard', 'topre', 'accessories']
    },
    {
      name: 'YubiHSM 2 Hardware Security Module',
      sku: 'SKU-SEC-HSM2',
      price: 650.00,
      category: 'Security Keys',
      description: 'Miniature hardware security module for cryptographic key protection',
      stock: 120,
      tags: ['security', 'cryptography', 'auth']
    },
    {
      name: 'Mesh Gigabit Router Pro 6E',
      sku: 'SKU-NET-ROUTER',
      price: 299.50,
      category: 'Cloud Hardware',
      description: 'Tri-band Wi-Fi 6E mesh router with 10Gbps SFP+ uplink port',
      stock: 60,
      tags: ['networking', 'wifi', 'hardware']
    }
  ];

  for (const p of products) {
    const prod = await prodStore.insert(p);
    // Initialize corresponding inventory
    await invStore.insert({
      sku: prod.sku,
      availableStock: prod.stock,
      reservedStock: 0,
      totalStock: prod.stock,
      warehouse: 'MAIN-WAREHOUSE-1'
    });
  }

  console.log(`[Seeder] Seeded ${products.length} products and synchronized inventory records.`);
  console.log('[Seeder] Database seeding completed successfully.');
}

if (require.main === module) {
  seed().then(() => process.exit(0)).catch(err => {
    console.error('[Seeder] Error:', err);
    process.exit(1);
  });
}

module.exports = { seed };

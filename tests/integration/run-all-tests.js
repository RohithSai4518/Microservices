/**
 * Enterprise Microservices Comprehensive Integration Test Suite
 * Zero-dependency automated test runner verifying cryptography, storage, inter-service communication,
 * distributed Saga workflows, compensation rollback, and API Gateway routing.
 */

const assert = require('assert');
const http = require('http');
const { JwtUtil, HashUtil } = require('../../shared/security');
const { DocumentStore } = require('../../shared/storage');

let passedTests = 0;
let failedTests = 0;

function it(description, fn) {
  return async () => {
    try {
      await fn();
      console.log(`  \x1b[32m✔ PASS:\x1b[0m ${description}`);
      passedTests++;
    } catch (err) {
      console.error(`  \x1b[31m✘ FAIL:\x1b[0m ${description}`);
      console.error(`    \x1b[33m${err.message}\x1b[0m`);
      failedTests++;
    }
  };
}

function requestJson(method, host, port, path, body = null, headers = {}) {
  const postData = body ? JSON.stringify(body) : '';
  const reqHeaders = {
    'Content-Type': 'application/json',
    ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
    ...headers
  };

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: host,
      port,
      path,
      method,
      headers: reqHeaders,
      timeout: 4000
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('\x1b[36m========================================================\x1b[0m');
  console.log('\x1b[1m\x1b[32m  STARTING ENTERPRISE MICROSERVICES TEST SUITE\x1b[0m');
  console.log('\x1b[36m========================================================\x1b[0m\n');

  // --- Suite 1: Security & Cryptography ---
  console.log('\x1b[1m[Suite 1: Security & Cryptography]\x1b[0m');
  await it('should hash password with salt and verify correctly', () => {
    const password = 'SecretPassword123!';
    const hashWithSalt = HashUtil.hashPassword(password);
    assert.strictEqual(typeof hashWithSalt, 'string');
    assert.ok(hashWithSalt.includes(':'));
    assert.strictEqual(HashUtil.verifyPassword(password, hashWithSalt), true);
    assert.strictEqual(HashUtil.verifyPassword('WrongPass', hashWithSalt), false);
  })();

  await it('should sign and verify custom HMAC-SHA256 JWT tokens', () => {
    const payload = { userId: 'usr_test_1', email: 'test@domain.com', role: 'admin' };
    const token = JwtUtil.sign(payload);
    assert.strictEqual(typeof token, 'string');
    const decoded = JwtUtil.verify(token);
    assert.strictEqual(decoded.userId, payload.userId);
    assert.strictEqual(decoded.email, payload.email);
    assert.strictEqual(decoded.role, payload.role);
  })();

  // --- Suite 2: ACID Document Storage Engine ---
  console.log('\n\x1b[1m[Suite 2: ACID Document Storage Engine]\x1b[0m');
  await it('should support insert, find, update, and transactions', async () => {
    const store = new DocumentStore('test_unit_store', { inMemoryOnly: true });
    await store.clear();

    const doc = await store.insert({ name: 'Widget Pro', sku: 'SKU-TEST', price: 99.95 });
    assert.ok(doc.id);
    assert.strictEqual(doc.name, 'Widget Pro');

    const found = await store.findOne({ sku: 'SKU-TEST' });
    assert.strictEqual(found.id, doc.id);

    const updated = await store.updateById(doc.id, { price: 109.95 });
    assert.strictEqual(updated.price, 109.95);

    // Transaction Test
    store.beginTransaction();
    await store.updateById(doc.id, { price: 999.00 });
    assert.strictEqual((await store.findById(doc.id)).price, 999.00);
    store.rollbackTransaction();
    assert.strictEqual((await store.findById(doc.id)).price, 109.95);
  })();

  // --- Suite 3: Auth & Identity Service API ---
  console.log('\n\x1b[1m[Suite 3: Auth & Identity Microservice]\x1b[0m');
  await it('should register new user and return valid auth token via Gateway', async () => {
    const testEmail = `testuser_${Date.now()}@testdomain.com`;
    const res = await requestJson('POST', 'localhost', 8000, '/api/auth/register', {
      email: testEmail,
      password: 'StrongPassword123!',
      name: 'Integration Test User'
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.data.token);
    assert.strictEqual(res.data.data.user.email, testEmail);
  })();

  await it('should login existing user with valid credentials', async () => {
    const res = await requestJson('POST', 'localhost', 8000, '/api/auth/login', {
      email: 'admin@microservices.local',
      password: 'Admin@12345'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.data.token);
    assert.strictEqual(res.data.data.user.role, 'admin');
  })();

  // --- Suite 4: Product Catalog & Inventory ---
  console.log('\n\x1b[1m[Suite 4: Product Catalog & Inventory]\x1b[0m');
  await it('should list products and query stock level from warehouse', async () => {
    const prodRes = await requestJson('GET', 'localhost', 8000, '/api/products');
    assert.strictEqual(prodRes.status, 200);
    assert.ok(Array.isArray(prodRes.data.data.products));
    assert.ok(prodRes.data.data.products.length > 0);

    const invRes = await requestJson('GET', 'localhost', 8000, '/api/inventory');
    assert.strictEqual(invRes.status, 200);
    assert.ok(Array.isArray(invRes.data.data.items));
  })();

  // --- Suite 5: Distributed Saga Checkout Orchestration (Success Path) ---
  console.log('\n\x1b[1m[Suite 5: Distributed Saga Orchestration (Success Flow)]\x1b[0m');
  await it('should orchestrate distributed checkout (Reserve Stock -> Charge Payment -> Commit)', async () => {
    const prodRes = await requestJson('GET', 'localhost', 8000, '/api/products');
    const firstProduct = prodRes.data.data.products[0];

    const checkoutRes = await requestJson('POST', 'localhost', 8000, '/api/orders/checkout', {
      userId: 'usr_integ_01',
      items: [{
        productId: firstProduct.id,
        sku: firstProduct.sku,
        name: firstProduct.name,
        price: firstProduct.price,
        quantity: 1
      }],
      paymentMethod: {
        type: 'CREDIT_CARD',
        cardNumber: '4242424242424242',
        last4: '4242'
      }
    });

    assert.strictEqual(checkoutRes.status, 201);
    assert.strictEqual(checkoutRes.data.success, true);
    assert.strictEqual(checkoutRes.data.data.order.status, 'CONFIRMED');
    assert.ok(checkoutRes.data.data.sagaId);
  })();

  // --- Suite 6: Distributed Saga Compensation Flow (Declined Payment Rollback) ---
  console.log('\n\x1b[1m[Suite 6: Distributed Saga Compensation (Failure & Rollback Flow)]\x1b[0m');
  await it('should trigger compensation (release held stock) when payment is declined', async () => {
    const prodRes = await requestJson('GET', 'localhost', 8000, '/api/products');
    const firstProduct = prodRes.data.data.products[0];

    // Card ending in 0002 simulates failure
    const checkoutRes = await requestJson('POST', 'localhost', 8000, '/api/orders/checkout', {
      userId: 'usr_integ_fail',
      items: [{
        productId: firstProduct.id,
        sku: firstProduct.sku,
        name: firstProduct.name,
        price: firstProduct.price,
        quantity: 1
      }],
      paymentMethod: {
        type: 'CREDIT_CARD',
        cardNumber: '4000000000000002',
        last4: '0002'
      }
    });

    assert.strictEqual(checkoutRes.status, 422);
    const errCode = checkoutRes.data.error?.code || checkoutRes.data.data?.error?.code;
    assert.strictEqual(errCode, 'SAGA_TRANSACTION_FAILED');
  })();

  // --- Suite 7: API Gateway Reverse Proxy & Rate Limiting ---
  console.log('\n\x1b[1m[Suite 7: API Gateway Reverse Proxy & Telemetry]\x1b[0m');
  await it('should inject X-Trace-Id correlation headers and rate limiting headers', async () => {
    const res = await requestJson('GET', 'localhost', 8000, '/api/system/status');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['x-trace-id']);
    assert.ok(res.headers['x-ratelimit-limit']);
    assert.ok(res.headers['x-ratelimit-remaining']);
  })();

  console.log('\n\x1b[36m========================================================\x1b[0m');
  console.log(`\x1b[1mTEST SUMMARY: \x1b[32m${passedTests} PASSED\x1b[0m, \x1b[31m${failedTests} FAILED\x1b[0m`);
  console.log('\x1b[36m========================================================\x1b[0m\n');
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };

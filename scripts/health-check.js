/**
 * Enterprise Microservices Health Check Validator
 * Probes all 11 ports and verifies health status endpoints.
 */

const http = require('http');

const ENDPOINTS = [
  { name: 'API Gateway', port: 8000, path: '/health' },
  { name: 'Service Registry', port: 9001, path: '/health' },
  { name: 'Event Bus Broker', port: 9000, path: '/health' },
  { name: 'Auth & Identity Service', port: 8001, path: '/health' },
  { name: 'User Profile Service', port: 8002, path: '/health' },
  { name: 'Product Catalog Service', port: 8003, path: '/health' },
  { name: 'Order & Saga Service', port: 8004, path: '/health' },
  { name: 'Payment & Ledger Service', port: 8005, path: '/health' },
  { name: 'Inventory & Warehouse Service', port: 8006, path: '/health' },
  { name: 'Notification & Alert Service', port: 8007, path: '/health' },
  { name: 'Analytics & Telemetry Service', port: 8008, path: '/health' }
];

async function checkService(svc) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = http.get(`http://localhost:${svc.port}${svc.path}`, { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const lat = Date.now() - t0;
        resolve({ ...svc, status: res.statusCode === 200 ? 'ONLINE' : `ERR_${res.statusCode}`, latencyMs: lat });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ...svc, status: 'TIMEOUT', latencyMs: 2000 });
    });

    req.on('error', () => {
      resolve({ ...svc, status: 'OFFLINE', latencyMs: 0 });
    });
  });
}

async function run() {
  console.log('\n--- Probing Microservices Health Status ---');
  const results = await Promise.all(ENDPOINTS.map(checkService));
  
  console.table(results.map(r => ({
    'Service Name': r.name,
    'Port': r.port,
    'Status': r.status,
    'Latency (ms)': r.latencyMs
  })));

  const allOnline = results.every(r => r.status === 'ONLINE');
  if (allOnline) {
    console.log('\x1b[32m✔ All microservices are active and responding!\x1b[0m\n');
  } else {
    console.log('\x1b[33m⚠ Some services are currently offline or unreachable.\x1b[0m\n');
  }
}

if (require.main === module) {
  run();
}

module.exports = { checkService, run };

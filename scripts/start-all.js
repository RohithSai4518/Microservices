/**
 * Enterprise Microservices Master Cluster Launcher
 * Zero-dependency multi-process supervisor that launches the Service Registry,
 * Event Bus, 8 Domain Microservices, and the Central API Gateway.
 */

const { fork } = require('child_process');
const path = require('path');
const { seed } = require('./seed-data');

const SERVICES = [
  // Infrastructure Layer
  { name: 'service-registry', script: path.join(__dirname, '..', 'shared', 'service-registry', 'server.js'), env: { REGISTRY_PORT: 9001 } },
  { name: 'event-bus-broker', script: path.join(__dirname, '..', 'shared', 'event-bus', 'server.js'), env: { EVENT_BUS_PORT: 9000 } },

  // Domain Microservices Layer
  { name: 'auth-service', script: path.join(__dirname, '..', 'services', 'auth-service', 'server.js'), env: { AUTH_SERVICE_PORT: 8001 } },
  { name: 'user-service', script: path.join(__dirname, '..', 'services', 'user-service', 'server.js'), env: { USER_SERVICE_PORT: 8002 } },
  { name: 'product-service', script: path.join(__dirname, '..', 'services', 'product-service', 'server.js'), env: { PRODUCT_SERVICE_PORT: 8003 } },
  { name: 'order-service', script: path.join(__dirname, '..', 'services', 'order-service', 'server.js'), env: { ORDER_SERVICE_PORT: 8004 } },
  { name: 'payment-service', script: path.join(__dirname, '..', 'services', 'payment-service', 'server.js'), env: { PAYMENT_SERVICE_PORT: 8005 } },
  { name: 'inventory-service', script: path.join(__dirname, '..', 'services', 'inventory-service', 'server.js'), env: { INVENTORY_SERVICE_PORT: 8006 } },
  { name: 'notification-service', script: path.join(__dirname, '..', 'services', 'notification-service', 'server.js'), env: { NOTIFICATION_SERVICE_PORT: 8007 } },
  { name: 'analytics-service', script: path.join(__dirname, '..', 'services', 'analytics-service', 'server.js'), env: { ANALYTICS_SERVICE_PORT: 8008 } },

  // Gateway Layer
  { name: 'api-gateway', script: path.join(__dirname, '..', 'api-gateway', 'src', 'server.js'), env: { GATEWAY_PORT: 8000 } }
];

const processes = [];

async function start() {
  console.log('\x1b[36m========================================================\x1b[0m');
  console.log('\x1b[1m\x1b[32m  ENTERPRISE MICROSERVICES PLATFORM LAUNCHER\x1b[0m');
  console.log('\x1b[36m========================================================\x1b[0m');

  // Seed database first
  try {
    await seed();
  } catch (err) {
    console.error('Seeding warning:', err.message);
  }

  // 1. Launch Infrastructure first
  for (const svc of SERVICES) {
    console.log(`\x1b[34m[Launcher]\x1b[0m Starting service: \x1b[1m${svc.name}\x1b[0m...`);
    const child = fork(svc.script, [], {
      env: { ...process.env, ...svc.env },
      silent: false
    });

    child.on('exit', (code, signal) => {
      console.log(`\x1b[33m[Launcher]\x1b[0m Service ${svc.name} exited with code ${code || signal}`);
    });

    processes.push({ name: svc.name, child });

    // Slight delay between boot steps to let registry and broker start first
    if (svc.name === 'event-bus-broker') {
      await new Promise(r => setTimeout(r, 600));
    }
  }

  console.log('\x1b[32m========================================================\x1b[0m');
  console.log('\x1b[1m\x1b[32m  ALL 11 MICROSERVICES & INFRASTRUCTURE NODES RUNNING!\x1b[0m');
  console.log('\x1b[36m  API Gateway:         http://localhost:8000\x1b[0m');
  console.log('\x1b[36m  Management Console:  http://localhost:8000/dashboard\x1b[0m');
  console.log('\x1b[36m  Service Registry:    http://localhost:9001\x1b[0m');
  console.log('\x1b[36m  Event Bus Broker:    http://localhost:9000\x1b[0m');
  console.log('\x1b[32m========================================================\x1b[0m');
}

function shutdown() {
  console.log('\n\x1b[31m[Launcher] Gracefully shutting down all microservices...\x1b[0m');
  for (const p of processes) {
    p.child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();

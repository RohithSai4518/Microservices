/**
 * Enterprise MicroServices Control Center - Frontend Application Controller
 * Pure Vanilla JavaScript ES6+ (Zero external UI dependencies)
 */

const App = {
  activeTab: 'tab-topology',
  pollInterval: null,
  cachedProducts: [],

  // Microservices Definitions for Mesh View
  servicesMeta: [
    { name: 'api-gateway', port: 8000, desc: 'Reverse Proxy, Rate Limiter & Security Guard', type: 'Gateway' },
    { name: 'service-registry', port: 9001, desc: 'Dynamic Discovery & Heartbeat Prober', type: 'Mesh' },
    { name: 'event-bus-broker', port: 9000, desc: 'Distributed Pub/Sub Message Broker', type: 'Event Fabric' },
    { name: 'auth-service', port: 8001, desc: 'JWT Crypto & Identity Management', type: 'Security' },
    { name: 'user-service', port: 8002, desc: 'Profiles & Address Book Core', type: 'Domain' },
    { name: 'product-service', port: 8003, desc: 'Product Taxonomy & Dynamic Pricing', type: 'Domain' },
    { name: 'order-service', port: 8004, desc: 'Distributed Saga Orchestrator', type: 'Orchestration' },
    { name: 'payment-service', port: 8005, desc: 'Idempotent Ledger & Payment Gateway', type: 'Financial' },
    { name: 'inventory-service', port: 8006, desc: 'Warehouse Stock & Reservation Hold', type: 'Warehouse' },
    { name: 'notification-service', port: 8007, desc: 'Multi-Channel Alert Dispatcher', type: 'Communication' },
    { name: 'analytics-service', port: 8008, desc: 'Telemetry & Real-Time Business Stream', type: 'Analytics' }
  ],

  init() {
    this.setupTabs();
    this.refreshTopology();
    this.loadAnalytics();
    this.loadCatalog();
    this.loadEvents();

    // Auto-polling every 4 seconds
    this.pollInterval = setInterval(() => {
      if (this.activeTab === 'tab-topology') this.refreshTopology();
      if (this.activeTab === 'tab-analytics') this.loadAnalytics();
      if (this.activeTab === 'tab-events') this.loadEvents();
    }, 4000);
  },

  setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetTab = btn.getAttribute('data-tab');
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        document.getElementById(targetTab).classList.add('active');
        this.activeTab = targetTab;

        if (targetTab === 'tab-topology') this.refreshTopology();
        if (targetTab === 'tab-analytics') this.loadAnalytics();
        if (targetTab === 'tab-catalog') this.loadCatalog();
        if (targetTab === 'tab-events') this.loadEvents();
      });
    });
  },

  async fetchJson(url, options = {}) {
    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
      });
      const data = await res.json();
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      return { ok: false, status: 0, error: err.message };
    }
  },

  async refreshTopology() {
    const res = await this.fetchJson('/api/system/topology');
    const servicesGrid = document.getElementById('services-grid');
    let activeCount = 0;

    if (res.ok && res.data) {
      document.getElementById('stat-uptime').innerText = `${Math.floor(res.data.gateway.uptime || 0)}s`;
      document.getElementById('gw-status-badge').className = 'badge badge-green';
      document.getElementById('gw-status-text').innerText = 'Gateway Online (Port 8000)';
    } else {
      document.getElementById('gw-status-badge').className = 'badge badge-red';
      document.getElementById('gw-status-text').innerText = 'Gateway Unreachable';
    }

    // Probe Registry
    const regRes = await this.fetchJson('http://localhost:9001/services').catch(() => ({ ok: false }));
    const registeredMap = (regRes.ok && regRes.data && regRes.data.services) ? regRes.data.services : {};
    const regNodesCount = Object.keys(registeredMap).length;
    document.getElementById('stat-registry-nodes').innerText = `${regNodesCount} Services`;

    // Probe Event Bus Broker
    const ebRes = await this.fetchJson('http://localhost:9000/health').catch(() => ({ ok: false }));
    if (ebRes.ok && ebRes.data) {
      document.getElementById('stat-events-count').innerText = ebRes.data.totalEventsProcessed || 0;
    }

    // Render Cards for each Service
    servicesGrid.innerHTML = '';
    for (const svc of this.servicesMeta) {
      let isUp = false;
      let latency = 'Probe OK';

      // Check if instance is in registry or directly reachable
      if (svc.port === 8000 && res.ok) isUp = true;
      else if (svc.port === 9001 && regRes.ok) isUp = true;
      else if (svc.port === 9000 && ebRes.ok) isUp = true;
      else if (registeredMap[svc.name]) isUp = true;
      else {
        // Direct ping test
        const ping = await this.fetchJson(`http://localhost:${svc.port}/health`).catch(() => ({ ok: false }));
        if (ping.ok) isUp = true;
      }

      if (isUp) activeCount++;

      const card = document.createElement('div');
      card.className = 'service-card';
      card.innerHTML = `
        <div class="service-top">
          <div>
            <div class="service-name">${svc.name}</div>
            <div class="service-port">Port :${svc.port} &bull; ${svc.type}</div>
          </div>
          <span class="badge ${isUp ? 'badge-green' : 'badge-red'}">
            <span class="pulse-dot"></span> ${isUp ? 'ONLINE' : 'OFFLINE'}
          </span>
        </div>
        <div class="service-meta">${svc.desc}</div>
        <div class="service-actions">
          <button class="btn-sm" onclick="App.pingService(${svc.port}, '${svc.name}')">Health Probe</button>
          <button class="btn-sm" onclick="App.openInConsole('${svc.name}', ${svc.port})">Inspect API</button>
        </div>
      `;
      servicesGrid.appendChild(card);
    }

    document.getElementById('active-services-count').innerText = `${activeCount}/${this.servicesMeta.length}`;
  },

  async pingService(port, name) {
    const t0 = performance.now();
    const res = await this.fetchJson(`http://localhost:${port}/health`);
    const lat = Math.round(performance.now() - t0);
    if (res.ok) {
      alert(`[${name}] is healthy!\nResponse: ${JSON.stringify(res.data, null, 2)}\nLatency: ${lat}ms`);
    } else {
      alert(`[${name}] health probe failed or timed out.`);
    }
  },

  openInConsole(name, port) {
    document.querySelector('[data-tab="tab-console"]').click();
    const endpointMap = {
      'auth-service': '/api/auth/users',
      'user-service': '/api/users/profile/user_demo',
      'product-service': '/api/products',
      'order-service': '/api/orders',
      'payment-service': '/api/payments/transactions',
      'inventory-service': '/api/inventory',
      'notification-service': '/api/notifications',
      'analytics-service': '/api/analytics/metrics/overview'
    };
    const path = endpointMap[name] || `/api/${name}`;
    this.setEndpoint('GET', path, '');
  },

  async loadAnalytics() {
    const res = await this.fetchJson('/api/analytics/metrics/overview');
    if (!res.ok || !res.data) return;

    const data = res.data;
    const summary = data.summary || {};

    document.getElementById('stat-revenue').innerText = `$${(summary.totalRevenue || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    document.getElementById('stat-orders').innerText = summary.totalOrders || 0;
    document.getElementById('stat-saga-rate').innerText = `${summary.sagaSuccessRate || 100}%`;
    document.getElementById('stat-users').innerText = summary.userSignups || 0;

    // Top Products
    const topBody = document.getElementById('top-products-body');
    if (data.topProducts && data.topProducts.length > 0) {
      topBody.innerHTML = data.topProducts.map(p => `
        <tr>
          <td><strong>${p.name}</strong></td>
          <td><span class="badge badge-green">${p.count} sold</span></td>
        </tr>
      `).join('');
    }

    // Event Topics
    const topicsDist = document.getElementById('topics-distribution');
    if (data.eventDistribution && Object.keys(data.eventDistribution).length > 0) {
      topicsDist.innerHTML = Object.entries(data.eventDistribution).map(([topic, count]) => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:0.4rem 0.75rem; border-radius:4px;">
          <code>${topic}</code>
          <span class="badge badge-blue">${count} msgs</span>
        </div>
      `).join('');
    }
  },

  async loadCatalog() {
    const res = await this.fetchJson('/api/products');
    const invRes = await this.fetchJson('/api/inventory');
    const tableBody = document.getElementById('catalog-table-body');
    const select = document.getElementById('saga-product-select');

    if (!res.ok || !res.data || !res.data.products) {
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--accent-red);">Failed to load products from Product Service</td></tr>`;
      return;
    }

    const products = res.data.products;
    this.cachedProducts = products;

    const invMap = {};
    if (invRes.ok && invRes.data && invRes.data.items) {
      invRes.data.items.forEach(i => invMap[i.sku] = i);
    }

    // Populate Catalog Table
    tableBody.innerHTML = products.map(p => {
      const inv = invMap[p.sku] || { availableStock: p.stock || 50, reservedStock: 0 };
      return `
        <tr>
          <td><code>${p.sku}</code></td>
          <td><strong>${p.name}</strong></td>
          <td>${p.category || 'General'}</td>
          <td><strong>$${Number(p.price).toFixed(2)}</strong></td>
          <td><span class="badge ${inv.availableStock > 5 ? 'badge-green' : 'badge-red'}">${inv.availableStock}</span></td>
          <td><span class="badge badge-blue">${inv.reservedStock || 0}</span></td>
          <td>
            <button class="btn-sm" onclick="App.restockModal('${p.sku}')">Restock (+25)</button>
          </td>
        </tr>
      `;
    }).join('');

    // Populate Simulator Dropdown
    select.innerHTML = products.map(p => `
      <option value="${p.id}" data-sku="${p.sku}" data-price="${p.price}" data-name="${p.name}">
        ${p.name} ($${p.price}) - SKU: ${p.sku}
      </option>
    `).join('');
  },

  async restockModal(sku) {
    const res = await this.fetchJson('/api/inventory/restock', {
      method: 'POST',
      body: JSON.stringify({ sku, quantity: 25 })
    });
    if (res.ok) {
      alert(`Successfully restocked 25 units for SKU ${sku}`);
      this.loadCatalog();
    } else {
      alert(`Restock failed: ${res.data?.error?.message || 'Error'}`);
    }
  },

  async executeSagaCheckout() {
    const select = document.getElementById('saga-product-select');
    const selectedOption = select.options[select.selectedIndex];
    if (!selectedOption) return alert('Please select a product');

    const productId = select.value;
    const sku = selectedOption.getAttribute('data-sku');
    const name = selectedOption.getAttribute('data-name');
    const price = parseFloat(selectedOption.getAttribute('data-price'));
    const quantity = parseInt(document.getElementById('saga-quantity').value, 10) || 1;
    const cardNumber = document.getElementById('saga-card-scenario').value;

    const btn = document.getElementById('btn-run-saga');
    btn.disabled = true;
    btn.innerText = 'Orchestrating Distributed Saga...';

    // Reset Visual Steps
    this.setSagaStep('step-inv-reserve', 'active', 'Sending reservation hold to Inventory Service...');
    this.setSagaStep('step-pay-charge', 'pending', 'Awaiting inventory reservation');
    this.setSagaStep('step-inv-commit', 'pending', 'Awaiting payment confirmation');
    this.setSagaStep('step-notif-dispatch', 'pending', 'Awaiting confirmation');
    document.getElementById('saga-result-box').style.display = 'none';

    await new Promise(r => setTimeout(r, 600));

    const payload = {
      userId: 'customer_usr_01',
      items: [{ productId, sku, name, price, quantity }],
      shippingAddress: { street: '123 Enterprise Way', city: 'San Francisco', country: 'USA' },
      paymentMethod: {
        type: 'CREDIT_CARD',
        cardNumber: cardNumber,
        last4: cardNumber.substring(cardNumber.length - 4)
      }
    };

    const res = await this.fetchJson('/api/orders/checkout', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (res.ok && res.data.success) {
      this.setSagaStep('step-inv-reserve', 'success', 'Stock reserved in warehouse');
      this.setSagaStep('step-pay-charge', 'success', `Charge authorized ($${(price * quantity).toFixed(2)})`);
      this.setSagaStep('step-inv-commit', 'success', 'Inventory committed to order');
      this.setSagaStep('step-notif-dispatch', 'success', 'Order confirmed & notification dispatched');

      document.getElementById('saga-result-box').style.display = 'block';
      document.getElementById('saga-result-json').innerText = JSON.stringify(res.data, null, 2);
    } else {
      // Failed / Compensated flow
      this.setSagaStep('step-inv-reserve', 'success', 'Stock initially held');
      this.setSagaStep('step-pay-charge', 'failed', 'Payment declined by gateway simulation');
      this.setSagaStep('step-inv-commit', 'compensated', 'COMPENSATION TRIGGERED: Released stock back to warehouse');
      this.setSagaStep('step-notif-dispatch', 'failed', 'Order marked failed & saga rolled back');

      document.getElementById('saga-result-box').style.display = 'block';
      document.getElementById('saga-result-json').innerText = JSON.stringify(res.data, null, 2);
    }

    btn.disabled = false;
    btn.innerText = 'Launch Distributed Saga Checkout';

    this.loadCatalog();
    this.loadAnalytics();
  },

  setSagaStep(id, state, subText) {
    const el = document.getElementById(id);
    el.className = `saga-step ${state}`;
    document.getElementById(`${id}-sub`).innerText = subText;
  },

  async loadEvents() {
    const res = await this.fetchJson('/api/analytics/events/stream');
    const tableBody = document.getElementById('events-table-body');

    if (!res.ok || !res.data || !res.data.events || res.data.events.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No events streamed yet</td></tr>`;
      return;
    }

    tableBody.innerHTML = res.data.events.slice(0, 30).map(e => `
      <tr>
        <td style="color:var(--text-secondary); font-size:0.75rem;">${new Date(e.receivedAt || e.createdAt).toLocaleTimeString()}</td>
        <td><code>${e.topic}</code></td>
        <td><span class="badge badge-blue">${e.sender || 'system'}</span></td>
        <td><code style="font-size:0.7rem;">${e.traceId || '-'}</code></td>
        <td style="font-size:0.8rem; color:var(--text-secondary);">${JSON.stringify(e.payload || {}).substring(0, 75)}...</td>
      </tr>
    `).join('');
  },

  setEndpoint(method, path, body) {
    document.getElementById('api-method').value = method;
    document.getElementById('api-path').value = path;
    document.getElementById('api-body').value = body;
  },

  async executeApiCall() {
    const method = document.getElementById('api-method').value;
    const path = document.getElementById('api-path').value;
    const rawBody = document.getElementById('api-body').value.trim();
    const output = document.getElementById('api-response-output');

    output.innerText = 'Executing request...';

    const options = { method };
    if (['POST', 'PUT', 'PATCH'].includes(method) && rawBody) {
      try {
        options.body = JSON.stringify(JSON.parse(rawBody));
      } catch (err) {
        output.innerText = `JSON Syntax Error in Body: ${err.message}`;
        return;
      }
    }

    const t0 = performance.now();
    const res = await this.fetchJson(path, options);
    const lat = Math.round(performance.now() - t0);

    output.innerText = `// Status: ${res.status} (${lat}ms)\n` + JSON.stringify(res.data, null, 2);
  }
};

window.addEventListener('DOMContentLoaded', () => App.init());

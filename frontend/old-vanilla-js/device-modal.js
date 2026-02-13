/**
 * Reusable Device Modal component
 * Handles ANT+ device scanning and connection UI
 *
 * Usage:
 *   DeviceModal.init(sendCommandFn)   — call once after WebSocket is ready
 *   DeviceModal.open()                — show the modal
 *   DeviceModal.close()               — hide the modal
 *   DeviceModal.onStatusUpdate(data)  — call whenever a 'status' WS message arrives
 *   DeviceModal.onScanResult(data)    — call whenever a 'scan_result' WS message arrives
 */
const DeviceModal = (() => {
  let _sendCommand = null;
  let _discoveredDevices = new Map();
  let _currentStatus = {
    dongle: 'disconnected',
    scan: 'idle',
    connection: 'disconnected',
    connectedDeviceId: null,
  };

  // ── inject modal HTML once ─────────────────────────────────────────
  function _ensureHTML() {
    if (document.getElementById('device-modal')) return;

    document.body.insertAdjacentHTML('beforeend', `
      <div id="device-modal" class="modal">
        <div class="modal-content device-scan">
          <div class="modal-header">
            <button class="back-button" onclick="DeviceModal.close()">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
              </svg>
            </button>
            <h2>Device Scan</h2>
            <div></div>
          </div>

          <div class="modal-body">
            <!-- Status Indicators -->
            <div class="device-status-bar">
              <div class="status-chip">
                <span class="status-label">Dongle:</span>
                <span id="dongle-status" class="status-value disconnected">Disconnected</span>
              </div>
              <div class="status-chip">
                <span class="status-label">Scanning:</span>
                <span id="scan-status" class="status-value idle">Idle</span>
              </div>
            </div>

            <!-- Devices Found Section -->
            <div class="devices-found-section">
              <div class="section-header">
                <h3 id="devices-count">Searching for devices...</h3>
                <div class="scan-actions">
                  <button id="btn-rescan" class="btn-text" onclick="DeviceModal.startScan()">RESCAN</button>
                </div>
              </div>

              <!-- Device List -->
              <div id="devices-list" class="devices-list">
                <div class="empty-state">
                  <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 6c-3.87 0-7 3.13-7 7h2c0-2.76 2.24-5 5-5s5 2.24 5 5h2c0-3.87-3.13-7-7-7z"/>
                    <path d="M12 2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8s8 3.59 8 8h2c0-5.52-4.48-10-10-10z"/>
                  </svg>
                  <p>Click "Start Scan" to discover devices</p>
                </div>
              </div>

              <!-- Scan Controls -->
              <div class="scan-controls">
                <button id="btn-start-scan" class="btn btn-primary btn-large" onclick="DeviceModal.startScan()">
                  Start Scan
                </button>
                <button id="btn-stop-scan" class="btn btn-secondary btn-large" onclick="DeviceModal.stopScan()" disabled>
                  Stop Scan
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `);
  }

  // ── public API ─────────────────────────────────────────────────────
  function init(sendCommandFn) {
    _sendCommand = sendCommandFn;
    _ensureHTML();

    // ESC to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('device-modal').classList.contains('active')) {
        close();
      }
    });
  }

  function open() {
    document.getElementById('device-modal').classList.add('active');
    _renderStatus();
  }

  function close() {
    document.getElementById('device-modal').classList.remove('active');
  }

  function startScan() {
    _discoveredDevices.clear();
    _renderDeviceList();
    _sendCommand('start_scan');
  }

  function stopScan() {
    _sendCommand('stop_scan');
  }

  function connectDevice(deviceId) {
    _sendCommand('connect', { deviceId: parseInt(deviceId, 10) });
    // Close modal after a tick so the user sees the tap
    setTimeout(close, 400);
  }

  // ── called by the host page when WS messages arrive ───────────────
  function onStatusUpdate(data) {
    _currentStatus = { ..._currentStatus, ...data };
    _renderStatus();
  }

  function onScanResult(device) {
    if (!device.deviceId) return;
    _discoveredDevices.set(device.deviceId, device);
    _renderDeviceList();
  }

  // ── internal helpers ───────────────────────────────────────────────
  function _renderStatus() {
    const dongleEl = document.getElementById('dongle-status');
    const scanEl   = document.getElementById('scan-status');
    if (!dongleEl || !scanEl) return;

    const dongleConnected = _currentStatus.dongle === 'connected';
    dongleEl.textContent = dongleConnected ? 'Connected' : 'Disconnected';
    dongleEl.className   = `status-value ${dongleConnected ? 'connected' : 'disconnected'}`;

    const scanning = _currentStatus.scan === 'scanning';
    scanEl.textContent = scanning ? 'Scanning…' : 'Idle';
    scanEl.className   = `status-value ${scanning ? 'scanning' : 'idle'}`;

    const startBtn = document.getElementById('btn-start-scan');
    const stopBtn  = document.getElementById('btn-stop-scan');
    if (startBtn) startBtn.disabled = scanning;
    if (stopBtn)  stopBtn.disabled  = !scanning;
  }

  function _renderDeviceList() {
    const listEl  = document.getElementById('devices-list');
    const countEl = document.getElementById('devices-count');
    if (!listEl || !countEl) return;

    const devices = Array.from(_discoveredDevices.values());

    if (devices.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
            <circle cx="12" cy="12" r="3"/>
            <path d="M12 6c-3.87 0-7 3.13-7 7h2c0-2.76 2.24-5 5-5s5 2.24 5 5h2c0-3.87-3.13-7-7-7z"/>
            <path d="M12 2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8s8 3.59 8 8h2c0-5.52-4.48-10-10-10z"/>
          </svg>
          <p>Click "Start Scan" to discover devices</p>
        </div>`;
      countEl.textContent = 'Searching for devices...';
      return;
    }

    countEl.textContent = `${devices.length} Connection${devices.length === 1 ? '' : 's'} found`;

    listEl.innerHTML = devices.map(device => {
      const isSelected = _currentStatus.connectedDeviceId === device.deviceId;
      return `
        <div class="device-item ${isSelected ? 'selected' : ''}" onclick="DeviceModal.connectDevice(${device.deviceId})">
          <div class="device-info">
            <div class="device-icon">🚴</div>
            <div class="device-details">
              <h4>Device ${device.deviceId}</h4>
              <div class="device-type">Smart Trainer</div>
            </div>
          </div>
          <div class="device-signal">📶</div>
        </div>`;
    }).join('');
  }

  // ── expose ─────────────────────────────────────────────────────────
  return { init, open, close, startScan, stopScan, connectDevice, onStatusUpdate, onScanResult };
})();

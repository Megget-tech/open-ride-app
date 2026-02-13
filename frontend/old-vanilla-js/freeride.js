/**
 * Open Ride - Free Ride Mode
 * Unstructured riding with live telemetry
 */

import { getAntManager } from './antManager.js';

// ANT+ Manager (WebUSB) - shared singleton
let antManager = null;

// State
let currentStatus = {
  dongle: 'disconnected',
  scan: 'idle',
  connection: 'disconnected',
  connectedDeviceId: null,
};

// Ride state
let rideState = {
  isRunning: true,
  isPaused: false,
  startTime: Date.now(),
  pausedTime: 0,
  pauseStart: null,
  elapsedSeconds: 0,
};

// Telemetry
let telemetry = {
  power: 0,
  cadence: 0,
  speed: 0,
  heartRate: 0,
  distance: 0,
};

// Stats tracking
let rideStats = {
  totalPower: 0,
  powerReadings: 0,
  maxPower: 0,
  totalCadence: 0,
  cadenceReadings: 0,
};

// User settings
let userSettings = {
  ftp: 200,
  weight: 70,
};

// Timers
let updateTimer = null;

/**
 * Initialize free ride
 */
function init() {
  TopBar.init({ type: 'activity', backLabel: 'Exit', title: 'Free Ride', onConnectionClick: () => DeviceModal.open() });
  loadUserSettings();
  initAntManager();

  // Initialize device modal with command functions
  DeviceModal.init((command, data) => {
    switch (command) {
      case 'start_scan':
        if (antManager) antManager.startScan();
        break;
      case 'stop_scan':
        if (antManager) antManager.stopScan();
        break;
      case 'connect':
        if (antManager && data && data.deviceId) antManager.connect(data.deviceId);
        break;
    }
  });

  startRide();
}

/**
 * Load user settings from localStorage
 */
function loadUserSettings() {
  try {
    const stored = localStorage.getItem('openride_settings');
    if (stored) {
      const settings = JSON.parse(stored);
      userSettings = {
        ftp: settings.ftp || 200,
        weight: settings.weight || 70,
      };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

/**
 * Start the ride
 */
function startRide() {
  rideState.startTime = Date.now();
  rideState.isRunning = true;
  updateTimer = setInterval(updateDisplay, 1000);
}

/**
 * Update display
 */
function updateDisplay() {
  if (rideState.isPaused) return;

  // Calculate elapsed time
  const now = Date.now();
  rideState.elapsedSeconds = Math.floor((now - rideState.startTime - rideState.pausedTime) / 1000);

  // Update time display
  document.getElementById('elapsed-time').textContent = formatTime(rideState.elapsedSeconds);

  // Update stats
  if (telemetry.power > 0) {
    rideStats.totalPower += telemetry.power;
    rideStats.powerReadings++;
    rideStats.maxPower = Math.max(rideStats.maxPower, telemetry.power);
  }
  if (telemetry.cadence > 0) {
    rideStats.totalCadence += telemetry.cadence;
    rideStats.cadenceReadings++;
  }

  // Estimate calories (rough calculation)
  const avgPower = rideStats.powerReadings > 0
    ? rideStats.totalPower / rideStats.powerReadings
    : 0;
  const totalKJ = (avgPower * rideState.elapsedSeconds) / 1000;
  const calories = Math.round(totalKJ / 4.184);
  document.getElementById('current-calories').textContent = calories;
}

/**
 * Toggle pause
 */
function togglePause() {
  rideState.isPaused = !rideState.isPaused;

  const pauseIcon = document.getElementById('pause-icon');
  const playIcon = document.getElementById('play-icon');
  const pauseText = document.getElementById('pause-text');

  if (rideState.isPaused) {
    rideState.pauseStart = Date.now();
    pauseIcon.style.display = 'none';
    playIcon.style.display = 'block';
    pauseText.textContent = 'Resume';
  } else {
    rideState.pausedTime += Date.now() - rideState.pauseStart;
    pauseIcon.style.display = 'block';
    playIcon.style.display = 'none';
    pauseText.textContent = 'Pause';
  }
}

/**
 * End ride
 */
function endRide() {
  Notification.confirm(
    'Are you sure you want to end your ride?',
    () => {
      showSummary();
    }
  );
}

// Expose functions to global scope for HTML onclick handlers
window.togglePause = togglePause;
window.endRide = endRide;

/**
 * Show ride summary
 */
function showSummary() {
  rideState.isRunning = false;
  if (updateTimer) clearInterval(updateTimer);

  const duration = rideState.elapsedSeconds;
  const avgPower = rideStats.powerReadings > 0
    ? Math.round(rideStats.totalPower / rideStats.powerReadings)
    : 0;
  const avgCadence = rideStats.cadenceReadings > 0
    ? Math.round(rideStats.totalCadence / rideStats.cadenceReadings)
    : 0;
  const distance = telemetry.distance || 0;
  const totalKJ = (avgPower * duration) / 1000;
  const calories = Math.round(totalKJ / 4.184);

  const overlay = document.createElement('div');
  overlay.className = 'summary-overlay';
  overlay.innerHTML = `
    <div class="summary-content">
      <div class="summary-icon">✓</div>
      <div class="summary-title">Ride Complete</div>

      <div class="summary-stats">
        <div class="summary-stat">
          <div class="summary-stat-value">${formatTime(duration)}</div>
          <div class="summary-stat-label">Duration</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${distance.toFixed(1)}<span class="stat-unit">km</span></div>
          <div class="summary-stat-label">Distance</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${avgPower}<span class="stat-unit">W</span></div>
          <div class="summary-stat-label">Avg Power</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${rideStats.maxPower}<span class="stat-unit">W</span></div>
          <div class="summary-stat-label">Max Power</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${avgCadence}<span class="stat-unit">rpm</span></div>
          <div class="summary-stat-label">Avg Cadence</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${calories}<span class="stat-unit">kcal</span></div>
          <div class="summary-stat-label">Calories</div>
        </div>
      </div>

      <div class="summary-actions">
        <button class="summary-btn primary" onclick="window.location.href='index.html'">Done</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

/**
 * Format time as MM:SS or H:MM:SS
 */
function formatTime(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ===== ANT+ Manager Handling =====

function initAntManager() {
  antManager = getAntManager();

  // Listen to status updates
  antManager.on('status', (status) => {
    currentStatus = { ...currentStatus, ...status };
    updateConnectionBadge();
    if (DeviceModal && DeviceModal.onStatusUpdate) {
      DeviceModal.onStatusUpdate(status);
    }
  });

  // Listen to device discovered events
  antManager.on('device_discovered', (device) => {
    if (DeviceModal && DeviceModal.onScanResult) {
      DeviceModal.onScanResult(device);
    }
  });

  // Listen to telemetry updates
  antManager.on('telemetry', (telemetry) => {
    updateTelemetry(telemetry);
  });

  // Listen to scan telemetry (from scanning mode)
  antManager.on('scan_telemetry', (telemetry) => {
    updateTelemetry(telemetry);
  });

  // Listen to log events
  antManager.on('log', (log) => {
    console.log(`[${log.level}]`, log.message);
  });

  console.log('ANT+ WebUSB Manager initialized for free ride');
}

function updateConnectionBadge() {
  TopBar.updateConnection(currentStatus.connection === 'connected', currentStatus.connectedDeviceId);
}

function updateTelemetry(data) {
  // Only merge defined values to avoid overwriting with undefined
  if (data.instantaneousPower !== undefined) telemetry.power = Math.round(data.instantaneousPower);
  if (data.instantaneousCadence !== undefined) telemetry.cadence = Math.round(data.instantaneousCadence);
  if (data.speed !== undefined) telemetry.speed = data.speed;
  if (data.heartRate !== undefined) telemetry.heartRate = data.heartRate;
  if (data.distance !== undefined) telemetry.distance = data.distance / 1000;

  // Update UI
  document.getElementById('current-power').textContent = telemetry.power || 0;
  document.getElementById('current-cadence').textContent = telemetry.cadence || 0;
  document.getElementById('current-speed').textContent = (telemetry.speed || 0).toFixed(1);
  document.getElementById('current-hr').textContent = telemetry.heartRate || '--';
  document.getElementById('current-distance').textContent = (telemetry.distance || 0).toFixed(2);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);

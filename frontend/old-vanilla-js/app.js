/**
 * Open Ride - Modern Training App
 */

import { getAntManager } from './antManager.js';

// Workout data (loaded from API)
let workouts = [];

// ANT+ Manager (WebUSB) - shared singleton
let antManager = null;

// State
let currentStatus = {
  dongle: 'disconnected',
  scan: 'idle',
  connection: 'disconnected',
  connectedDeviceId: null,
};
let discoveredDevices = new Map();
let currentWorkout = null;

// Active filters
let activeFilters = {
  duration: null,   // 'short' | 'medium' | 'long' | null
  tags: new Set(),  // selected tag strings
};

/**
 * Power zone colors
 */
const ZONE_COLORS = [
  { max: 0.60, color: '#808080' },  // Zone 1: Gray - Recovery
  { max: 0.75, color: '#008cff' },  // Zone 2: Blue - Endurance
  { max: 0.89, color: '#00d200' },  // Zone 3: Green - Tempo
  { max: 1.04, color: '#ffe600' },  // Zone 4: Yellow - Threshold
  { max: 1.18, color: '#ff9600' },  // Zone 5: Orange - VO2max
  { max: Infinity, color: '#ff1e1e' } // Zone 6: Red - Anaerobic
];

/**
 * Get zone color for a given power (as FTP percentage, e.g., 0.75 = 75%)
 */
function getZoneColor(power) {
  for (const zone of ZONE_COLORS) {
    if (power <= zone.max) {
      return zone.color;
    }
  }
  return ZONE_COLORS[ZONE_COLORS.length - 1].color;
}

/**
 * Initialize the application
 */
async function init() {
  TopBar.init({ type: 'main', activePage: 'home', showConnection: true, onConnectionClick: openDeviceModal });
  await loadWorkouts();
  setupFilters();
  renderWorkouts();
  initAntManager();
}

/**
 * Load workouts from API
 */
async function loadWorkouts() {
  try {
    const response = await fetch('/api/workouts');
    const data = await response.json();
    workouts = data.workouts;
  } catch (error) {
    console.error('Failed to load workouts:', error);
    workouts = [];
  }
}

/**
 * Generate chart bars from workout chart profile
 * Returns array of { height, color } objects
 */
function generateChartBars(workout) {
  const bars = [];

  // Use pre-computed chart profile from API
  if (workout.chartProfile && workout.chartProfile.length > 0) {
    for (const power of workout.chartProfile) {
      // Convert power (FTP %) to bar height (scale 0.3-1.5 FTP to 20-100%)
      const height = Math.min(100, Math.max(20, (power / 1.5) * 100));
      const color = getZoneColor(power);
      bars.push({ height, color });
    }
    return bars;
  }

  // Fallback if no chart profile
  for (let i = 0; i < 20; i++) {
    bars.push({ height: 50, color: ZONE_COLORS[1].color });
  }
  return bars;
}

/**
 * Build tag pills from workout data and wire up all filter click handlers
 */
function setupFilters() {
  // Collect unique tags across all workouts
  const allTags = [...new Set(workouts.flatMap(w => w.tags))].sort();

  const tagContainer = document.getElementById('tag-filters');
  tagContainer.innerHTML = allTags.map(tag =>
    `<button class="filter-pill" data-tag="${tag}">${tag}</button>`
  ).join('');

  // Duration pills – mutually exclusive toggle
  document.getElementById('duration-filters').addEventListener('click', (e) => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    const val = pill.dataset.duration;
    activeFilters.duration = activeFilters.duration === val ? null : val;
    document.querySelectorAll('#duration-filters .filter-pill').forEach(p =>
      p.classList.toggle('active', p.dataset.duration === activeFilters.duration)
    );
    renderWorkouts();
  });

  // Tag pills – multi-select toggle
  tagContainer.addEventListener('click', (e) => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    const tag = pill.dataset.tag;
    if (activeFilters.tags.has(tag)) {
      activeFilters.tags.delete(tag);
    } else {
      activeFilters.tags.add(tag);
    }
    pill.classList.toggle('active', activeFilters.tags.has(tag));
    renderWorkouts();
  });
}

/**
 * Return workouts matching current duration + tag filters
 */
function getFilteredWorkouts() {
  return workouts.filter(w => {
    // Duration filter
    if (activeFilters.duration) {
      const mins = w.totalDuration / 60;
      if (activeFilters.duration === 'short'  && mins > 30)  return false;
      if (activeFilters.duration === 'medium' && (mins <= 30 || mins > 60)) return false;
      if (activeFilters.duration === 'long'   && mins <= 60) return false;
    }
    // Tag filter – match any selected tag
    if (activeFilters.tags.size > 0) {
      if (!w.tags.some(t => activeFilters.tags.has(t))) return false;
    }
    return true;
  });
}

/**
 * Render workout cards
 */
function renderWorkouts() {
  const grid = document.getElementById('workouts-grid');
  const filtered = getFilteredWorkouts();

  if (workouts.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
        <p style="color: rgba(255,255,255,0.5);">No workouts available. Check the server connection.</p>
      </div>
    `;
    return;
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 3rem;">
        <p style="color: rgba(255,255,255,0.5);">No workouts match your filters.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(workout => {
    const bars = generateChartBars(workout);

    return `
    <div class="workout-card" onclick="openWorkout('${workout.id}')">
      <div class="workout-card-image">
        <div class="workout-chart">
          ${bars.map(bar => `
            <div class="workout-chart-bar" style="height: ${bar.height}%; background: ${bar.color}"></div>
          `).join('')}
        </div>
      </div>
      <div class="workout-card-content">
        <div class="workout-type">${workout.category}</div>
        <h3 class="workout-title">${workout.name}</h3>
        <div class="workout-meta">
          <div class="workout-meta-item">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
            </svg>
            ${workout.durationFormatted}
          </div>
          ${workout.estimatedTSS ? `
            <div class="workout-meta-item">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 2.05v2.02c3.95.49 7 3.85 7 7.93 0 3.21-1.92 6-4.72 7.28L13 17v5h5l-1.22-1.22C19.91 19.07 22 15.76 22 12c0-5.18-3.95-9.45-9-9.95zM11 2.05C5.94 2.55 2 6.81 2 12c0 3.76 2.09 7.07 5.22 8.78L6 22h5v-5l-2.28 2.28C6.92 18 5 15.21 5 12c0-4.08 3.05-7.44 7-7.93V2.05z"/>
              </svg>
              TSS ${workout.estimatedTSS}
            </div>
          ` : ''}
        </div>
        <p class="workout-description">${workout.description.substring(0, 100)}${workout.description.length > 100 ? '...' : ''}</p>
        <div class="workout-tags">
          ${workout.tags.slice(0, 3).map(tag => `<span class="workout-tag">${tag}</span>`).join('')}
        </div>
      </div>
    </div>
  `}).join('');
}

/**
 * Open workout activity modal or start workout page
 */
function openWorkout(workoutId) {
  currentWorkout = workouts.find(w => w.id === workoutId);
  if (!currentWorkout) return;

  document.getElementById('activity-title').textContent = currentWorkout.name;
  document.getElementById('activity-modal').classList.add('active');

  // Check if device is connected
  updateControlsState();
}

/**
 * Start the workout (navigate to workout page)
 */
function startWorkoutRide() {
  if (!currentWorkout) return;

  // Navigate to workout execution page
  window.location.href = `workout.html?id=${currentWorkout.id}`;
}

/**
 * Close activity modal
 */
function closeActivityModal() {
  document.getElementById('activity-modal').classList.remove('active');
  currentWorkout = null;
}

/**
 * Open device scan modal
 */
function openDeviceModal() {
  document.getElementById('device-modal').classList.add('active');
}

/**
 * Close device scan modal
 */
function closeDeviceModal() {
  document.getElementById('device-modal').classList.remove('active');
}

// Expose functions to global scope for HTML onclick handlers
window.openWorkout = openWorkout;
window.startWorkoutRide = startWorkoutRide;
window.closeActivityModal = closeActivityModal;
window.openDeviceModal = openDeviceModal;
window.closeDeviceModal = closeDeviceModal;

/**
 * Initialize ANT+ Manager with WebUSB
 */
function initAntManager() {
  antManager = getAntManager();

  // Listen to status updates
  antManager.on('status', (status) => {
    updateStatus(status);
  });

  // Listen to device discovered events
  antManager.on('device_discovered', (device) => {
    handleScanResult(device);
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

  console.log('ANT+ WebUSB Manager initialized');
}

/**
 * Update status display
 */
function updateStatus(status) {
  currentStatus = status;

  // Update dongle status
  const dongleEl = document.getElementById('dongle-status');
  dongleEl.textContent = capitalize(status.dongle);
  dongleEl.className = `status-value ${status.dongle}`;

  // Update scan status
  const scanEl = document.getElementById('scan-status');
  scanEl.textContent = capitalize(status.scan);
  scanEl.className = `status-value ${status.scan}`;

  // Update connection badge in nav
  TopBar.updateConnection(status.connection === 'connected', status.connectedDeviceId);

  // Update device ID in activity modal
  document.getElementById('device-id').textContent = status.connectedDeviceId || '-';

  // Update button states
  updateButtonStates();
  updateControlsState();
}

/**
 * Update button enabled/disabled states
 */
function updateButtonStates() {
  const { dongle, scan } = currentStatus;

  // Start scan: enabled when dongle connected and not scanning
  document.getElementById('btn-start-scan').disabled = dongle !== 'connected' || scan === 'scanning';

  // Stop scan: enabled when scanning
  document.getElementById('btn-stop-scan').disabled = scan !== 'scanning';
}

/**
 * Update workout controls state
 */
function updateControlsState() {
  const { connection } = currentStatus;
  const controlsEnabled = connection === 'connected';

  document.getElementById('input-power').disabled = !controlsEnabled;
  document.getElementById('input-resistance').disabled = !controlsEnabled;
  document.getElementById('btn-set-power').disabled = !controlsEnabled;
  document.getElementById('btn-set-resistance').disabled = !controlsEnabled;
}

/**
 * Handle scan result / discovered device
 */
function handleScanResult(data) {
  const deviceId = data.deviceId;
  if (!deviceId) return;

  // Update or add device
  discoveredDevices.set(deviceId, data);

  // Update UI
  renderDevicesList();
}

/**
 * Render devices list
 */
function renderDevicesList() {
  const listEl = document.getElementById('devices-list');
  const countEl = document.getElementById('devices-count');

  const devices = Array.from(discoveredDevices.values());
  
  if (devices.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 6c-3.87 0-7 3.13-7 7h2c0-2.76 2.24-5 5-5s5 2.24 5 5h2c0-3.87-3.13-7-7-7z"/>
          <path d="M12 2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8s8 3.59 8 8h2c0-5.52-4.48-10-10-10z"/>
        </svg>
        <p>Click "Start Scan" to discover devices</p>
      </div>
    `;
    countEl.textContent = 'Searching for devices...';
  } else {
    countEl.textContent = `${devices.length} Connection${devices.length === 1 ? '' : 's'} found`;
    
    listEl.innerHTML = devices.map(device => {
      const isSelected = currentStatus.connectedDeviceId === device.deviceId;
      const deviceName = getDeviceName(device.deviceId);
      
      return `
        <div class="device-item ${isSelected ? 'selected' : ''}" onclick="connectToDevice(${device.deviceId})">
          <div class="device-info">
            <div class="device-icon">
              🚴
            </div>
            <div class="device-details">
              <h4>${deviceName}</h4>
              <div class="device-type">Smart Trainer</div>
            </div>
          </div>
          <div class="device-signal">📶</div>
        </div>
      `;
    }).join('');
  }
}

/**
 * Get friendly device name
 */
function getDeviceName(deviceId) {
  const names = {
    12345: 'Wahoo KICKR CORE',
    54321: 'Wahoo KICKR',
    99999: 'Elite Direto',
  };
  return names[deviceId] || `Device ${deviceId}`;
}

/**
 * Start scanning for devices
 */
async function startScan() {
  if (!antManager) {
    console.error('ANT+ manager not initialized');
    return;
  }

  // If dongle not connected yet, initialize it first
  if (antManager.dongleStatus === 'disconnected') {
    const initialized = await antManager.initialize();
    if (!initialized) {
      alert('Failed to connect to ANT+ USB dongle. Please make sure it is plugged in and try again.');
      return;
    }
  }

  discoveredDevices.clear();
  renderDevicesList();
  await antManager.startScan();
}

/**
 * Stop scanning
 */
async function stopScan() {
  if (!antManager) return;
  await antManager.stopScan();
}

/**
 * Connect to a device
 */
async function connectToDevice(deviceId) {
  if (!antManager) return;
  await antManager.connect(deviceId);
  // Close modal after a short delay to see selection
  setTimeout(() => closeDeviceModal(), 500);
}

/**
 * Set target power
 */
async function setTargetPower() {
  if (!antManager) return;
  const power = parseInt(document.getElementById('input-power').value, 10);
  if (!isNaN(power) && power >= 0 && power <= 4000) {
    await antManager.setTargetPower(power);
  }
}

/**
 * Set resistance
 */
async function setResistance() {
  if (!antManager) return;
  const resistance = parseInt(document.getElementById('input-resistance').value, 10);
  if (!isNaN(resistance) && resistance >= 0 && resistance <= 100) {
    await antManager.setResistance(resistance);
  }
}

// Expose functions to global scope for HTML onclick handlers
window.startScan = startScan;
window.stopScan = stopScan;
window.connectToDevice = connectToDevice;
window.setTargetPower = setTargetPower;
window.setResistance = setResistance;

/**
 * Update telemetry display
 */
function updateTelemetry(data) {
  // Update main telemetry values
  document.getElementById('telem-power').textContent = Math.round(data.instantaneousPower || 0);
  document.getElementById('telem-cadence').textContent = Math.round(data.instantaneousCadence || 0);
  document.getElementById('telem-speed').textContent = (data.speed || 0).toFixed(1);
  document.getElementById('telem-heartrate').textContent = Math.round(data.heartRate || 0);

  // Update stats
  if (data.distance !== undefined) {
    const km = (data.distance / 1000).toFixed(2);
    document.getElementById('telem-distance').textContent = km + ' km';
  }

  if (data.elapsedTime !== undefined) {
    const seconds = Math.floor(data.elapsedTime / 4);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    document.getElementById('telem-elapsed').textContent = 
      `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // Update debug info
  if (data.pagesReceived) {
    document.getElementById('page-counters').textContent = JSON.stringify(data.pagesReceived);
  }
  document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
}

/**
 * Capitalize first letter
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Initialize on load
window.addEventListener('DOMContentLoaded', init);

// Close modals on ESC key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDeviceModal();
    closeActivityModal();
  }
});

/**
 * Open Ride - Workout Runner
 * Handles workout execution with real-time trainer data
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
let workout = null;
let workoutState = {
  isRunning: false,
  isPaused: false,
  startTime: null,
  pausedTime: 0,
  elapsedSeconds: 0,
  currentSegmentIndex: 0,
  currentIntervalRepeat: 0,
  segmentStartTime: 0,
  ftpWatts: 200, // Default FTP - should be configurable
};
let executionPlan = []; // Flattened list of segments with timing
let updateTimer = null;

// Telemetry data
let telemetry = {
  power: 0,
  cadence: 0,
  speed: 0,
  heartRate: 0,
  distance: 0,
};

// Stats for summary
let workoutStats = {
  totalPower: 0,
  powerReadings: 0,
  maxPower: 0,
  totalCadence: 0,
  cadenceReadings: 0,
  distance: 0,
  calories: 0,
};

// User settings (loaded from localStorage)
let userSettings = {
  ftp: 200,
  maxHr: 185,
  weight: 70,
  countdownDuration: 3,
};

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
        maxHr: settings.maxHr || 185,
        weight: settings.weight || 70,
        countdownDuration: settings.countdownDuration || 3,
      };
      // Update workout state with loaded FTP
      workoutState.ftpWatts = userSettings.ftp;
      console.log(`Loaded user settings: FTP=${userSettings.ftp}W, MaxHR=${userSettings.maxHr}bpm`);
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

/**
 * Initialize the workout runner
 */
async function init() {
  TopBar.init({ type: 'activity', backLabel: 'Exit Workout', title: 'Loading...', onConnectionClick: () => DeviceModal.open() });

  // Load settings from localStorage
  loadUserSettings();

  const urlParams = new URLSearchParams(window.location.search);
  const workoutId = urlParams.get('id');

  if (!workoutId) {
    Notification.error('No workout specified. Redirecting to workout list...');
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 2000);
    return;
  }
  
  // Load workout data
  try {
    const response = await fetch(`/api/workouts/${workoutId}`);
    if (!response.ok) throw new Error('Workout not found');
    workout = await response.json();
    
    TopBar.setTitle(workout.name);
    buildExecutionPlan();
    renderWorkoutGraph();
    renderUpcoming();
    
    // Initialize ANT+ manager
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

    // Start countdown
    showCountdown();
  } catch (error) {
    console.error('Failed to load workout:', error);
    Notification.error('Failed to load workout. Please try again or select a different workout.');
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 3000);
  }
}

/**
 * Build a flattened execution plan from workout elements
 */
function buildExecutionPlan() {
  executionPlan = [];
  let currentTime = 0;
  
  workout.elements.forEach((element, elementIndex) => {
    if (element.type === 'IntervalsT') {
      // Expand intervals into individual ON/OFF segments
      for (let rep = 0; rep < element.repeat; rep++) {
        // ON segment
        executionPlan.push({
          type: 'Interval ON',
          elementIndex,
          repeat: rep + 1,
          totalRepeats: element.repeat,
          duration: element.onDuration,
          startTime: currentTime,
          power: element.onPower,
          cadence: element.cadence,
          textEvents: rep === 0 ? element.textEvents : [],
        });
        currentTime += element.onDuration;
        
        // OFF segment
        executionPlan.push({
          type: 'Interval OFF',
          elementIndex,
          repeat: rep + 1,
          totalRepeats: element.repeat,
          duration: element.offDuration,
          startTime: currentTime,
          power: element.offPower,
          cadence: element.cadenceResting || element.cadence,
          textEvents: [],
        });
        currentTime += element.offDuration;
      }
    } else {
      executionPlan.push({
        type: element.type,
        elementIndex,
        duration: element.duration,
        startTime: currentTime,
        power: element.power,
        powerLow: element.powerLow,
        powerHigh: element.powerHigh,
        cadence: element.cadence,
        textEvents: element.textEvents || [],
      });
      currentTime += element.duration;
    }
  });
}

/**
 * Calculate target power for current time within a segment
 */
function getTargetPower(segment, timeInSegment) {
  if (segment.power !== undefined) {
    return Math.round(segment.power * workoutState.ftpWatts);
  }
  
  if (segment.powerLow !== undefined && segment.powerHigh !== undefined) {
    // Ramp or Warmup/Cooldown
    const progress = timeInSegment / segment.duration;
    const power = segment.powerLow + (segment.powerHigh - segment.powerLow) * progress;
    return Math.round(power * workoutState.ftpWatts);
  }
  
  return 0;
}

/**
 * Render workout profile graph on canvas
 */
function renderWorkoutGraph() {
  const canvas = document.getElementById('workout-graph');
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  ctx.scale(2, 2);
  
  const width = rect.width;
  const height = rect.height;
  const padding = { top: 20, bottom: 30, left: 10, right: 10 };
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;
  
  const totalDuration = workout.totalDuration;
  const maxPower = 1.5; // 150% FTP
  
  // Clear canvas
  ctx.fillStyle = 'transparent';
  ctx.fillRect(0, 0, width, height);
  
  // Draw segments
  executionPlan.forEach(segment => {
    const startX = padding.left + (segment.startTime / totalDuration) * graphWidth;
    const segmentWidth = (segment.duration / totalDuration) * graphWidth;
    
    if (segment.power !== undefined) {
      // Solid block
      const segmentHeight = (segment.power / maxPower) * graphHeight;
      ctx.fillStyle = getSegmentColor(segment);
      ctx.fillRect(startX, padding.top + graphHeight - segmentHeight, segmentWidth, segmentHeight);
    } else if (segment.powerLow !== undefined && segment.powerHigh !== undefined) {
      // Gradient ramp
      const lowHeight = (segment.powerLow / maxPower) * graphHeight;
      const highHeight = (segment.powerHigh / maxPower) * graphHeight;
      
      ctx.beginPath();
      ctx.moveTo(startX, padding.top + graphHeight - lowHeight);
      ctx.lineTo(startX + segmentWidth, padding.top + graphHeight - highHeight);
      ctx.lineTo(startX + segmentWidth, padding.top + graphHeight);
      ctx.lineTo(startX, padding.top + graphHeight);
      ctx.closePath();
      
      ctx.fillStyle = getSegmentColor(segment);
      ctx.fill();
    }
  });
  
  // Draw power zone lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  
  [0.5, 0.75, 1.0, 1.2].forEach(power => {
    const y = padding.top + graphHeight - (power / maxPower) * graphHeight;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    
    // Label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '10px system-ui';
    ctx.fillText(`${Math.round(power * 100)}%`, 2, y + 3);
  });
  
  ctx.setLineDash([]);
}

/**
 * Power zone definitions
 */
const POWER_ZONES = [
  { max: 0.60, color: 'rgba(128, 128, 128, 0.85)', zone: 1 },  // Zone 1: Gray - Recovery
  { max: 0.75, color: 'rgba(0, 140, 255, 0.85)', zone: 2 },    // Zone 2: Blue - Endurance
  { max: 0.89, color: 'rgba(0, 210, 0, 0.85)', zone: 3 },      // Zone 3: Green - Tempo
  { max: 1.04, color: 'rgba(255, 230, 0, 0.85)', zone: 4 },    // Zone 4: Yellow - Threshold
  { max: 1.18, color: 'rgba(255, 150, 0, 0.85)', zone: 5 },    // Zone 5: Orange - VO2max
  { max: Infinity, color: 'rgba(255, 30, 30, 0.85)', zone: 6 } // Zone 6: Red - Anaerobic
];

/**
 * Get power zone number (1-6) for a given FTP percentage
 */
function getPowerZone(power) {
  for (const zone of POWER_ZONES) {
    if (power <= zone.max) {
      return zone.zone;
    }
  }
  return 7;
}

/**
 * Get power zone for a segment
 */
function getSegmentZone(segment) {
  if (segment.type === 'FreeRide') {
    return 1; // Use zone 1 styling for free ride
  }

  let power;
  if (segment.power !== undefined) {
    power = segment.power;
  } else if (segment.powerLow !== undefined && segment.powerHigh !== undefined) {
    power = segment.powerHigh;
  } else {
    return 2; // Default to zone 2
  }

  return getPowerZone(power);
}

/**
 * Get color for a segment based on power zone (FTP percentage)
 */
function getSegmentColor(segment) {
  // For FreeRide segments, use a neutral gray
  if (segment.type === 'FreeRide') {
    return 'rgba(75, 85, 99, 0.6)';
  }

  // Get power as FTP percentage
  let power;
  if (segment.power !== undefined) {
    power = segment.power;
  } else if (segment.powerLow !== undefined && segment.powerHigh !== undefined) {
    // For ramps, use the higher power for color
    power = segment.powerHigh;
  } else {
    // Fallback to zone 2 color
    return POWER_ZONES[1].color;
  }

  // Find the matching zone
  for (const zone of POWER_ZONES) {
    if (power <= zone.max) {
      return zone.color;
    }
  }

  return POWER_ZONES[POWER_ZONES.length - 1].color;
}

/**
 * Render upcoming segments list
 */
function renderUpcoming() {
  const list = document.getElementById('upcoming-list');
  const currentIdx = workoutState.currentSegmentIndex;

  // Show current and next 5 segments
  const upcoming = executionPlan.slice(currentIdx, currentIdx + 6);

  list.innerHTML = upcoming.map((segment, idx) => {
    const isActive = idx === 0;
    const zone = getSegmentZone(segment);
    const power = segment.power !== undefined
      ? Math.round(segment.power * 100) + '% FTP'
      : segment.powerLow !== undefined
        ? `${Math.round(segment.powerLow * 100)}-${Math.round(segment.powerHigh * 100)}% FTP`
        : 'Free';

    const name = segment.type === 'Interval ON' || segment.type === 'Interval OFF'
      ? `${segment.type} (${segment.repeat}/${segment.totalRepeats})`
      : segment.type;

    return `
      <div class="upcoming-item ${isActive ? 'active' : ''} zone-${zone}">
        <div class="upcoming-name">${name}</div>
        <div class="upcoming-details">
          <span>${formatTime(segment.duration)}</span>
          <span>${power}</span>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Show countdown before workout starts
 */
function showCountdown() {
  const countdownDuration = userSettings.countdownDuration || 3;

  const overlay = document.createElement('div');
  overlay.className = 'countdown-overlay';
  overlay.innerHTML = `
    <div class="countdown-number" id="countdown-number">${countdownDuration}</div>
    <div class="countdown-text">Get ready...</div>
  `;
  document.body.appendChild(overlay);

  let count = countdownDuration;
  const countdownEl = overlay.querySelector('#countdown-number');

  const interval = setInterval(() => {
    count--;
    if (count > 0) {
      countdownEl.textContent = count;
    } else {
      clearInterval(interval);
      overlay.remove();
      startWorkout();
    }
  }, 1000);
}

/**
 * Start the workout
 */
function startWorkout() {
  workoutState.isRunning = true;
  workoutState.isPaused = false;
  workoutState.startTime = Date.now();
  workoutState.segmentStartTime = 0;

  // Reset power tracking
  lastSentPower = -1;

  // Start update loop
  updateTimer = setInterval(updateWorkout, 250);

  // Set initial target power
  updateTargetPower();
}

/**
 * Main workout update loop
 */
function updateWorkout() {
  if (!workoutState.isRunning || workoutState.isPaused) return;
  
  // Calculate elapsed time
  const now = Date.now();
  workoutState.elapsedSeconds = Math.floor((now - workoutState.startTime - workoutState.pausedTime) / 1000);
  
  // Find current segment
  let segmentIdx = 0;
  for (let i = 0; i < executionPlan.length; i++) {
    const segment = executionPlan[i];
    if (workoutState.elapsedSeconds >= segment.startTime && 
        workoutState.elapsedSeconds < segment.startTime + segment.duration) {
      segmentIdx = i;
      break;
    }
    if (i === executionPlan.length - 1 && 
        workoutState.elapsedSeconds >= segment.startTime + segment.duration) {
      // Workout complete
      completeWorkout();
      return;
    }
  }
  
  // Check for segment change
  if (segmentIdx !== workoutState.currentSegmentIndex) {
    workoutState.currentSegmentIndex = segmentIdx;
    workoutState.segmentStartTime = executionPlan[segmentIdx].startTime;
    renderUpcoming();
    updateTargetPower();
  }
  
  // Update UI
  const segment = executionPlan[segmentIdx];
  const timeInSegment = workoutState.elapsedSeconds - segment.startTime;

  // Segment info
  const segmentName = segment.type === 'Interval ON' || segment.type === 'Interval OFF'
    ? `${segment.type} (${segment.repeat}/${segment.totalRepeats})`
    : segment.type;
  document.getElementById('segment-name').textContent = segmentName;
  document.getElementById('segment-elapsed').textContent = formatTime(timeInSegment);
  document.getElementById('segment-duration').textContent = formatTime(segment.duration);
  
  // Time
  document.getElementById('elapsed-time').textContent = formatTime(workoutState.elapsedSeconds);
  document.getElementById('remaining-time').textContent = formatTime(workout.totalDuration - workoutState.elapsedSeconds);
  
  // Target power
  const targetPower = getTargetPower(segment, timeInSegment);
  document.getElementById('target-power').textContent = targetPower;
  document.getElementById('target-cadence').textContent = segment.cadence || 90;

  // Update progress line
  const progressPercent = (workoutState.elapsedSeconds / workout.totalDuration) * 100;
  document.getElementById('progress-line').style.left = progressPercent + '%';

  // Continuously update power for ramp segments
  updateContinuousPower();

  // Update stats
  if (telemetry.power > 0) {
    workoutStats.totalPower += telemetry.power;
    workoutStats.powerReadings++;
    workoutStats.maxPower = Math.max(workoutStats.maxPower, telemetry.power);
  }
  if (telemetry.cadence > 0) {
    workoutStats.totalCadence += telemetry.cadence;
    workoutStats.cadenceReadings++;
  }
}

/**
 * Update target power on trainer
 * Called when segment changes - sends initial power for the segment
 */
function updateTargetPower() {
  const segment = executionPlan[workoutState.currentSegmentIndex];
  if (!segment) return;

  const timeInSegment = workoutState.elapsedSeconds - segment.startTime;
  const targetPower = getTargetPower(segment, timeInSegment);

  // Send to trainer via WebSocket
  sendTargetPowerToTrainer(targetPower);
}

/**
 * Send target power to the trainer
 * Tracks last sent value to avoid sending duplicates
 */
let lastSentPower = -1;
async function sendTargetPowerToTrainer(power) {
  // Only send if connected and power changed significantly (>2W difference)
  if (currentStatus.connection === 'connected' && Math.abs(power - lastSentPower) > 2) {
    if (antManager) {
      await antManager.setTargetPower(power);
      lastSentPower = power;
    }
  }
}

/**
 * Continuously update power for ramp segments
 * Called on every update tick to handle gradual power changes
 */
function updateContinuousPower() {
  const segment = executionPlan[workoutState.currentSegmentIndex];
  if (!segment) return;

  // Check if this is a ramp segment (has powerLow and powerHigh)
  const isRampSegment = segment.powerLow !== undefined && segment.powerHigh !== undefined;

  if (isRampSegment) {
    const timeInSegment = workoutState.elapsedSeconds - segment.startTime;
    const targetPower = getTargetPower(segment, timeInSegment);
    sendTargetPowerToTrainer(targetPower);
  }
}


/**
 * Toggle pause state
 */
function togglePause() {
  workoutState.isPaused = !workoutState.isPaused;

  const pauseIcon = document.getElementById('pause-icon');
  const playIcon = document.getElementById('play-icon');
  const pauseText = document.getElementById('pause-text');

  if (workoutState.isPaused) {
    workoutState.pauseStart = Date.now();
    pauseIcon.style.display = 'none';
    playIcon.style.display = 'block';
    pauseText.textContent = 'Resume';
  } else {
    workoutState.pausedTime += Date.now() - workoutState.pauseStart;
    pauseIcon.style.display = 'block';
    playIcon.style.display = 'none';
    pauseText.textContent = 'Pause';
  }
}

/**
 * Skip to next segment
 */
function skipSegment() {
  const currentSegment = executionPlan[workoutState.currentSegmentIndex];
  const nextSegmentStart = currentSegment.startTime + currentSegment.duration;

  // Adjust elapsed time to skip to next segment
  const adjustment = nextSegmentStart - workoutState.elapsedSeconds;
  workoutState.startTime -= adjustment * 1000;
}

/**
 * End workout early
 */
function endWorkout() {
  Notification.confirm(
    'Are you sure you want to end the workout?',
    () => {
      completeWorkout();
    }
  );
}

// Expose functions to global scope for HTML onclick handlers
window.togglePause = togglePause;
window.skipSegment = skipSegment;
window.endWorkout = endWorkout;

/**
 * Workout completion
 */
function completeWorkout() {
  workoutState.isRunning = false;
  if (updateTimer) clearInterval(updateTimer);

  // Calculate stats
  const duration = workoutState.elapsedSeconds;
  const avgPower = workoutStats.powerReadings > 0
    ? Math.round(workoutStats.totalPower / workoutStats.powerReadings)
    : 0;
  const avgCadence = workoutStats.cadenceReadings > 0
    ? Math.round(workoutStats.totalCadence / workoutStats.cadenceReadings)
    : 0;
  const distance = telemetry.distance || 0;

  // Estimate calories (rough: ~3.6 kJ per kcal, power in watts = joules/sec)
  const totalKJ = (avgPower * duration) / 1000;
  const calories = Math.round(totalKJ / 4.184); // Rough efficiency estimate

  // Calculate intensity factor (IF = avg power / FTP)
  const intensityFactor = userSettings.ftp > 0 ? (avgPower / userSettings.ftp).toFixed(2) : '--';

  // Show completion overlay
  const overlay = document.createElement('div');
  overlay.className = 'complete-overlay';
  overlay.innerHTML = `
    <div class="complete-content">
      <div class="complete-header">
        <div class="complete-icon">✓</div>
        <div class="complete-title">Workout Complete</div>
        <div class="complete-workout-name">${workout?.name || 'Workout'}</div>
      </div>

      <div class="complete-stats">
        <div class="complete-stat">
          <div class="complete-stat-value">${formatTime(duration)}</div>
          <div class="complete-stat-label">Duration</div>
        </div>
        <div class="complete-stat">
          <div class="complete-stat-value">${distance.toFixed(1)}<span class="stat-unit">km</span></div>
          <div class="complete-stat-label">Distance</div>
        </div>
        <div class="complete-stat highlight">
          <div class="complete-stat-value">${avgPower}<span class="stat-unit">W</span></div>
          <div class="complete-stat-label">Avg Power</div>
        </div>
        <div class="complete-stat">
          <div class="complete-stat-value">${workoutStats.maxPower}<span class="stat-unit">W</span></div>
          <div class="complete-stat-label">Max Power</div>
        </div>
        <div class="complete-stat">
          <div class="complete-stat-value">${avgCadence}<span class="stat-unit">rpm</span></div>
          <div class="complete-stat-label">Avg Cadence</div>
        </div>
        <div class="complete-stat">
          <div class="complete-stat-value">${calories}<span class="stat-unit">kcal</span></div>
          <div class="complete-stat-label">Calories</div>
        </div>
      </div>

      <div class="complete-secondary">
        <div class="complete-secondary-stat">
          <span class="secondary-label">Intensity Factor:</span>
          <span class="secondary-value">${intensityFactor}</span>
        </div>
        <div class="complete-secondary-stat">
          <span class="secondary-label">FTP:</span>
          <span class="secondary-value">${userSettings.ftp}W</span>
        </div>
      </div>

      <div class="complete-actions">
        <button class="complete-btn secondary" onclick="window.location.href='index.html'">Back to Home</button>
        <button class="complete-btn primary" onclick="window.location.reload()">Ride Again</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

/**
 * Format seconds to MM:SS or H:MM:SS
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
    updateStatus(status);
  });

  // Listen to device discovered events
  antManager.on('device_discovered', (device) => {
    DeviceModal.onScanResult(device);
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

  console.log('ANT+ WebUSB Manager initialized for workout runner');
}

function updateStatus(status) {
  currentStatus = { ...currentStatus, ...status };
  if (DeviceModal && DeviceModal.onStatusUpdate) {
    DeviceModal.onStatusUpdate(status);
  }
  TopBar.updateConnection(currentStatus.connection === 'connected', currentStatus.connectedDeviceId);
}

function updateTelemetry(data) {
  telemetry.power = Math.round(data.instantaneousPower || 0);
  telemetry.cadence = Math.round(data.instantaneousCadence || 0);
  telemetry.speed = data.speed || 0;
  telemetry.heartRate = Math.round(data.heartRate || 0);

  if (data.distance !== undefined) {
    telemetry.distance = data.distance / 1000;
    workoutStats.distance = telemetry.distance;
  }

  // Update UI
  document.getElementById('current-power').textContent = telemetry.power;
  document.getElementById('current-cadence').textContent = telemetry.cadence;
  document.getElementById('current-speed').textContent = (telemetry.speed || 0).toFixed(1);
  document.getElementById('current-hr').textContent = telemetry.heartRate || '--';
  document.getElementById('current-distance').textContent = (telemetry.distance || 0).toFixed(2);
  
  // HR Zone
  if (telemetry.heartRate > 0) {
    const zone = getHRZone(telemetry.heartRate);
    document.getElementById('hr-zone').textContent = `Zone ${zone}`;
  }
}

function getHRZone(hr) {
  // HR zones based on user's max HR from settings
  const maxHR = userSettings.maxHr || 185;
  const percent = hr / maxHR;

  if (percent < 0.6) return 1;
  if (percent < 0.7) return 2;
  if (percent < 0.8) return 3;
  if (percent < 0.9) return 4;
  return 5;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Initialize on load
window.addEventListener('DOMContentLoaded', init);


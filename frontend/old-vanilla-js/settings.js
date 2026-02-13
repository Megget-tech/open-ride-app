/**
 * Open Ride - Settings Management
 *
 * Handles user settings with localStorage persistence.
 * Settings are used by workout-runner.js for FTP-based power calculations.
 */

// Default settings
const DEFAULT_SETTINGS = {
  // Athlete Profile
  ftp: 200,           // Functional Threshold Power in watts
  maxHr: 185,         // Maximum heart rate
  restingHr: 60,      // Resting heart rate
  weight: 70,         // Body weight in kg

  // Equipment
  bikeWeight: 8,      // Bike weight in kg
  wheelCircumference: 2105, // Wheel circumference in mm

  // Preferences
  units: 'metric',    // 'metric' or 'imperial'
  autoConnect: false, // Auto-connect to last device
  soundEffects: true, // Play sound effects during workouts
  countdownDuration: 3, // Countdown before workout starts

  // Device memory
  lastDeviceId: null, // Last connected device ID
};

// Storage key
const STORAGE_KEY = 'openride_settings';

/**
 * Load settings from localStorage
 */
function loadSettings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  return { ...DEFAULT_SETTINGS };
}

/**
 * Save settings to localStorage
 */
function saveSettingsToStorage(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch (e) {
    console.error('Failed to save settings:', e);
    return false;
  }
}

/**
 * Get current settings (for use by other modules)
 */
function getSettings() {
  return loadSettings();
}

/**
 * Update a single setting
 */
function updateSetting(key, value) {
  const settings = loadSettings();
  settings[key] = value;
  return saveSettingsToStorage(settings);
}

/**
 * Initialize the settings page
 */
function init() {
  TopBar.init({ type: 'main', activePage: 'settings', showConnection: false });
  const settings = loadSettings();

  // Populate form fields
  document.getElementById('ftp').value = settings.ftp;
  document.getElementById('max-hr').value = settings.maxHr;
  document.getElementById('resting-hr').value = settings.restingHr;
  document.getElementById('weight').value = convertWeight(settings.weight, settings.units);
  document.getElementById('bike-weight').value = convertWeight(settings.bikeWeight, settings.units);
  document.getElementById('wheel-circumference').value = settings.wheelCircumference;
  document.getElementById('units').value = settings.units;
  document.getElementById('auto-connect').checked = settings.autoConnect;
  document.getElementById('sound-effects').checked = settings.soundEffects;
  document.getElementById('countdown-duration').value = settings.countdownDuration;

  // Update unit labels
  updateUnitLabels(settings.units);

  // Update power zones display
  updatePowerZones(settings.ftp);

  // Set up event listeners
  setupEventListeners();
}

/**
 * Set up event listeners for real-time updates
 */
function setupEventListeners() {
  // FTP changes update power zones in real-time
  document.getElementById('ftp').addEventListener('input', (e) => {
    const ftp = parseInt(e.target.value) || 200;
    updatePowerZones(ftp);
  });

  // Units change updates weight labels and converts values
  document.getElementById('units').addEventListener('change', (e) => {
    const newUnits = e.target.value;
    const oldUnits = newUnits === 'metric' ? 'imperial' : 'metric';

    // Convert weight values
    const weightInput = document.getElementById('weight');
    const bikeWeightInput = document.getElementById('bike-weight');

    const weight = parseFloat(weightInput.value) || 70;
    const bikeWeight = parseFloat(bikeWeightInput.value) || 8;

    if (newUnits === 'imperial') {
      // kg to lb
      weightInput.value = (weight * 2.20462).toFixed(1);
      bikeWeightInput.value = (bikeWeight * 2.20462).toFixed(1);
    } else {
      // lb to kg
      weightInput.value = (weight / 2.20462).toFixed(1);
      bikeWeightInput.value = (bikeWeight / 2.20462).toFixed(1);
    }

    updateUnitLabels(newUnits);
  });
}

/**
 * Update unit labels based on selected unit system
 */
function updateUnitLabels(units) {
  const weightUnit = units === 'imperial' ? 'lb' : 'kg';
  document.getElementById('weight-unit').textContent = weightUnit;
  document.getElementById('bike-weight-unit').textContent = weightUnit;
}

/**
 * Convert weight based on unit system
 */
function convertWeight(valueInKg, units) {
  if (units === 'imperial') {
    return (valueInKg * 2.20462).toFixed(1);
  }
  return valueInKg;
}

/**
 * Convert weight back to kg for storage
 */
function convertWeightToKg(value, units) {
  if (units === 'imperial') {
    return value / 2.20462;
  }
  return value;
}

/**
 * Update power zones display based on FTP
 */
function updatePowerZones(ftp) {
  document.getElementById('ftp-display').textContent = ftp;

  // Zone percentages
  const zones = [
    { id: 'zone1', max: 0.60 },
    { id: 'zone2', min: 0.60, max: 0.75 },
    { id: 'zone3', min: 0.76, max: 0.89 },
    { id: 'zone4', min: 0.90, max: 1.04 },
    { id: 'zone5', min: 1.05, max: 1.18 },
    { id: 'zone6', min: 1.18 },
  ];

  zones.forEach((zone, idx) => {
    const el = document.getElementById(`${zone.id}-range`);
    if (!el) return;

    if (zone.min === undefined) {
      el.textContent = `< ${Math.round(ftp * zone.max)}W`;
    } else if (zone.max === undefined) {
      el.textContent = `> ${Math.round(ftp * zone.min)}W`;
    } else {
      el.textContent = `${Math.round(ftp * zone.min)} - ${Math.round(ftp * zone.max)}W`;
    }
  });
}

/**
 * Save all settings from the form
 */
function saveSettings() {
  const units = document.getElementById('units').value;

  const settings = {
    ftp: parseInt(document.getElementById('ftp').value) || 200,
    maxHr: parseInt(document.getElementById('max-hr').value) || 185,
    restingHr: parseInt(document.getElementById('resting-hr').value) || 60,
    weight: convertWeightToKg(parseFloat(document.getElementById('weight').value) || 70, units),
    bikeWeight: convertWeightToKg(parseFloat(document.getElementById('bike-weight').value) || 8, units),
    wheelCircumference: parseInt(document.getElementById('wheel-circumference').value) || 2105,
    units: units,
    autoConnect: document.getElementById('auto-connect').checked,
    soundEffects: document.getElementById('sound-effects').checked,
    countdownDuration: parseInt(document.getElementById('countdown-duration').value) || 3,
    // Preserve last device ID
    lastDeviceId: loadSettings().lastDeviceId,
  };

  if (saveSettingsToStorage(settings)) {
    showSaveToast();
  }
}

/**
 * Reset all settings to defaults
 */
function resetToDefaults() {
  Notification.confirm(
    'Are you sure you want to reset all settings to their default values?',
    () => {
      // Clear storage
      localStorage.removeItem(STORAGE_KEY);

      // Reload page to show defaults
      window.location.reload();
    }
  );
}

/**
 * Show save confirmation toast
 */
function showSaveToast() {
  const toast = document.getElementById('save-toast');
  toast.classList.add('visible');

  setTimeout(() => {
    toast.classList.remove('visible');
  }, 3000);
}

// Export for use by other modules
if (typeof window !== 'undefined') {
  window.OpenRideSettings = {
    getSettings,
    updateSetting,
    loadSettings,
    DEFAULT_SETTINGS,
  };
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

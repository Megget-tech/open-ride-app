/**
 * ANT+ Manager Emulator for Frontend
 * Simulates ANT+ devices without requiring physical hardware
 * Useful for development and testing
 */

/**
 * Simple EventEmitter for browser
 */
class EventEmitter {
  constructor() {
    this.events = {};
  }

  on(event, listener) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
    return this;
  }

  off(event, listener) {
    if (!this.events[event]) return this;
    this.events[event] = this.events[event].filter(l => l !== listener);
    return this;
  }

  emit(event, ...args) {
    if (this.events[event]) {
      this.events[event].forEach(listener => listener(...args));
    }
  }

  removeAllListeners(event) {
    if (event) {
      delete this.events[event];
    } else {
      this.events = {};
    }
  }
}

/**
 * Emulated ANT+ heart rate monitor
 */
class EmulatedHrm {
  constructor(deviceId, name) {
    this.deviceId = deviceId;
    this.name = name;
    this.heartRate = 68;
  }

  update() {
    // Slow realistic drift with small noise
    this.heartRate += (Math.random() - 0.49) * 1.2;
    this.heartRate = Math.max(50, Math.min(185, this.heartRate));
    return { heartRate: Math.round(this.heartRate), deviceId: this.deviceId };
  }
}

/**
 * Emulated trainer device
 */
class EmulatedTrainer {
  constructor(deviceId, name) {
    this.deviceId = deviceId;
    this.name = name;

    // Simulated state
    this.targetPower = 0;
    this.resistance = 0;
    this.currentPower = 0;
    this.cadence = 0;
    this.speed = 0;
    this.heartRate = 0;
    this.distance = 0;
    this.elapsedTime = 0;
    this.accumulatedPower = 0;

    // Physics simulation
    this.inertia = 0.95;
    this.noise = 5;
  }

  /**
   * Update simulated telemetry (called every 250ms)
   */
  update() {
    // Smooth power towards target
    if (this.targetPower > 0) {
      const powerDiff = this.targetPower - this.currentPower;
      this.currentPower += powerDiff * 0.1;
    } else if (this.resistance > 0) {
      // Resistance mode - simulate some power output
      this.currentPower = 100 + (this.resistance / 100) * 200;
    } else {
      // Coast down
      this.currentPower *= 0.95;
    }

    // Add some realistic noise
    this.currentPower += (Math.random() - 0.5) * this.noise;
    this.currentPower = Math.max(0, this.currentPower);

    // Simulate cadence (60-95 rpm when pedaling)
    if (this.currentPower > 20) {
      this.cadence = 65 + Math.random() * 30;
    } else {
      this.cadence *= 0.9;
    }

    // Calculate speed from power (simplified physics)
    // Speed (m/s) ≈ (Power / 200)^(1/3) * 10
    if (this.currentPower > 0) {
      this.speed = Math.pow(this.currentPower / 200, 1/3) * 10;
    } else {
      this.speed *= 0.9;
    }

    // Simulate heart rate (120-180 bpm based on power)
    if (this.currentPower > 0) {
      const targetHr = 100 + (this.currentPower / 300) * 80;
      this.heartRate += (targetHr - this.heartRate) * 0.05;
    } else {
      this.heartRate *= 0.99;
    }

    // Update distance (speed is in m/s, update every 250ms)
    this.distance += this.speed * 0.25;

    // Update elapsed time (in ANT+ time units: 1/4 second)
    this.elapsedTime += 1;

    // Update accumulated power
    this.accumulatedPower += this.currentPower * 0.25;

    return this.getTelemetry();
  }

  /**
   * Get current telemetry
   */
  getTelemetry() {
    return {
      timestamp: Date.now(),
      deviceId: this.deviceId,

      equipmentType: undefined,
      equipmentTypeName: 'Trainer/Stationary Bike',
      elapsedTime: this.elapsedTime,
      distance: this.distance,
      speed: this.speed * 3.6, // Convert m/s to km/h
      heartRate: Math.round(this.heartRate),
      heartRateSource: 'emulated',

      resistance: this.resistance,

      instantaneousCadence: Math.round(this.cadence),
      instantaneousPower: Math.round(this.currentPower),
      accumulatedPower: Math.round(this.accumulatedPower),

      trainerStatus: 0,
      trainerStatusFlags: [],

      pagesReceived: { '0x10': 100, '0x19': 100 },
    };
  }

  setTargetPower(power) {
    this.targetPower = power;
  }

  setResistance(percent) {
    this.resistance = percent;
  }
}

/**
 * Emulated ANT+ Manager
 */
export class AntManagerEmulator extends EventEmitter {
  constructor() {
    super();

    this._dongleStatus = 'disconnected';
    this._scanStatus = 'idle';
    this._connectionStatus = 'disconnected';
    this._connectedDeviceId = null;

    this.discoveredDevices = new Map();
    this.connectedTrainer = null;
    this.telemetryInterval = null;

    // Create emulated trainers
    this.emulatedTrainers = [
      new EmulatedTrainer(12345, 'Wahoo KICKR CORE'),
      new EmulatedTrainer(54321, 'Wahoo KICKR'),
      new EmulatedTrainer(99999, 'Elite Direto'),
    ];

    // Heart rate monitors
    this.emulatedHrms = [
      new EmulatedHrm(77777, 'Garmin HRM-Pro'),
    ];
    this.discoveredHrmDevices = new Map();
    this.connectedHrm = null;
    this.hrmInterval = null;
  }

  // Getters for status
  get dongleStatus() {
    return this._dongleStatus;
  }

  get scanStatus() {
    return this._scanStatus;
  }

  get connectionStatus() {
    return this._connectionStatus;
  }

  get connectedDeviceId() {
    return this._connectedDeviceId;
  }

  /**
   * Initialize (simulated)
   */
  async initialize() {
    this.log('info', 'Initializing emulated ANT+ manager...');
    this.setDongleStatus('connecting');

    await new Promise(resolve => setTimeout(resolve, 500));

    this.setDongleStatus('connected');
    this.log('info', 'Emulated ANT+ manager ready!');
    return true;
  }

  /**
   * Start scanning (simulated)
   */
  async startScan() {
    if (this._scanStatus === 'scanning') {
      this.log('info', 'Already scanning');
      return true;
    }

    this.log('info', 'Starting emulated scan...');
    this.discoveredDevices.clear();
    this.setScanStatus('scanning');

    // Discover devices one by one with delays
    for (const trainer of this.emulatedTrainers) {
      await new Promise(resolve => setTimeout(resolve, 300));

      const device = {
        deviceId: trainer.deviceId,
        deviceType: 17,
        transmissionType: 0,
        timestamp: Date.now(),
      };

      this.discoveredDevices.set(trainer.deviceId, device);
      this.log('info', `Discovered emulated device: ${trainer.name} (${trainer.deviceId})`);
      this.emit('device_discovered', device);

      // Also emit scan telemetry
      this.emit('scan_telemetry', trainer.getTelemetry());
    }

    this.log('info', `Scan complete - found ${this.emulatedTrainers.length} emulated trainers`);
    return true;
  }

  /**
   * Stop scanning
   */
  async stopScan() {
    this.log('info', 'Stopping emulated scan...');
    this.setScanStatus('stopped');
  }

  /**
   * Connect to device (simulated)
   */
  async connect(deviceId) {
    const trainer = this.emulatedTrainers.find(t => t.deviceId === deviceId);
    if (!trainer) {
      this.log('error', `Emulated device ${deviceId} not found`);
      return false;
    }

    this.log('info', `Connecting to emulated device ${trainer.name}...`);
    this.setConnectionStatus('connecting');

    await new Promise(resolve => setTimeout(resolve, 500));

    this.connectedTrainer = trainer;
    this._connectedDeviceId = deviceId;
    this.setConnectionStatus('connected');

    // Start telemetry updates (every 250ms like real ANT+)
    this.telemetryInterval = setInterval(() => {
      const telemetry = this.connectedTrainer.update();
      this.emit('telemetry', telemetry);
    }, 250);

    this.log('info', `Connected to ${trainer.name}`);
    return true;
  }

  /**
   * Disconnect
   */
  async disconnect() {
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }

    this.connectedTrainer = null;
    this._connectedDeviceId = null;
    this.setConnectionStatus('disconnected');
    this.log('info', 'Disconnected from emulated trainer');
  }

  /**
   * Set target power
   */
  async setTargetPower(power) {
    if (!this.connectedTrainer) {
      this.log('error', 'Cannot set power: not connected');
      return false;
    }

    power = Math.max(0, Math.min(4000, Math.round(power)));
    this.log('info', `Setting emulated target power to ${power}W`);
    this.connectedTrainer.setTargetPower(power);
    return true;
  }

  /**
   * Set resistance
   */
  async setResistance(percent) {
    if (!this.connectedTrainer) {
      this.log('error', 'Cannot set resistance: not connected');
      return false;
    }

    percent = Math.max(0, Math.min(100, percent));
    this.log('info', `Setting emulated resistance to ${percent}%`);
    this.connectedTrainer.setResistance(percent);
    return true;
  }

  /**
   * Grade simulation stub for the emulator.
   * @param {number} gradePercent
   */
  async setGrade(gradePercent) {
    const approx = Math.max(0, Math.min(100, 40 + gradePercent * 5));
    return this.setResistance(approx);
  }

  /**
   * Scan for emulated HR monitors
   */
  async startHrmScan() {
    this.log('info', 'Starting emulated HRM scan...');
    this.discoveredHrmDevices.clear();

    for (const hrm of this.emulatedHrms) {
      await new Promise(resolve => setTimeout(resolve, 400));
      const device = {
        deviceId: hrm.deviceId,
        deviceType: 'hrm',
        name: hrm.name,
        timestamp: Date.now(),
      };
      this.discoveredHrmDevices.set(hrm.deviceId, device);
      this.log('info', `Discovered emulated HR monitor: ${hrm.name} (${hrm.deviceId})`);
      this.emit('hrm_discovered', device);
    }
    return true;
  }

  async stopHrmScan() {
    this.log('info', 'Stopping emulated HRM scan');
  }

  async connectHrm(deviceId) {
    const hrm = this.emulatedHrms.find(h => h.deviceId === deviceId);
    if (!hrm) {
      this.log('error', `Emulated HR monitor ${deviceId} not found`);
      return false;
    }

    if (this.hrmInterval) {
      clearInterval(this.hrmInterval);
      this.hrmInterval = null;
    }

    this.log('info', `Connecting to emulated HR monitor ${hrm.name}...`);
    await new Promise(resolve => setTimeout(resolve, 300));

    this.connectedHrm = hrm;
    this.emit('hrm_status', { connection: 'connected', connectedDeviceId: deviceId });

    this.hrmInterval = setInterval(() => {
      const data = this.connectedHrm.update();
      this.emit('hrm_telemetry', data);
    }, 1000);

    this.log('info', `Connected to ${hrm.name}`);
    return true;
  }

  async disconnectHrm() {
    if (this.hrmInterval) {
      clearInterval(this.hrmInterval);
      this.hrmInterval = null;
    }
    this.connectedHrm = null;
    this.emit('hrm_status', { connection: 'disconnected', connectedDeviceId: null });
    this.log('info', 'Disconnected from emulated HR monitor');
  }

  getDiscoveredHrmDevices() {
    return Array.from(this.discoveredHrmDevices.values());
  }

  /**
   * Get discovered devices
   */
  getDiscoveredDevices() {
    return Array.from(this.discoveredDevices.values());
  }

  /**
   * Shutdown
   */
  async shutdown() {
    this.log('info', 'Shutting down emulated ANT+ manager...');
    await this.disconnect();
    await this.disconnectHrm();
    this.setDongleStatus('disconnected');
  }

  // Status setters
  setDongleStatus(status) {
    this._dongleStatus = status;
    this.emitStatus();
  }

  setScanStatus(status) {
    this._scanStatus = status;
    this.emitStatus();
  }

  setConnectionStatus(status) {
    this._connectionStatus = status;
    this.emitStatus();
  }

  emitStatus() {
    this.emit('status', {
      dongle: this._dongleStatus,
      scan: this._scanStatus,
      connection: this._connectionStatus,
      connectedDeviceId: this._connectedDeviceId,
    });
  }

  /**
   * Log helper
   */
  log(level, message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] [EMULATOR] ${message}`;
    console.log(logMessage);
    this.emit('log', { level, message, timestamp });
  }
}

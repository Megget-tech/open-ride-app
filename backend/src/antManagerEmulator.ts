/**
 * ANT+ Manager Emulator - Simulates USB dongle and trainer for development
 * 
 * This emulator provides realistic simulation of:
 * - ANT+ USB dongle connection
 * - Device scanning with fake trainers
 * - Trainer connection and data streaming
 * - Control commands (power/resistance)
 */

import { EventEmitter } from 'events';
import {
  DongleStatus,
  ScanStatus,
  ConnectionStatus,
  DiscoveredDevice,
  TelemetryData,
} from './types.js';

interface EmulatorConfig {
  // Simulated devices
  devices: Array<{
    deviceId: number;
    name: string;
    equipmentType: string;
  }>;
  // How often to send telemetry updates (ms)
  telemetryInterval: number;
  // Simulate realistic power/cadence changes
  realisticSimulation: boolean;
}

const DEFAULT_CONFIG: EmulatorConfig = {
  devices: [
    { deviceId: 12345, name: 'Wahoo KICKR CORE', equipmentType: 'Trainer' },
    { deviceId: 54321, name: 'Wahoo KICKR', equipmentType: 'Trainer' },
    { deviceId: 99999, name: 'Elite Direto', equipmentType: 'Trainer' },
  ],
  telemetryInterval: 250, // 4 Hz (typical ANT+ FE-C rate)
  realisticSimulation: true,
};

export class AntManagerEmulator extends EventEmitter {
  private config: EmulatorConfig;
  private _dongleStatus: DongleStatus = 'disconnected';
  private _scanStatus: ScanStatus = 'idle';
  private _connectionStatus: ConnectionStatus = 'disconnected';
  private _connectedDeviceId: number | null = null;

  private discoveredDevices: Map<number, DiscoveredDevice> = new Map();
  private telemetryTimer: NodeJS.Timeout | null = null;
  
  // Simulation state
  private simulationState = {
    // Current rider output
    currentPower: 0,
    currentCadence: 0,
    currentSpeed: 0,
    currentHeartRate: 0,
    
    // Accumulated values
    distance: 0,
    elapsedTime: 0,
    accumulatedPower: 0,
    
    // Target values (from control commands)
    targetPower: 0,
    targetResistance: 50,
    
    // For realistic simulation
    lastUpdateTime: Date.now(),
    pageCounter: 0,
  };

  constructor(config: Partial<EmulatorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // Getters for status (same as real AntManager)
  get dongleStatus(): DongleStatus {
    return this._dongleStatus;
  }

  get scanStatus(): ScanStatus {
    return this._scanStatus;
  }

  get connectionStatus(): ConnectionStatus {
    return this._connectionStatus;
  }

  get connectedDeviceId(): number | null {
    return this._connectedDeviceId;
  }

  /**
   * Initialize the emulated ANT+ USB dongle
   */
  async initialize(): Promise<boolean> {
    this.log('info', '[EMULATOR] Initializing emulated ANT+ manager...');
    this.setDongleStatus('connecting');

    // Simulate connection delay
    await this.delay(500);

    this.log('info', '[EMULATOR] Virtual GarminStick3 connected successfully');
    this.setDongleStatus('connected');
    return true;
  }

  /**
   * Start scanning for emulated FE-C devices
   */
  async startScan(): Promise<boolean> {
    if (this._dongleStatus !== 'connected') {
      this.log('error', '[EMULATOR] Cannot scan: dongle not connected');
      return false;
    }

    if (this._scanStatus === 'scanning') {
      this.log('info', '[EMULATOR] Already scanning');
      return true;
    }

    this.log('info', '[EMULATOR] Starting FE-C device scan...');
    this.discoveredDevices.clear();
    this.setScanStatus('scanning');

    // Simulate discovering devices one by one
    for (let i = 0; i < this.config.devices.length; i++) {
      await this.delay(300 + Math.random() * 500); // Random discovery time

      // Check if scan was stopped while waiting
      if (this.scanStatus !== 'scanning') break;
      
      const deviceConfig = this.config.devices[i];
      const device: DiscoveredDevice = {
        deviceId: deviceConfig.deviceId,
        deviceType: 17, // FE-C device type
        transmissionType: 0,
        timestamp: Date.now(),
      };

      this.discoveredDevices.set(device.deviceId, device);
      this.log('info', `[EMULATOR] Discovered device: ${deviceConfig.name} (ID: ${device.deviceId})`);
      this.emit('device_discovered', device);

      // Also emit some scan telemetry
      this.emit('scan_telemetry', this.generateTelemetry(device.deviceId, true));
    }

    this.log('info', `[EMULATOR] Scan complete - found ${this.discoveredDevices.size} devices`);
    return true;
  }

  /**
   * Stop scanning
   */
  async stopScan(): Promise<void> {
    if (this._scanStatus === 'scanning') {
      this.log('info', '[EMULATOR] Stopping scan...');
      this.setScanStatus('stopped');
    }
  }

  /**
   * Connect to a specific emulated device
   */
  async connect(deviceId: number): Promise<boolean> {
    if (this._dongleStatus !== 'connected') {
      this.log('error', '[EMULATOR] Cannot connect: dongle not connected');
      return false;
    }

    const device = this.discoveredDevices.get(deviceId);
    if (!device) {
      this.log('error', `[EMULATOR] Device ${deviceId} not found in discovered devices`);
      return false;
    }

    if (this._connectionStatus === 'connected') {
      if (this._connectedDeviceId === deviceId) {
        this.log('info', `[EMULATOR] Already connected to device ${deviceId}`);
        return true;
      }
      await this.disconnect();
    }

    // Stop scanning if active
    if (this._scanStatus === 'scanning') {
      await this.stopScan();
    }

    const deviceName = this.config.devices.find(d => d.deviceId === deviceId)?.name || 'Unknown';
    this.log('info', `[EMULATOR] Connecting to ${deviceName} (${deviceId})...`);
    this.setConnectionStatus('connecting');

    // Simulate connection delay
    await this.delay(300);

    this._connectedDeviceId = deviceId;
    this.setConnectionStatus('connected');
    this.log('info', `[EMULATOR] Connected to device ${deviceId}`);

    // Reset simulation state
    this.resetSimulation();

    // Start sending telemetry
    this.startTelemetry();

    return true;
  }

  /**
   * Disconnect from current device
   */
  async disconnect(): Promise<void> {
    if (this._connectionStatus === 'connected') {
      this.log('info', '[EMULATOR] Disconnecting...');
      this.stopTelemetry();
      this._connectedDeviceId = null;
      this.setConnectionStatus('disconnected');
    }
  }

  /**
   * Set target power (ERG mode)
   */
  async setTargetPower(power: number): Promise<boolean> {
    if (this._connectionStatus !== 'connected') {
      this.log('error', '[EMULATOR] Cannot set power: not connected');
      return false;
    }

    power = Math.max(0, Math.min(4000, Math.round(power)));
    this.simulationState.targetPower = power;
    this.log('info', `[EMULATOR] Target power set to ${power}W`);
    return true;
  }

  /**
   * Set basic resistance
   */
  async setResistance(percent: number): Promise<boolean> {
    if (this._connectionStatus !== 'connected') {
      this.log('error', '[EMULATOR] Cannot set resistance: not connected');
      return false;
    }

    percent = Math.max(0, Math.min(100, percent));
    this.simulationState.targetResistance = percent;
    this.log('info', `[EMULATOR] Resistance set to ${percent}%`);
    return true;
  }

  /**
   * Get list of discovered devices
   */
  getDiscoveredDevices(): DiscoveredDevice[] {
    return Array.from(this.discoveredDevices.values());
  }

  /**
   * Shutdown emulator
   */
  async shutdown(): Promise<void> {
    this.log('info', '[EMULATOR] Shutting down...');
    await this.disconnect();
    await this.stopScan();
    this.setDongleStatus('disconnected');
    this.log('info', '[EMULATOR] Shutdown complete');
  }

  // Private methods

  private startTelemetry(): void {
    if (this.telemetryTimer) return;

    this.telemetryTimer = setInterval(() => {
      if (this._connectionStatus === 'connected' && this._connectedDeviceId) {
        const telemetry = this.generateTelemetry(this._connectedDeviceId, false);
        this.emit('telemetry', telemetry);
      }
    }, this.config.telemetryInterval);
  }

  private stopTelemetry(): void {
    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
  }

  private resetSimulation(): void {
    const now = Date.now();
    this.simulationState = {
      currentPower: 0,
      currentCadence: 0,
      currentSpeed: 0,
      currentHeartRate: 0,
      distance: 0,
      elapsedTime: 0,
      accumulatedPower: 0,
      targetPower: 0,
      targetResistance: 50,
      lastUpdateTime: now,
      pageCounter: 0,
    };
  }

  private generateTelemetry(deviceId: number, isScanning: boolean): TelemetryData {
    const state = this.simulationState;
    const now = Date.now();
    const deltaTime = (now - state.lastUpdateTime) / 1000; // seconds
    state.lastUpdateTime = now;

    if (!isScanning && this.config.realisticSimulation) {
      // Update simulation based on realistic physics
      this.updateRealisticSimulation(deltaTime);
    } else {
      // Simple static values for scanning
      state.currentPower = 100 + Math.random() * 50;
      state.currentCadence = 80 + Math.random() * 10;
      state.currentSpeed = 25 + Math.random() * 5;
      state.currentHeartRate = 140 + Math.random() * 10;
    }

    state.pageCounter++;

    return {
      timestamp: now,
      deviceId,
      equipmentType: 25, // Trainer
      equipmentTypeName: 'Trainer',
      elapsedTime: Math.round(state.elapsedTime * 4), // ANT+ uses 0.25s resolution
      distance: Math.round(state.distance),
      speed: state.currentSpeed,
      heartRate: Math.round(state.currentHeartRate),
      heartRateSource: 'Trainer', // From trainer
      cycleLength: undefined,
      incline: undefined,
      resistance: state.targetResistance,
      eventCount: state.pageCounter % 256,
      instantaneousCadence: Math.round(state.currentCadence),
      instantaneousPower: Math.round(state.currentPower),
      accumulatedPower: Math.round(state.accumulatedPower),
      trainerStatus: 0,
      trainerStatusFlags: [],
      pagesReceived: {
        '0x10': Math.floor(state.pageCounter / 4),
        '0x19': state.pageCounter,
      },
    };
  }

  private updateRealisticSimulation(deltaTime: number): void {
    const state = this.simulationState;

    // Simulate rider ramping up/down to target power
    if (state.targetPower > 0) {
      const powerDiff = state.targetPower - state.currentPower;
      const rampRate = 20; // W/s
      state.currentPower += Math.sign(powerDiff) * Math.min(Math.abs(powerDiff), rampRate * deltaTime);
    } else {
      // Natural decay when no target
      state.currentPower = Math.max(0, state.currentPower - 10 * deltaTime);
    }

    // Cadence follows power somewhat
    const targetCadence = state.currentPower > 50 ? 70 + (state.currentPower / 10) : 0;
    const cadenceDiff = targetCadence - state.currentCadence;
    state.currentCadence += Math.sign(cadenceDiff) * Math.min(Math.abs(cadenceDiff), 5 * deltaTime);
    state.currentCadence = Math.max(0, Math.min(120, state.currentCadence));

    // Speed based on power and resistance (simplified physics)
    // Higher power = higher speed, higher resistance = lower speed
    const resistanceFactor = 1 - (state.targetResistance / 200); // 0.5 to 1.0
    const targetSpeed = state.currentPower > 0 
      ? Math.sqrt(state.currentPower * resistanceFactor) * 2.5
      : 0;
    const speedDiff = targetSpeed - state.currentSpeed;
    state.currentSpeed += Math.sign(speedDiff) * Math.min(Math.abs(speedDiff), 2 * deltaTime);
    state.currentSpeed = Math.max(0, state.currentSpeed);

    // Heart rate loosely follows power with some lag
    const targetHR = 120 + (state.currentPower / 3);
    const hrDiff = targetHR - state.currentHeartRate;
    state.currentHeartRate += Math.sign(hrDiff) * Math.min(Math.abs(hrDiff), 2 * deltaTime);
    state.currentHeartRate = Math.max(100, Math.min(190, state.currentHeartRate));

    // Add some natural variation
    state.currentPower += (Math.random() - 0.5) * 3;
    state.currentCadence += (Math.random() - 0.5) * 2;
    state.currentHeartRate += (Math.random() - 0.5);

    // Update accumulated values
    state.elapsedTime += deltaTime;
    state.distance += (state.currentSpeed / 3.6) * deltaTime; // km/h to m/s
    state.accumulatedPower += state.currentPower * deltaTime;
  }

  // Status management (same as real AntManager)
  private setDongleStatus(status: DongleStatus): void {
    this._dongleStatus = status;
    this.emitStatus();
  }

  private setScanStatus(status: ScanStatus): void {
    this._scanStatus = status;
    this.emitStatus();
  }

  private setConnectionStatus(status: ConnectionStatus): void {
    this._connectionStatus = status;
    this.emitStatus();
  }

  private emitStatus(): void {
    this.emit('status', {
      dongle: this._dongleStatus,
      scan: this._scanStatus,
      connection: this._connectionStatus,
      connectedDeviceId: this._connectedDeviceId,
    });
  }

  private log(level: 'info' | 'error' | 'warn', message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    console.log(logMessage);
    this.emit('log', { level, message, timestamp });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

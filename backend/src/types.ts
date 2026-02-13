/**
 * Types for ANT+ Trainer POC
 */

// WebSocket message types
export type WSMessageType =
  | 'status'
  | 'scan_result'
  | 'connected'
  | 'disconnected'
  | 'telemetry'
  | 'error'
  | 'log';

// Dongle status
export type DongleStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// Scan status
export type ScanStatus = 'idle' | 'scanning' | 'stopped';

// Connection status
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

// Discovered device info
export interface DiscoveredDevice {
  deviceId: number;
  deviceType: number;
  transmissionType: number;
  rssi?: number;
  timestamp: number;
}

// FE-C Equipment types (from ANT+ spec)
export enum EquipmentType {
  General = 16,
  Treadmill = 19,
  Elliptical = 20,
  StationaryBike = 21,
  Rower = 22,
  Climber = 23,
  NordicSkier = 24,
  Trainer = 25, // Most smart trainers
}

// Telemetry data from FE-C device
export interface TelemetryData {
  timestamp: number;
  deviceId: number;

  // General FE Data (Page 0x10)
  equipmentType?: number;
  equipmentTypeName?: string;
  elapsedTime?: number; // seconds
  distance?: number; // meters
  speed?: number; // km/h
  heartRate?: number; // bpm
  heartRateSource?: string;

  // General Settings (Page 0x11)
  cycleLength?: number;
  incline?: number;
  resistance?: number;

  // Trainer Data (Page 0x19)
  eventCount?: number;
  instantaneousCadence?: number; // rpm
  instantaneousPower?: number; // watts
  accumulatedPower?: number; // watts

  // Trainer Status
  trainerStatus?: number;
  trainerStatusFlags?: string[];

  // Page counters for debugging
  pagesReceived?: { [key: string]: number };

  // Raw data for debugging
  rawData?: string;
}

// WebSocket messages from server to client
export interface WSOutgoingMessage {
  type: WSMessageType;
  timestamp: number;
  data: unknown;
}

// Status update message
export interface StatusMessage {
  dongle: DongleStatus;
  scan: ScanStatus;
  connection: ConnectionStatus;
  connectedDeviceId?: number;
}

// WebSocket commands from client to server
export type WSCommandType =
  | 'start_scan'
  | 'stop_scan'
  | 'connect'
  | 'disconnect'
  | 'set_target_power'
  | 'set_resistance';

export interface WSIncomingMessage {
  command: WSCommandType;
  data?: unknown;
}

export interface ConnectCommand {
  deviceId: number;
}

export interface SetTargetPowerCommand {
  power: number; // watts
}

export interface SetResistanceCommand {
  resistance: number; // 0-100 percent
}

// Interface for ANT+ manager (real or emulated)
export interface IAntManager {
  // Status getters
  dongleStatus: DongleStatus;
  scanStatus: ScanStatus;
  connectionStatus: ConnectionStatus;
  connectedDeviceId: number | null;

  // Lifecycle methods
  initialize(): Promise<boolean>;
  shutdown(): Promise<void>;

  // Scanning
  startScan(): Promise<boolean>;
  stopScan(): Promise<void>;
  getDiscoveredDevices(): DiscoveredDevice[];

  // Connection
  connect(deviceId: number): Promise<boolean>;
  disconnect(): Promise<void>;

  // Control
  setTargetPower(power: number): Promise<boolean>;
  setResistance(percent: number): Promise<boolean>;

  // Events (from EventEmitter)
  on(event: 'status', listener: (status: StatusMessage) => void): this;
  on(event: 'device_discovered', listener: (device: DiscoveredDevice) => void): this;
  on(event: 'scan_telemetry', listener: (telemetry: TelemetryData) => void): this;
  on(event: 'telemetry', listener: (telemetry: TelemetryData) => void): this;
  on(event: 'log', listener: (log: { level: string; message: string; timestamp: string }) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

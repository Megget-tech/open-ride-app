/**
 * Web Bluetooth Manager - Handles BLE trainer communication in the browser.
 *
 * Supports smart trainers via:
 *   - FTMS (Fitness Machine Service, 0x1826) — the primary standard for smart trainers
 *     with full ERG/resistance control (Wahoo KICKR, Elite, Tacx Neo, etc.)
 *   - Cycling Power Service (0x1818) — for read-only power meters
 *
 * Flow:
 *   1. initialize()   → checks Web Bluetooth API is available
 *   2. startScan()    → opens browser's native Bluetooth device picker
 *   3. connect(id)    → GATT connect + subscribe to notifications
 *   4. telemetry      → emitted via 'telemetry' event (same shape as ANT+ manager)
 *   5. setTargetPower / setResistance → FTMS Control Point writes
 *
 * Requires a Chromium-based browser (Chrome 56+, Edge, Opera) with Web Bluetooth enabled.
 */

// ─── FTMS UUIDs ──────────────────────────────────────────────────────────────
const FTMS_SERVICE             = 0x1826;
const FITNESS_MACHINE_FEATURE  = 0x2ACC;
const INDOOR_BIKE_DATA         = 0x2AD2;
const FITNESS_MACHINE_STATUS   = 0x2ADA;
const FTMS_CONTROL_POINT       = 0x2AD9;

// ─── Cycling Power Service UUIDs ─────────────────────────────────────────────
const CYCLING_POWER_SERVICE    = 0x1818;
const CYCLING_POWER_MEASUREMENT = 0x2A63;

// ─── FTMS Control Point op-codes (FTMS spec §4.16.2) ─────────────────────────
const FTMS_OP = {
  REQUEST_CONTROL:              0x00,
  RESET:                        0x01,
  SET_TARGET_RESISTANCE:        0x04,  // param: sint16 (×0.1, unitless)
  SET_TARGET_POWER:             0x05,  // param: sint16 (watts)
  START_RESUME:                 0x07,
  STOP_PAUSE:                   0x08,
  SET_INDOOR_BIKE_SIMULATION:   0x11,  // params: wind sint16 (0.001 m/s), grade sint16 (0.01%), crr uint8 (0.0001), cwa uint8 (0.01 kg/m)
  RESPONSE_CODE:                0x80,
};

// ─── Minimal EventEmitter ────────────────────────────────────────────────────
class EventEmitter {
  constructor() { this._events = {}; }
  on(event, fn) {
    (this._events[event] = this._events[event] || []).push(fn);
    return this;
  }
  off(event, fn) {
    if (this._events[event]) {
      this._events[event] = this._events[event].filter(l => l !== fn);
    }
    return this;
  }
  emit(event, ...args) {
    (this._events[event] || []).forEach(fn => fn(...args));
  }
  removeAllListeners(event) {
    if (event) delete this._events[event];
    else this._events = {};
  }
}

// ─── BluetoothManagerWebBluetooth ────────────────────────────────────────────
export class BluetoothManagerWebBluetooth extends EventEmitter {
  constructor() {
    super();

    // Hardware / connection objects
    this._selectedDevice    = null;  // BluetoothDevice chosen in picker
    this._gattServer        = null;
    this._ftmsService       = null;
    this._controlPointChar  = null;
    this._indoorBikeChar    = null;
    this._powerMeasureChar  = null;
    this._hasControl        = false;
    this._serviceType       = null;  // 'ftms' | 'cps' | null

    // Status mirrors (same names as ANT+ manager for API compatibility)
    this._dongleStatus     = 'disconnected'; // 'disconnected'|'connected'|'error'
    this._scanStatus       = 'idle';         // 'idle'|'scanning'|'stopped'
    this._connectionStatus = 'disconnected'; // 'disconnected'|'connecting'|'connected'
    this._connectedDeviceId   = null;
    this._connectedDeviceName = null;
  }

  // ── Public getters (same as AntManagerWebUSB) ──────────────────────────────
  get dongleStatus()     { return this._dongleStatus; }
  get scanStatus()       { return this._scanStatus; }
  get connectionStatus() { return this._connectionStatus; }
  get connectedDeviceId(){ return this._connectedDeviceId; }

  /**
   * Check that the Web Bluetooth API is available.
   * This is intentionally lightweight — no user gesture required.
   */
  async initialize() {
    this.log('info', 'Initialising Web Bluetooth manager…');

    if (typeof navigator === 'undefined' || !navigator.bluetooth) {
      this.log('error', 'Web Bluetooth is not supported in this browser');
      this._setDongleStatus('error');
      return false;
    }

    try {
      const available = await navigator.bluetooth.getAvailability();
      if (!available) {
        this.log('error', 'Bluetooth hardware is not available on this device');
        this._setDongleStatus('error');
        return false;
      }
    } catch {
      // getAvailability() is not supported in all browsers — treat as available
    }

    this.log('info', 'Web Bluetooth is ready');
    this._setDongleStatus('connected');
    return true;
  }

  /**
   * Open the browser's native Bluetooth device picker.
   * Filters for FTMS smart trainers and CPS power meters.
   * On success, emits 'device_discovered' with the selected device.
   */
  async startScan() {
    if (!navigator.bluetooth) {
      this.log('error', 'Web Bluetooth not available');
      return false;
    }

    // Auto-init if needed
    if (this._dongleStatus !== 'connected') {
      const ready = await this.initialize();
      if (!ready) return false;
    }

    this.log('info', 'Opening Bluetooth device picker…');
    this._setScanStatus('scanning');

    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [FTMS_SERVICE] },            // Smart trainers (FTMS)
          { services: [CYCLING_POWER_SERVICE] },   // Power meters (CPS)
        ],
        optionalServices: [
          FTMS_SERVICE,
          CYCLING_POWER_SERVICE,
          FITNESS_MACHINE_FEATURE,
        ],
      });

      this._selectedDevice = device;
      this.log('info', `Device selected: "${device.name || device.id}"`);

      this.emit('device_discovered', {
        deviceId: device.id,
        name:     device.name || 'BLE Trainer',
        type:     'BLE',
      });

      this._setScanStatus('stopped');
      return true;

    } catch (err) {
      if (err.name === 'NotFoundError') {
        // User dismissed the picker — not an error
        this.log('info', 'Bluetooth picker dismissed by user');
      } else {
        this.log('error', `Bluetooth requestDevice failed: ${err.message}`);
      }
      this._setScanStatus('stopped');
      return false;
    }
  }

  /** No-op for BLE — the browser picker handles scanning. */
  async stopScan() {
    this._setScanStatus('stopped');
  }

  /**
   * Connect to the previously selected Bluetooth device via GATT.
   * @param {string} deviceId — device.id from the 'device_discovered' event
   */
  async connect(deviceId) {
    const device = this._selectedDevice;
    if (!device || device.id !== deviceId) {
      this.log('error', 'Device not found — run startScan() first');
      return false;
    }

    this.log('info', `Connecting to "${device.name || deviceId}"…`);
    this._setConnectionStatus('connecting');

    try {
      this._gattServer = await device.gatt.connect();

      // Handle unexpected disconnection
      device.addEventListener('gattserverdisconnected', () => {
        this.log('info', 'GATT server disconnected unexpectedly');
        this._tearDownCharacteristics();
        this._connectedDeviceId   = null;
        this._connectedDeviceName = null;
        this._hasControl          = false;
        this._serviceType         = null;
        this._setConnectionStatus('disconnected');
        this._setDongleStatus('connected'); // BT adapter still available
      });

      // ── Attempt FTMS ──────────────────────────────────────────────────────
      let serviceFound = false;
      try {
        this._ftmsService = await this._gattServer.getPrimaryService(FTMS_SERVICE);
        this._serviceType = 'ftms';
        serviceFound = true;
        this.log('info', 'FTMS service found');
        await this._setupFtms();
      } catch {
        this.log('info', 'FTMS not available, trying Cycling Power Service…');
      }

      // ── Fall back to CPS (read-only power meters) ─────────────────────────
      if (!serviceFound) {
        try {
          const cpsService = await this._gattServer.getPrimaryService(CYCLING_POWER_SERVICE);
          this._serviceType = 'cps';
          serviceFound = true;
          this.log('info', 'Cycling Power Service found (read-only)');
          await this._setupCps(cpsService);
        } catch {
          this.log('error', 'No supported service found (FTMS or CPS)');
          await this.disconnect();
          return false;
        }
      }

      this._connectedDeviceId   = deviceId;
      this._connectedDeviceName = device.name || null;
      this._setConnectionStatus('connected');
      this.log('info', `Connected via ${this._serviceType.toUpperCase()}`);
      return true;

    } catch (err) {
      this.log('error', `GATT connection failed: ${err.message}`);
      this._setConnectionStatus('disconnected');
      return false;
    }
  }

  /** Disconnect cleanly from the GATT server. */
  async disconnect() {
    this._tearDownCharacteristics();

    if (this._selectedDevice && this._selectedDevice.gatt.connected) {
      try { this._selectedDevice.gatt.disconnect(); } catch { /* ignore */ }
    }

    this._gattServer          = null;
    this._ftmsService         = null;
    this._connectedDeviceId   = null;
    this._connectedDeviceName = null;
    this._hasControl          = false;
    this._serviceType         = null;
    this._setConnectionStatus('disconnected');
  }

  // ── FTMS setup ─────────────────────────────────────────────────────────────

  async _setupFtms() {
    // Indoor Bike Data — telemetry notifications
    try {
      this._indoorBikeChar = await this._ftmsService.getCharacteristic(INDOOR_BIKE_DATA);
      await this._indoorBikeChar.startNotifications();
      this._indoorBikeChar.addEventListener(
        'characteristicvaluechanged',
        (e) => this._handleIndoorBikeData(e.target.value)
      );
      this.log('info', 'Subscribed to Indoor Bike Data');
    } catch (err) {
      this.log('warn', `Indoor Bike Data not available: ${err.message}`);
    }

    // FTMS Status — informational notifications
    try {
      const statusChar = await this._ftmsService.getCharacteristic(FITNESS_MACHINE_STATUS);
      await statusChar.startNotifications();
      statusChar.addEventListener('characteristicvaluechanged', (e) => {
        const bytes = Array.from(new Uint8Array(e.target.value.buffer))
          .map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
        this.log('info', `FTMS Status: ${bytes}`);
      });
    } catch { /* non-critical */ }

    // Fitness Machine Control Point — ERG / resistance control
    try {
      this._controlPointChar = await this._ftmsService.getCharacteristic(FTMS_CONTROL_POINT);
      await this._controlPointChar.startNotifications();
      this._controlPointChar.addEventListener(
        'characteristicvaluechanged',
        (e) => this._handleControlPointResponse(e.target.value)
      );
      await this._requestControl();
    } catch (err) {
      this.log('warn', `Control Point not available: ${err.message} — trainer is read-only`);
    }
  }

  async _setupCps(service) {
    try {
      this._powerMeasureChar = await service.getCharacteristic(CYCLING_POWER_MEASUREMENT);
      await this._powerMeasureChar.startNotifications();
      this._powerMeasureChar.addEventListener(
        'characteristicvaluechanged',
        (e) => this._handleCpsMeasurement(e.target.value)
      );
      this.log('info', 'Subscribed to Cycling Power Measurement');
    } catch (err) {
      this.log('error', `CPS setup failed: ${err.message}`);
    }
  }

  /** Send REQUEST_CONTROL op-code to the FTMS Control Point. */
  async _requestControl() {
    if (!this._controlPointChar) return;
    try {
      const buf  = new ArrayBuffer(1);
      new DataView(buf).setUint8(0, FTMS_OP.REQUEST_CONTROL);
      await this._controlPointChar.writeValueWithResponse(buf);
      this._hasControl = true;
      this.log('info', 'FTMS control acquired');
    } catch (err) {
      this.log('warn', `Request control failed: ${err.message}`);
    }
  }

  _handleControlPointResponse(dataView) {
    if (dataView.byteLength < 3) return;
    if (dataView.getUint8(0) !== FTMS_OP.RESPONSE_CODE) return;
    const op     = dataView.getUint8(1);
    const result = dataView.getUint8(2);
    const names  = { 0x01:'Success', 0x02:'NotSupported', 0x03:'InvalidParam',
                     0x04:'OpFailed', 0x05:'ControlNotPermitted' };
    this.log('info', `CP response: op=0x${op.toString(16)} → ${names[result] || 'Unknown'}`);
  }

  // ── Characteristic tear-down ───────────────────────────────────────────────

  _tearDownCharacteristics() {
    for (const char of [this._indoorBikeChar, this._powerMeasureChar, this._controlPointChar]) {
      if (char) {
        try { char.stopNotifications(); } catch { /* ignore */ }
      }
    }
    this._indoorBikeChar   = null;
    this._powerMeasureChar = null;
    this._controlPointChar = null;
  }

  // ── ERG / resistance control ───────────────────────────────────────────────

  /**
   * Set ERG target power via FTMS (Op 0x05).
   * @param {number} watts
   */
  async setTargetPower(watts) {
    if (!this._controlPointChar || this._connectionStatus !== 'connected') {
      this.log('error', 'setTargetPower: not connected or no control');
      return false;
    }
    watts = Math.max(0, Math.min(4000, Math.round(watts)));
    try {
      if (!this._hasControl) await this._requestControl();
      const buf  = new ArrayBuffer(3);
      const view = new DataView(buf);
      view.setUint8(0, FTMS_OP.SET_TARGET_POWER);
      view.setInt16(1, watts, true); // sint16, little-endian
      await this._controlPointChar.writeValueWithResponse(buf);
      this.log('info', `Target power → ${watts} W`);
      return true;
    } catch (err) {
      this.log('error', `setTargetPower failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Set resistance level via FTMS (Op 0x04).
   * @param {number} percent — 0..100
   */
  async setResistance(percent) {
    if (!this._controlPointChar || this._connectionStatus !== 'connected') {
      this.log('error', 'setResistance: not connected or no control');
      return false;
    }
    percent = Math.max(0, Math.min(100, percent));
    // FTMS resistance level is sint16 in 0.1 steps (unitless); map 0–100 % → 0–1000
    const level = Math.round(percent * 10);
    try {
      if (!this._hasControl) await this._requestControl();
      const buf  = new ArrayBuffer(3);
      const view = new DataView(buf);
      view.setUint8(0, FTMS_OP.SET_TARGET_RESISTANCE);
      view.setInt16(1, level, true); // sint16, little-endian
      await this._controlPointChar.writeValueWithResponse(buf);
      this.log('info', `Resistance → ${percent}% (level ${level})`);
      return true;
    } catch (err) {
      this.log('error', `setResistance failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Simulate road gradient via FTMS Indoor Bike Simulation Parameters (Op 0x11).
   * The trainer adjusts resistance to match the physics of the given grade.
   * @param {number} gradePercent — road gradient in percent, e.g. 5.0 = 5% uphill, -3.0 = 3% downhill
   */
  async setGrade(gradePercent) {
    if (!this._controlPointChar || this._connectionStatus !== 'connected') {
      this.log('error', 'setGrade: not connected or no control');
      return false;
    }
    // Clamp to a physically reasonable range
    gradePercent = Math.max(-20, Math.min(20, gradePercent));

    // FTMS §4.16.2.13 — Set Indoor Bike Simulation Parameters (7 bytes total)
    //   byte 0   : op-code 0x11
    //   bytes 1-2: wind speed, sint16, resolution 0.001 m/s  → 0 (no wind)
    //   bytes 3-4: grade,      sint16, resolution 0.01 %     → gradePercent × 100
    //   byte 5   : Crr,        uint8,  resolution 0.0001     → 40 (≈ 0.0040, typical road tyre)
    //   byte 6   : CwA,        uint8,  resolution 0.01 kg/m  → 51 (≈ 0.51, typical road rider)
    const gradeRaw = Math.round(gradePercent * 100);
    try {
      if (!this._hasControl) await this._requestControl();
      const buf  = new ArrayBuffer(7);
      const view = new DataView(buf);
      view.setUint8(0,  FTMS_OP.SET_INDOOR_BIKE_SIMULATION);
      view.setInt16(1,  0,         true); // wind speed = 0
      view.setInt16(3,  gradeRaw,  true); // grade
      view.setUint8(5,  40);              // Crr
      view.setUint8(6,  51);              // CwA
      await this._controlPointChar.writeValueWithResponse(buf);
      this.log('info', `Grade → ${gradePercent.toFixed(1)}% (raw ${gradeRaw})`);
      return true;
    } catch (err) {
      this.log('error', `setGrade failed: ${err.message}`);
      return false;
    }
  }

  // ── Telemetry parsing ──────────────────────────────────────────────────────

  /**
   * Parse Indoor Bike Data characteristic (0x2AD2).
   * Spec: FTMS §4.9.1 — flags are a uint16 at offset 0, fields follow in order.
   *
   * Field presence (flag bits):
   *   bit 0: Instantaneous Speed ABSENT (present when 0)
   *   bit 1: Average Speed
   *   bit 2: Instantaneous Cadence
   *   bit 3: Average Cadence
   *   bit 4: Total Distance (3 bytes, uint24)
   *   bit 5: Resistance Level
   *   bit 6: Instantaneous Power
   *   bit 7: Average Power
   *   bit 8: Expended Energy (5 bytes)
   *   bit 9: Heart Rate
   *  bit 10: Metabolic Equivalent
   *  bit 11: Elapsed Time
   *  bit 12: Remaining Time
   */
  _handleIndoorBikeData(dataView) {
    let offset = 0;
    const flags = dataView.getUint16(offset, true);
    offset += 2;

    const t = {
      timestamp:  Date.now(),
      deviceId:   this._connectedDeviceId,
    };

    // Instantaneous Speed (present when bit 0 = 0; unit: km/h × 0.01)
    if (!(flags & 0x0001)) {
      if (offset + 2 <= dataView.byteLength) {
        t.speed = dataView.getUint16(offset, true) * 0.01;
        offset += 2;
      }
    }
    // Average Speed
    if (flags & 0x0002) offset += 2;

    // Instantaneous Cadence (rpm × 0.5)
    if (flags & 0x0004) {
      if (offset + 2 <= dataView.byteLength) {
        t.instantaneousCadence = dataView.getUint16(offset, true) * 0.5;
        offset += 2;
      }
    }
    // Average Cadence
    if (flags & 0x0008) offset += 2;

    // Total Distance (uint24, metres)
    if (flags & 0x0010) {
      if (offset + 3 <= dataView.byteLength) {
        t.distance = dataView.getUint8(offset)
          | (dataView.getUint8(offset + 1) << 8)
          | (dataView.getUint8(offset + 2) << 16);
        offset += 3;
      }
    }
    // Resistance Level
    if (flags & 0x0020) offset += 2;

    // Instantaneous Power (sint16, watts)
    if (flags & 0x0040) {
      if (offset + 2 <= dataView.byteLength) {
        t.instantaneousPower = dataView.getInt16(offset, true);
        offset += 2;
      }
    }
    // Average Power
    if (flags & 0x0080) offset += 2;

    // Expended Energy (uint16 total + uint16/hr + uint8/min = 5 bytes)
    if (flags & 0x0100) offset += 5;

    // Heart Rate (uint8, bpm)
    if (flags & 0x0200) {
      if (offset + 1 <= dataView.byteLength) {
        t.heartRate = dataView.getUint8(offset);
        offset += 1;
      }
    }
    // Metabolic Equivalent
    if (flags & 0x0400) offset += 1;

    // Elapsed Time (uint16, seconds)
    if (flags & 0x0800) {
      if (offset + 2 <= dataView.byteLength) {
        t.elapsedTime = dataView.getUint16(offset, true);
        offset += 2;
      }
    }
    // Remaining Time
    if (flags & 0x1000) offset += 2;

    this.emit('telemetry', t);
  }

  /**
   * Parse Cycling Power Measurement (0x2A63).
   * Provides instantaneous power; cadence derivable from crank revolution data.
   */
  _handleCpsMeasurement(dataView) {
    if (dataView.byteLength < 4) return;
    const flags = dataView.getUint16(0, true);
    const power = dataView.getInt16(2, true); // sint16, watts

    const t = {
      timestamp:          Date.now(),
      deviceId:           this._connectedDeviceId,
      instantaneousPower: power,
    };

    // Crank revolution data → cadence (optional)
    let offset = 4;
    if (flags & 0x0001) offset += 1; // Pedal Power Balance
    if (flags & 0x0004) offset += 4; // Accumulated Torque
    if (flags & 0x0010) offset += 6; // Wheel Revolution Data
    if ((flags & 0x0020) && offset + 4 <= dataView.byteLength) {
      // Crank Revolution Data: cumRevs (uint16) + lastEventTime (uint16)
      // Cadence calculation requires tracking delta over time; skip for now
      offset += 4;
    }

    this.emit('telemetry', t);
  }

  // ── Status helpers ─────────────────────────────────────────────────────────

  _setDongleStatus(s) { this._dongleStatus = s; this._emitStatus(); }
  _setScanStatus(s)   { this._scanStatus   = s; this._emitStatus(); }
  _setConnectionStatus(s) { this._connectionStatus = s; this._emitStatus(); }

  _emitStatus() {
    this.emit('status', {
      dongle:              this._dongleStatus,
      scan:                this._scanStatus,
      connection:          this._connectionStatus,
      connectedDeviceId:   this._connectedDeviceId,
      connectedDeviceName: this._connectedDeviceName,
    });
  }

  /** Return a snapshot of current status (used when re-subscribing). */
  getStatus() {
    return {
      dongle:              this._dongleStatus,
      scan:                this._scanStatus,
      connection:          this._connectionStatus,
      connectedDeviceId:   this._connectedDeviceId,
      connectedDeviceName: this._connectedDeviceName,
    };
  }

  log(level, message) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [BLE] [${level.toUpperCase()}] ${message}`);
    this.emit('log', { level, message, timestamp: ts });
  }
}

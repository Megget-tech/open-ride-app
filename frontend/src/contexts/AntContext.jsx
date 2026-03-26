import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getAntManager } from '../services/antManager';
import { BluetoothManagerWebBluetooth } from '../services/bluetoothManagerWebBluetooth';

const AntContext = createContext(null);

export function useAnt() {
  const context = useContext(AntContext);
  if (!context) {
    throw new Error('useAnt must be used within AntProvider');
  }
  return context;
}

export function AntProvider({ children }) {
  // Both managers are created once and kept alive for the session.
  const [antManager]       = useState(() => getAntManager());
  const [bluetoothManager] = useState(() => new BluetoothManagerWebBluetooth());

  // Connection type: 'ant+' | 'bluetooth' — persisted in localStorage
  const [connectionType, _setConnectionType] = useState(
    () => localStorage.getItem('openride_connection_type') || 'ant+'
  );

  // Tracks whether a workout is actively in progress (used by TopBar to guard navigation)
  const [workoutActive, setWorkoutActive] = useState(false);

  // Shared UI state
  const [status,            setStatus]            = useState('disconnected');
  const [isScanning,        setIsScanning]        = useState(false);
  const [discoveredDevices, setDiscoveredDevices] = useState([]);
  const [connectedDevice,   setConnectedDevice]   = useState(null);
  const [telemetry,         setTelemetry]         = useState({
    power: 0, cadence: 0, speed: 0, heartRate: 0, distance: 0, elapsedTime: 0
  });
  const [discoveredHrmDevices, setDiscoveredHrmDevices] = useState([]);
  const [connectedHrmDevice,   setConnectedHrmDevice]   = useState(null);

  // Tracks the latest HRM heart rate so trainer telemetry doesn't overwrite it
  const hrmHeartRateRef = useRef(0);

  // Ref so event handlers always access the latest discovered devices without
  // needing to be recreated whenever the list changes.
  const discoveredDevicesRef = useRef([]);
  useEffect(() => { discoveredDevicesRef.current = discoveredDevices; }, [discoveredDevices]);

  // ── Subscribe to the active manager's events ───────────────────────────────
  useEffect(() => {
    const manager = connectionType === 'bluetooth' ? bluetoothManager : antManager;

    // Reset shared state when switching managers
    setStatus('disconnected');
    setIsScanning(false);
    setDiscoveredDevices([]);
    setConnectedDevice(null);
    setDiscoveredHrmDevices([]);
    setConnectedHrmDevice(null);
    hrmHeartRateRef.current = 0;

    // Sync current hardware state (e.g. switching back to ANT+ while dongle connected)
    const current = manager.getStatus ? manager.getStatus() : null;
    if (current) applyStatus(current);

    function applyStatus(statusObj) {
      if (statusObj.connection === 'connected') {
        setStatus('connected');
        if (statusObj.connectedDeviceId) {
          setConnectedDevice({
            deviceId: statusObj.connectedDeviceId,
            name:     statusObj.connectedDeviceName || null,
          });
        }
      } else if (statusObj.connection === 'disconnected' || statusObj.connection === 'connecting') {
        if (statusObj.connection !== 'connecting') setConnectedDevice(null);
        setStatus(statusObj.dongle === 'connected' ? 'scanning' : 'disconnected');
      }
      setIsScanning(statusObj.scan === 'scanning');
    }

    const handleStatus = (statusObj) => {
      console.log(`[AntContext] Status (${connectionType}):`, statusObj);
      applyStatus(statusObj);
    };

    const handleDeviceDiscovered = (device) => {
      console.log(`[AntContext] Device discovered (${connectionType}):`, device);
      setDiscoveredDevices(prev => {
        if (prev.find(d => d.deviceId === device.deviceId)) return prev;
        return [...prev, device];
      });
    };

    const handleTelemetry = (data) => {
      setTelemetry({
        power:       data.instantaneousPower || 0,
        cadence:     data.instantaneousCadence || 0,
        speed:       data.speed || 0,
        // Prefer dedicated HRM reading if available
        heartRate:   hrmHeartRateRef.current || data.heartRate || 0,
        distance:    data.distance || 0,
        elapsedTime: data.elapsedTime || 0,
      });
    };

    const handleHrmDiscovered = (device) => {
      setDiscoveredHrmDevices(prev => {
        if (prev.find(d => d.deviceId === device.deviceId)) return prev;
        return [...prev, device];
      });
    };

    const handleHrmStatus = (statusObj) => {
      if (statusObj.connection === 'connected' && statusObj.connectedDeviceId) {
        setConnectedHrmDevice({ deviceId: statusObj.connectedDeviceId });
      } else {
        setConnectedHrmDevice(null);
        hrmHeartRateRef.current = 0;
      }
    };

    const handleHrmTelemetry = (data) => {
      hrmHeartRateRef.current = data.heartRate || 0;
      setTelemetry(prev => ({ ...prev, heartRate: data.heartRate || 0 }));
    };

    manager.on('status',            handleStatus);
    manager.on('device_discovered', handleDeviceDiscovered);
    manager.on('telemetry',         handleTelemetry);
    manager.on('hrm_discovered',    handleHrmDiscovered);
    manager.on('hrm_status',        handleHrmStatus);
    manager.on('hrm_telemetry',     handleHrmTelemetry);

    return () => {
      manager.off('status',            handleStatus);
      manager.off('device_discovered', handleDeviceDiscovered);
      manager.off('telemetry',         handleTelemetry);
      manager.off('hrm_discovered',    handleHrmDiscovered);
      manager.off('hrm_status',        handleHrmStatus);
      manager.off('hrm_telemetry',     handleHrmTelemetry);
    };
  }, [connectionType, antManager, bluetoothManager]);

  // ── Auto-initialise ANT+ if it was previously connected ───────────────────
  useEffect(() => {
    if (connectionType !== 'ant+') return;
    const wasConnected = localStorage.getItem('openride_was_connected');
    if (wasConnected === 'true' && status === 'disconnected') {
      console.log('[AntContext] Auto-initialising ANT+ manager');
      antManager.initialize().catch(err => {
        console.error('[AntContext] Auto-init failed:', err);
      });
    }
  }, [antManager, status, connectionType]);

  // ── Helper: resolve the active manager ────────────────────────────────────
  const _activeManager = useCallback(() => {
    return connectionType === 'bluetooth' ? bluetoothManager : antManager;
  }, [connectionType, antManager, bluetoothManager]);

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Switch between 'ant+' and 'bluetooth'.
   * Persists the choice in localStorage so it survives page reloads.
   */
  const setConnectionType = useCallback((type) => {
    if (type !== 'ant+' && type !== 'bluetooth') return;
    localStorage.setItem('openride_connection_type', type);
    _setConnectionType(type);
  }, []);

  const initialize = useCallback(async () => {
    try {
      return await _activeManager().initialize();
    } catch (err) {
      console.error('[AntContext] initialize failed:', err);
      throw err;
    }
  }, [_activeManager]);

  const startScan = useCallback(async () => {
    try {
      await _activeManager().startScan();
    } catch (err) {
      console.error('[AntContext] startScan failed:', err);
      throw err;
    }
  }, [_activeManager]);

  const stopScan = useCallback(async () => {
    try {
      await _activeManager().stopScan();
    } catch (err) {
      console.error('[AntContext] stopScan failed:', err);
      throw err;
    }
  }, [_activeManager]);

  const connect = useCallback(async (deviceId) => {
    try {
      await _activeManager().connect(deviceId);
    } catch (err) {
      console.error('[AntContext] connect failed:', err);
      throw err;
    }
  }, [_activeManager]);

  const disconnect = useCallback(async () => {
    try {
      await _activeManager().disconnect();
    } catch (err) {
      console.error('[AntContext] disconnect failed:', err);
      throw err;
    }
  }, [_activeManager]);

  const setTargetPower = useCallback(async (watts) => {
    try {
      await _activeManager().setTargetPower(watts);
    } catch (err) {
      console.error('[AntContext] setTargetPower failed:', err);
      throw err;
    }
  }, [_activeManager]);

  const setResistance = useCallback(async (percent) => {
    try {
      await _activeManager().setResistance(percent);
    } catch (err) {
      console.error('[AntContext] setResistance failed:', err);
      throw err;
    }
  }, [_activeManager]);

  const setGrade = useCallback(async (gradePercent) => {
    try {
      await _activeManager().setGrade(gradePercent);
    } catch (err) {
      console.error('[AntContext] setGrade failed:', err);
      throw err;
    }
  }, [_activeManager]);

  const startHrmScan = useCallback(async () => {
    try {
      await _activeManager().startHrmScan?.();
      // Belt-and-suspenders: sync state directly from the manager after scan
      // in case the hrm_discovered event didn't reach the handler
      const found = _activeManager().getDiscoveredHrmDevices?.() || [];
      if (found.length > 0) {
        setDiscoveredHrmDevices(found);
      }
    } catch (err) {
      console.error('[AntContext] startHrmScan failed:', err);
    }
  }, [_activeManager]);

  const connectHrm = useCallback(async (deviceId) => {
    try {
      await _activeManager().connectHrm?.(deviceId);
      // Sync state directly as fallback
      const hrmDeviceId = _activeManager().connectedHrmDeviceId;
      if (hrmDeviceId) {
        setConnectedHrmDevice({ deviceId: hrmDeviceId });
      }
    } catch (err) {
      console.error('[AntContext] connectHrm failed:', err);
    }
  }, [_activeManager]);

  const disconnectHrm = useCallback(async () => {
    try {
      await _activeManager().disconnectHrm?.();
    } catch (err) {
      console.error('[AntContext] disconnectHrm failed:', err);
    }
  }, [_activeManager]);

  const value = {
    // State
    workoutActive,
    setWorkoutActive,
    status,
    isScanning,
    discoveredDevices,
    connectedDevice,
    telemetry,
    connectionType,
    discoveredHrmDevices,
    connectedHrmDevice,

    // Actions
    setConnectionType,
    initialize,
    startScan,
    stopScan,
    connect,
    disconnect,
    setTargetPower,
    setResistance,
    setGrade,
    startHrmScan,
    connectHrm,
    disconnectHrm,
  };

  return <AntContext.Provider value={value}>{children}</AntContext.Provider>;
}

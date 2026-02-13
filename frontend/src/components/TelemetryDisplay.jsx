import React from 'react';
import { useAnt } from '../contexts/AntContext';

export default function TelemetryDisplay() {
  const { telemetry, connectedDevice } = useAnt();

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="telemetry-section">
      <div className="telemetry-grid">
        <div className="telemetry-card">
          <div className="telemetry-label">Power</div>
          <div className="telemetry-value">{Math.round(telemetry.power)}</div>
          <div className="telemetry-unit">watts</div>
        </div>
        <div className="telemetry-card">
          <div className="telemetry-label">Cadence</div>
          <div className="telemetry-value">{Math.round(telemetry.cadence)}</div>
          <div className="telemetry-unit">rpm</div>
        </div>
        <div className="telemetry-card">
          <div className="telemetry-label">Speed</div>
          <div className="telemetry-value">{telemetry.speed.toFixed(1)}</div>
          <div className="telemetry-unit">km/h</div>
        </div>
        <div className="telemetry-card">
          <div className="telemetry-label">Heart Rate</div>
          <div className="telemetry-value">{Math.round(telemetry.heartRate)}</div>
          <div className="telemetry-unit">bpm</div>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-item">
          <span className="stat-label">Distance:</span>
          <span className="stat-value">{Math.round(telemetry.distance)} m</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Time:</span>
          <span className="stat-value">{formatTime(telemetry.elapsedTime)}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Device:</span>
          <span className="stat-value">
            {connectedDevice ? connectedDevice.name || `Device ${connectedDevice.deviceId}` : '-'}
          </span>
        </div>
      </div>
    </div>
  );
}

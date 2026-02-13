import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';
import DeviceModal from '../components/DeviceModal';
import { useAnt } from '../contexts/AntContext';
import '../styles/freeride.css';

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export default function FreeRidePage() {
  const navigate = useNavigate();
  const { telemetry } = useAnt();
  const [isDeviceModalOpen, setIsDeviceModalOpen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [calories, setCalories] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryStats, setSummaryStats] = useState(null);

  const timerRef = useRef(null);
  const telemetryRef = useRef(telemetry);
  const pausedRef = useRef(false);
  const rideRef = useRef({
    startTime: Date.now(),
    pausedTime: 0,
    pauseStart: null,
    totalPower: 0,
    powerReadings: 0,
    maxPower: 0,
    totalCadence: 0,
    cadenceReadings: 0
  });

  useEffect(() => {
    document.body.classList.add('freeride-page');
    return () => {
      document.body.classList.remove('freeride-page');
    };
  }, []);

  useEffect(() => {
    telemetryRef.current = telemetry;
  }, [telemetry]);

  useEffect(() => {
    pausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    rideRef.current.startTime = Date.now();
    timerRef.current = setInterval(() => {
      if (pausedRef.current) return;

      const now = Date.now();
      const elapsed = Math.floor((now - rideRef.current.startTime - rideRef.current.pausedTime) / 1000);
      setElapsedSeconds(elapsed);

      const currentTelemetry = telemetryRef.current;
      if (currentTelemetry.power > 0) {
        rideRef.current.totalPower += currentTelemetry.power;
        rideRef.current.powerReadings += 1;
        rideRef.current.maxPower = Math.max(rideRef.current.maxPower, currentTelemetry.power);
      }

      if (currentTelemetry.cadence > 0) {
        rideRef.current.totalCadence += currentTelemetry.cadence;
        rideRef.current.cadenceReadings += 1;
      }

      const avgPower = rideRef.current.powerReadings > 0
        ? rideRef.current.totalPower / rideRef.current.powerReadings
        : 0;
      const totalKJ = (avgPower * elapsed) / 1000;
      setCalories(Math.round(totalKJ / 4.184));
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const togglePause = () => {
    if (isPaused) {
      rideRef.current.pausedTime += Date.now() - rideRef.current.pauseStart;
      rideRef.current.pauseStart = null;
      setIsPaused(false);
    } else {
      rideRef.current.pauseStart = Date.now();
      setIsPaused(true);
    }
  };

  const endRide = () => {
    if (!window.confirm('Are you sure you want to end your ride?')) return;

    if (timerRef.current) clearInterval(timerRef.current);
    const duration = elapsedSeconds;
    const avgPower = rideRef.current.powerReadings > 0
      ? Math.round(rideRef.current.totalPower / rideRef.current.powerReadings)
      : 0;
    const avgCadence = rideRef.current.cadenceReadings > 0
      ? Math.round(rideRef.current.totalCadence / rideRef.current.cadenceReadings)
      : 0;
    const totalKJ = (avgPower * duration) / 1000;
    const summaryCalories = Math.round(totalKJ / 4.184);

    setSummaryStats({
      duration,
      distance: telemetry.distance || 0,
      avgPower,
      maxPower: Math.round(rideRef.current.maxPower),
      avgCadence,
      calories: summaryCalories
    });
    setShowSummary(true);
  };

  return (
    <div>
      <TopBar
        variant="activity"
        title="Free Ride"
        backLabel="Exit"
        onDeviceScanClick={() => setIsDeviceModalOpen(true)}
      />

      <main className="freeride-main">
        <div className="time-display">
          <div className="time-value">{formatTime(elapsedSeconds)}</div>
          <div className="time-label">Elapsed Time</div>
        </div>

        <div className="freeride-metrics">
          <div className="metric-card power primary">
            <div className="metric-label">POWER</div>
            <div className="metric-value">
              <span>{Math.round(telemetry.power)}</span>
              <span className="metric-unit">W</span>
            </div>
          </div>

          <div className="metric-card cadence">
            <div className="metric-label">CADENCE</div>
            <div className="metric-value">
              <span>{Math.round(telemetry.cadence)}</span>
              <span className="metric-unit">rpm</span>
            </div>
          </div>

          <div className="metric-card speed">
            <div className="metric-label">SPEED</div>
            <div className="metric-value">
              <span>{telemetry.speed.toFixed(1)}</span>
              <span className="metric-unit">km/h</span>
            </div>
          </div>

          <div className="metric-card heart-rate">
            <div className="metric-label">HEART RATE</div>
            <div className="metric-value">
              <span>{telemetry.heartRate || '--'}</span>
              <span className="metric-unit">bpm</span>
            </div>
          </div>

          <div className="metric-card distance">
            <div className="metric-label">DISTANCE</div>
            <div className="metric-value">
              <span>{(telemetry.distance / 1000).toFixed(2)}</span>
              <span className="metric-unit">km</span>
            </div>
          </div>

          <div className="metric-card calories">
            <div className="metric-label">CALORIES</div>
            <div className="metric-value">
              <span>{calories}</span>
              <span className="metric-unit">kcal</span>
            </div>
          </div>
        </div>

        <div className="freeride-controls">
          <button className="control-btn secondary" onClick={togglePause}>
            {isPaused ? (
              <>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5,3 19,12 5,21"/>
                </svg>
                Resume
              </>
            ) : (
              <>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16"/>
                  <rect x="14" y="4" width="4" height="16"/>
                </svg>
                Pause
              </>
            )}
          </button>

          <button className="control-btn danger" onClick={endRide}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12"/>
            </svg>
            End Ride
          </button>
        </div>
      </main>

      {showSummary && summaryStats && (
        <div className="summary-overlay">
          <div className="summary-content">
            <div className="summary-icon">✓</div>
            <div className="summary-title">Ride Complete</div>

            <div className="summary-stats">
              <div className="summary-stat">
                <div className="summary-stat-value">{formatTime(summaryStats.duration)}</div>
                <div className="summary-stat-label">Duration</div>
              </div>
              <div className="summary-stat">
                <div className="summary-stat-value">
                  {summaryStats.distance.toFixed(1)}
                  <span className="stat-unit">km</span>
                </div>
                <div className="summary-stat-label">Distance</div>
              </div>
              <div className="summary-stat">
                <div className="summary-stat-value">
                  {summaryStats.avgPower}
                  <span className="stat-unit">W</span>
                </div>
                <div className="summary-stat-label">Avg Power</div>
              </div>
              <div className="summary-stat">
                <div className="summary-stat-value">
                  {summaryStats.maxPower}
                  <span className="stat-unit">W</span>
                </div>
                <div className="summary-stat-label">Max Power</div>
              </div>
              <div className="summary-stat">
                <div className="summary-stat-value">
                  {summaryStats.avgCadence}
                  <span className="stat-unit">rpm</span>
                </div>
                <div className="summary-stat-label">Avg Cadence</div>
              </div>
              <div className="summary-stat">
                <div className="summary-stat-value">
                  {summaryStats.calories}
                  <span className="stat-unit">kcal</span>
                </div>
                <div className="summary-stat-label">Calories</div>
              </div>
            </div>

            <div className="summary-actions">
              <button className="summary-btn primary" onClick={() => navigate('/')}>Done</button>
            </div>
          </div>
        </div>
      )}

      <DeviceModal isOpen={isDeviceModalOpen} onClose={() => setIsDeviceModalOpen(false)} />
    </div>
  );
}

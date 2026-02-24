import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet';
import { useAnt } from '../contexts/AntContext';
import TopBar from '../components/TopBar';
import DeviceModal from '../components/DeviceModal';
import '../styles/route.css';

// ── GPX helpers ───────────────────────────────────────────────────────────────

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseGPX(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  // getElementsByTagName is namespace-agnostic, unlike querySelectorAll,
  // so it works with GPX files that declare xmlns="http://www.topografix.com/GPX/1/1"
  const parseErr = doc.getElementsByTagName('parsererror')[0];
  if (parseErr) throw new Error('Invalid XML in GPX file');

  const trkpts = doc.getElementsByTagName('trkpt');
  if (trkpts.length === 0) throw new Error('No track points found in GPX file');

  const points = [];
  let totalDistance = 0;
  let prevLat = null;
  let prevLon = null;

  Array.from(trkpts).forEach(pt => {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lon = parseFloat(pt.getAttribute('lon'));
    const eleEl = pt.getElementsByTagName('ele')[0];
    const ele = eleEl ? parseFloat(eleEl.textContent) : 0;

    if (prevLat !== null) {
      totalDistance += haversineDistance(prevLat, prevLon, lat, lon);
    }
    points.push({ lat, lng: lon, ele, distanceFromStart: totalDistance });
    prevLat = lat;
    prevLon = lon;
  });

  return points;
}

// Map grade (%) to resistance (0–100%)
function gradeToResistance(grade) {
  // Flat road (0%) → 40% resistance
  // +12% climb → ~100%, -8% descent → ~0%
  return Math.max(0, Math.min(100, 40 + grade * 5));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MapBoundsFitter({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(points.map(p => [p.lat, p.lng]), { padding: [24, 24] });
    }
  }, [points, map]);
  return null;
}

function ElevationCanvas({ routePoints, routeStats, currentIndex, isRiding }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || routePoints.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth * dpr;
    const h = canvas.offsetHeight * dpr;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const cw = canvas.offsetWidth;
    const ch = canvas.offsetHeight;
    const pad = { top: 10, right: 10, bottom: 26, left: 46 };
    const innerW = cw - pad.left - pad.right;
    const innerH = ch - pad.top - pad.bottom;

    const { minEle, maxEle, totalDistance } = routeStats;
    const eleRange = maxEle - minEle || 1;

    const xOf = i => pad.left + (routePoints[i].distanceFromStart / totalDistance) * innerW;
    const yOf = ele => pad.top + innerH - ((ele - minEle) / eleRange) * innerH;

    ctx.clearRect(0, 0, cw, ch);

    // Filled area
    ctx.beginPath();
    ctx.moveTo(xOf(0), ch - pad.bottom);
    routePoints.forEach((p, i) => ctx.lineTo(xOf(i), yOf(p.ele)));
    ctx.lineTo(xOf(routePoints.length - 1), ch - pad.bottom);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, ch - pad.bottom);
    grad.addColorStop(0, 'rgba(0,212,255,0.55)');
    grad.addColorStop(1, 'rgba(0,212,255,0.04)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    routePoints.forEach((p, i) => {
      if (i === 0) ctx.moveTo(xOf(i), yOf(p.ele));
      else ctx.lineTo(xOf(i), yOf(p.ele));
    });
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Current position indicator
    if (isRiding && currentIndex > 0 && currentIndex < routePoints.length) {
      const x = xOf(currentIndex);
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, ch - pad.bottom);
      ctx.strokeStyle = '#ff6b35';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Y-axis labels
    ctx.fillStyle = '#888';
    ctx.font = `${11}px sans-serif`;
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const ele = minEle + (eleRange * i) / 4;
      ctx.fillText(`${Math.round(ele)}m`, pad.left - 5, yOf(ele) + 4);
    }

    // X-axis labels
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const dist = (totalDistance * i) / 4;
      const x = pad.left + (dist / totalDistance) * innerW;
      ctx.fillText(`${dist.toFixed(1)}km`, x, ch - 6);
    }
  }, [routePoints, routeStats, currentIndex, isRiding]);

  return <canvas ref={canvasRef} className="elevation-canvas" />;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RoutePage() {
  const { telemetry, setResistance, status } = useAnt();

  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [routePoints, setRoutePoints] = useState([]);
  const [routeName, setRouteName] = useState('');
  const [parseError, setParseError] = useState(null);
  const [isRiding, setIsRiding] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [liveStats, setLiveStats] = useState({ distanceRidden: 0, ele: 0, grade: 0 });

  const startDistanceRef = useRef(0);
  const lastResistanceRef = useRef(-1);

  const routeStats = useMemo(() => {
    if (routePoints.length === 0) return null;
    const totalDistance = routePoints[routePoints.length - 1].distanceFromStart;
    let elevationGain = 0;
    let elevationLoss = 0;
    for (let i = 1; i < routePoints.length; i++) {
      const diff = routePoints[i].ele - routePoints[i - 1].ele;
      if (diff > 0) elevationGain += diff;
      else elevationLoss += Math.abs(diff);
    }
    const eles = routePoints.map(p => p.ele);
    return {
      totalDistance,
      elevationGain,
      elevationLoss,
      minEle: Math.min(...eles),
      maxEle: Math.max(...eles),
    };
  }, [routePoints]);

  const positions = useMemo(() => routePoints.map(p => [p.lat, p.lng]), [routePoints]);

  const handleFileUpload = useCallback(e => {
    const file = e.target.files[0];
    if (!file) return;
    setParseError(null);
    setIsRiding(false);
    setCurrentIndex(0);
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const points = parseGPX(evt.target.result);
        setRoutePoints(points);
        setRouteName(file.name.replace(/\.gpx$/i, ''));
      } catch (err) {
        setParseError(err.message);
        setRoutePoints([]);
      }
    };
    reader.readAsText(file);
  }, []);

  // Track position along route based on trainer distance
  useEffect(() => {
    if (!isRiding || routePoints.length === 0 || !routeStats) return;

    const distanceRidden = Math.max(0, telemetry.distance - startDistanceRef.current);

    // Find current route index (linear scan; route points are ordered by distance)
    let idx = 0;
    for (let i = 0; i < routePoints.length - 1; i++) {
      if (routePoints[i + 1].distanceFromStart <= distanceRidden) {
        idx = i + 1;
      } else {
        break;
      }
    }
    idx = Math.min(idx, routePoints.length - 1);
    setCurrentIndex(idx);

    // Grade between current and next point
    let grade = 0;
    if (idx < routePoints.length - 1) {
      const curr = routePoints[idx];
      const next = routePoints[idx + 1];
      const segDist = (next.distanceFromStart - curr.distanceFromStart) * 1000; // m
      if (segDist > 0) {
        grade = ((next.ele - curr.ele) / segDist) * 100;
      }
    }

    const resistance = gradeToResistance(grade);
    // Only call setResistance when it changes by more than 1% to reduce chatter
    if (Math.abs(resistance - lastResistanceRef.current) >= 1) {
      lastResistanceRef.current = resistance;
      setResistance(resistance).catch(() => {});
    }

    setLiveStats({
      distanceRidden,
      ele: routePoints[idx].ele,
      grade: Math.round(grade * 10) / 10,
    });

    // Auto-stop at route end
    if (distanceRidden >= routeStats.totalDistance) {
      setIsRiding(false);
    }
  }, [telemetry.distance, isRiding, routePoints, routeStats, setResistance]);

  const handleStartRide = useCallback(() => {
    startDistanceRef.current = telemetry.distance;
    lastResistanceRef.current = -1;
    setCurrentIndex(0);
    setLiveStats({ distanceRidden: 0, ele: routePoints[0]?.ele ?? 0, grade: 0 });
    setIsRiding(true);
  }, [telemetry.distance, routePoints]);

  const handleStopRide = useCallback(() => {
    setIsRiding(false);
    setResistance(50).catch(() => {});
  }, [setResistance]);

  const currentPosition = useMemo(() => {
    if (!isRiding || routePoints.length === 0) return null;
    const p = routePoints[currentIndex];
    return [p.lat, p.lng];
  }, [isRiding, currentIndex, routePoints]);

  const gradeClass = useMemo(() => {
    if (liveStats.grade > 5) return 'grade-hard';
    if (liveStats.grade > 0) return 'grade-moderate';
    return 'grade-easy';
  }, [liveStats.grade]);

  return (
    <div className="route-page">
      <TopBar variant="main" onDeviceScanClick={() => setShowDeviceModal(true)} />

      <main id="main-content" className="route-main">
        <div className="route-layout">

          {/* Sidebar */}
          <aside className="route-sidebar">
            <h1 className="route-heading">Route Ride</h1>

            <div className="route-upload-section">
              <label className="gpx-upload-btn" htmlFor="gpx-file-input">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
                </svg>
                {routePoints.length > 0 ? 'Replace GPX file' : 'Upload GPX file'}
              </label>
              <input
                id="gpx-file-input"
                type="file"
                accept=".gpx"
                onChange={handleFileUpload}
                className="gpx-file-input"
              />
            </div>

            {parseError && (
              <p className="route-error" role="alert">{parseError}</p>
            )}

            {routePoints.length === 0 && !parseError && (
              <div className="route-empty-hint">
                <p>Upload a GPX file to display your route on the map. Trainer resistance will automatically adjust based on elevation changes.</p>
              </div>
            )}

            {routeStats && (
              <>
                <div className="route-name">{routeName}</div>

                <div className="route-stats-grid">
                  <div className="route-stat">
                    <span className="route-stat-label">Distance</span>
                    <span className="route-stat-value">{routeStats.totalDistance.toFixed(1)} km</span>
                  </div>
                  <div className="route-stat">
                    <span className="route-stat-label">Elevation gain</span>
                    <span className="route-stat-value">+{Math.round(routeStats.elevationGain)} m</span>
                  </div>
                  <div className="route-stat">
                    <span className="route-stat-label">Min elevation</span>
                    <span className="route-stat-value">{Math.round(routeStats.minEle)} m</span>
                  </div>
                  <div className="route-stat">
                    <span className="route-stat-label">Max elevation</span>
                    <span className="route-stat-value">{Math.round(routeStats.maxEle)} m</span>
                  </div>
                </div>

                {isRiding && (
                  <div className="ride-live-stats">
                    <div className="ride-live-stat">
                      <span className="ride-live-label">Ridden</span>
                      <span className="ride-live-value">{liveStats.distanceRidden.toFixed(2)} km</span>
                    </div>
                    <div className="ride-live-stat">
                      <span className="ride-live-label">Elevation</span>
                      <span className="ride-live-value">{Math.round(liveStats.ele)} m</span>
                    </div>
                    <div className="ride-live-stat">
                      <span className="ride-live-label">Grade</span>
                      <span className={`ride-live-value ${gradeClass}`}>
                        {liveStats.grade > 0 ? '+' : ''}{liveStats.grade}%
                      </span>
                    </div>
                    <div className="ride-live-stat">
                      <span className="ride-live-label">Power</span>
                      <span className="ride-live-value">{telemetry.power} W</span>
                    </div>
                    <div className="ride-live-stat">
                      <span className="ride-live-label">Cadence</span>
                      <span className="ride-live-value">{telemetry.cadence} rpm</span>
                    </div>
                    <div className="ride-live-stat">
                      <span className="ride-live-label">Speed</span>
                      <span className="ride-live-value">{telemetry.speed.toFixed(1)} km/h</span>
                    </div>
                  </div>
                )}

                <div className="route-controls">
                  {!isRiding ? (
                    <button
                      type="button"
                      className="btn-start-ride"
                      onClick={handleStartRide}
                      disabled={status !== 'connected'}
                      title={status !== 'connected' ? 'Connect a trainer first' : ''}
                    >
                      {status !== 'connected' ? 'Connect trainer to ride' : 'Start Ride'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-stop-ride"
                      onClick={handleStopRide}
                    >
                      Stop Ride
                    </button>
                  )}
                </div>
              </>
            )}
          </aside>

          {/* Map + elevation */}
          <section className="route-map-section" aria-label="Route map and elevation profile">
            <div className="map-wrapper">
              {routePoints.length > 0 ? (
                <MapContainer
                  center={[routePoints[0].lat, routePoints[0].lng]}
                  zoom={13}
                  className="leaflet-map"
                >
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  />
                  <MapBoundsFitter points={routePoints} />
                  <Polyline
                    positions={positions}
                    pathOptions={{ color: '#00d4ff', weight: 3, opacity: 0.85 }}
                  />
                  {currentPosition && (
                    <CircleMarker
                      center={currentPosition}
                      radius={9}
                      pathOptions={{ color: '#ff6b35', fillColor: '#ff6b35', fillOpacity: 1, weight: 2 }}
                    />
                  )}
                </MapContainer>
              ) : (
                <div className="map-placeholder">
                  <svg width="52" height="52" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/>
                  </svg>
                  <p>Upload a GPX file to see your route</p>
                </div>
              )}
            </div>

            {routeStats && (
              <div className="elevation-section">
                <div className="elevation-label">Elevation profile</div>
                <ElevationCanvas
                  routePoints={routePoints}
                  routeStats={routeStats}
                  currentIndex={currentIndex}
                  isRiding={isRiding}
                />
              </div>
            )}
          </section>

        </div>
      </main>

      {showDeviceModal && (
        <DeviceModal onClose={() => setShowDeviceModal(false)} />
      )}
    </div>
  );
}

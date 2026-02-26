import React, { Component, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import L from 'leaflet';
import { useAnt } from '../contexts/AntContext';
import TopBar from '../components/TopBar';
import DeviceModal from '../components/DeviceModal';
import {
  saveRoute,
  loadAllRoutes,
  deleteRoute,
  renameRoute,
} from '../services/routeLibrary';
import { saveRouteRide } from '../services/dataManager';
import '../styles/route.css';

// ── Error Boundary ─────────────────────────────────────────────────────────────

class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="route-crash">
          <strong>Something went wrong rendering the map:</strong>
          <pre>{this.state.error.message}</pre>
          <button type="button" onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Invalid XML in GPX file');
  }

  const trkpts = doc.getElementsByTagName('trkpt');
  if (trkpts.length === 0) throw new Error('No track points found in GPX file');

  const points = [];
  let totalDistance = 0;
  let prevLat = null;
  let prevLon = null;

  for (let i = 0; i < trkpts.length; i++) {
    const pt = trkpts[i];
    const lat = parseFloat(pt.getAttribute('lat'));
    const lon = parseFloat(pt.getAttribute('lon'));
    if (isNaN(lat) || isNaN(lon)) continue;

    const eleEl = pt.getElementsByTagName('ele')[0];
    const ele = eleEl ? parseFloat(eleEl.textContent) || 0 : 0;

    if (prevLat !== null) {
      totalDistance += haversineDistance(prevLat, prevLon, lat, lon);
    }
    points.push({ lat, lng: lon, ele, distanceFromStart: totalDistance });
    prevLat = lat;
    prevLon = lon;
  }

  if (points.length === 0) throw new Error('No valid coordinates in GPX file');
  return points;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Elevation canvas ──────────────────────────────────────────────────────────

function ElevationCanvas({ routePoints, routeStats, currentIndex, isRiding }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || routePoints.length === 0 || canvas.offsetWidth === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
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

    ctx.beginPath();
    ctx.moveTo(xOf(0), ch - pad.bottom);
    for (let i = 0; i < routePoints.length; i++) {
      ctx.lineTo(xOf(i), yOf(routePoints[i].ele));
    }
    ctx.lineTo(xOf(routePoints.length - 1), ch - pad.bottom);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, ch - pad.bottom);
    grad.addColorStop(0, 'rgba(0,212,255,0.55)');
    grad.addColorStop(1, 'rgba(0,212,255,0.04)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < routePoints.length; i++) {
      if (i === 0) ctx.moveTo(xOf(i), yOf(routePoints[i].ele));
      else ctx.lineTo(xOf(i), yOf(routePoints[i].ele));
    }
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (isRiding && currentIndex >= 0 && currentIndex < routePoints.length) {
      const x = xOf(currentIndex);
      const y = yOf(routePoints[currentIndex].ele);

      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, ch - pad.bottom);
      ctx.strokeStyle = 'rgba(255,107,53,0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff6b35';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.fillStyle = '#888';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const ele = minEle + (eleRange * i) / 4;
      ctx.fillText(`${Math.round(ele)}m`, pad.left - 5, yOf(ele) + 4);
    }

    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const dist = (totalDistance * i) / 4;
      const x = pad.left + (dist / totalDistance) * innerW;
      ctx.fillText(`${dist.toFixed(1)}km`, x, ch - 6);
    }
  }, [routePoints, routeStats, currentIndex, isRiding]);

  return <canvas ref={canvasRef} className="elevation-canvas" />;
}

// ── Leaflet map ───────────────────────────────────────────────────────────────

function RouteMap({ routePoints, currentIndex, isRiding }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const polylineRef  = useRef(null);
  const markerRef    = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    map.setView([0, 0], 2);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current    = null;
      polylineRef.current = null;
      markerRef.current   = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (polylineRef.current) { polylineRef.current.remove(); polylineRef.current = null; }
    if (markerRef.current)   { markerRef.current.remove();   markerRef.current   = null; }

    if (routePoints.length === 0) return;

    const latlngs = routePoints.map(p => [p.lat, p.lng]);
    polylineRef.current = L.polyline(latlngs, {
      color: '#00d4ff', weight: 3, opacity: 0.85,
    }).addTo(map);
    map.fitBounds(polylineRef.current.getBounds(), { padding: [24, 24] });
  }, [routePoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!isRiding || routePoints.length === 0) {
      if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
      return;
    }

    const p = routePoints[currentIndex];
    if (!p) return;
    const latlng = [p.lat, p.lng];

    if (markerRef.current) {
      markerRef.current.setLatLng(latlng);
    } else {
      markerRef.current = L.circleMarker(latlng, {
        radius: 9, color: '#ff6b35', fillColor: '#ff6b35', fillOpacity: 1, weight: 2,
      }).addTo(map);
    }
  }, [isRiding, currentIndex, routePoints]);

  return (
    <div ref={containerRef} className="leaflet-map" style={{ width: '100%', height: '100%' }} />
  );
}

// ── localStorage key for active route ─────────────────────────────────────────
const STORAGE_KEY = 'openride_current_route';

function loadSavedRoute() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RoutePage() {
  const { telemetry, setGrade, status } = useAnt();

  const [showDeviceModal, setShowDeviceModal] = useState(false);

  // Active route (loaded from file or library)
  const [routePoints, setRoutePoints] = useState(() => loadSavedRoute()?.points ?? []);
  const [routeName,   setRouteName]   = useState(() => loadSavedRoute()?.name   ?? '');
  const [routeId,     setRouteId]     = useState(() => loadSavedRoute()?.id     ?? null);

  // Route library
  const [library,       setLibrary]       = useState([]);
  const [showLibrary,   setShowLibrary]   = useState(false);
  const [renamingId,    setRenamingId]    = useState(null);
  const [renameValue,   setRenameValue]   = useState('');
  const [savedToLib,    setSavedToLib]    = useState(false);

  // Parse error
  const [parseError, setParseError] = useState(null);

  // Ride state
  const [isRiding,      setIsRiding]      = useState(false);
  const [isPaused,      setIsPaused]      = useState(false);
  const [currentIndex,  setCurrentIndex]  = useState(0);
  const [liveStats,     setLiveStats]     = useState({ distanceRidden: 0, ele: 0, grade: 0, duration: 0 });

  // Refs for interval
  const speedRef           = useRef(0);
  const powerRef           = useRef(0);
  const cadenceRef         = useRef(0);
  const distanceRiddenRef  = useRef(0);
  const durationRef        = useRef(0);
  const lastGradeRef       = useRef(-999);
  const ridePowerAccRef    = useRef({ total: 0, count: 0 });
  const rideCadenceAccRef  = useRef({ total: 0, count: 0 });

  const fileInputRef = useRef(null);

  // Keep telemetry refs current for interval
  useEffect(() => { speedRef.current   = telemetry.speed;   }, [telemetry.speed]);
  useEffect(() => { powerRef.current   = telemetry.power;   }, [telemetry.power]);
  useEffect(() => { cadenceRef.current = telemetry.cadence; }, [telemetry.cadence]);

  // Load library on mount
  useEffect(() => {
    loadAllRoutes().then(setLibrary).catch(() => {});
  }, []);

  // Persist active route to localStorage
  useEffect(() => {
    if (routePoints.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: routeId, name: routeName, points: routePoints }));
    } catch (_) {}
  }, [routePoints, routeName, routeId]);

  const routeStats = useMemo(() => {
    if (routePoints.length === 0) return null;
    const totalDistance = routePoints[routePoints.length - 1].distanceFromStart;
    let elevationGain = 0;
    let minEle = routePoints[0].ele;
    let maxEle = routePoints[0].ele;
    for (let i = 1; i < routePoints.length; i++) {
      const diff = routePoints[i].ele - routePoints[i - 1].ele;
      if (diff > 0) elevationGain += diff;
      if (routePoints[i].ele < minEle) minEle = routePoints[i].ele;
      if (routePoints[i].ele > maxEle) maxEle = routePoints[i].ele;
    }
    return { totalDistance, elevationGain, minEle, maxEle };
  }, [routePoints]);

  // ── File upload ──────────────────────────────────────────────────────────────

  const handleFileUpload = useCallback(e => {
    const file = e.target.files[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    setParseError(null);
    setIsRiding(false);
    setCurrentIndex(0);
    setLiveStats({ distanceRidden: 0, ele: 0, grade: 0, duration: 0 });
    setSavedToLib(false);

    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const points = parseGPX(evt.target.result);
        setRoutePoints(points);
        setRouteName(file.name.replace(/\.gpx$/i, ''));
        setRouteId(null); // not yet saved to library
      } catch (err) {
        setParseError(err.message);
        setRoutePoints([]);
      }
    };
    reader.onerror = () => setParseError('Could not read file');
    reader.readAsText(file);
  }, []);

  // ── Library actions ──────────────────────────────────────────────────────────

  const handleSaveToLibrary = useCallback(async () => {
    if (routePoints.length === 0 || !routeStats) return;
    try {
      const entry = await saveRoute({
        id:            routeId || undefined,
        name:          routeName,
        points:        routePoints,
        totalDistance: routeStats.totalDistance,
        elevationGain: routeStats.elevationGain,
        minEle:        routeStats.minEle,
        maxEle:        routeStats.maxEle,
      });
      setRouteId(entry.id);
      setSavedToLib(true);
      const updated = await loadAllRoutes();
      setLibrary(updated);
    } catch (_) {}
  }, [routePoints, routeStats, routeName, routeId]);

  const handleLoadFromLibrary = useCallback((entry) => {
    setRoutePoints(entry.points);
    setRouteName(entry.name);
    setRouteId(entry.id);
    setSavedToLib(true);
    setIsRiding(false);
    setCurrentIndex(0);
    setLiveStats({ distanceRidden: 0, ele: 0, grade: 0, duration: 0 });
    setParseError(null);
    setShowLibrary(false);
  }, []);

  const handleDeleteFromLibrary = useCallback(async (id, e) => {
    e.stopPropagation();
    try {
      await deleteRoute(id);
      const updated = await loadAllRoutes();
      setLibrary(updated);
      if (routeId === id) {
        setRouteId(null);
        setSavedToLib(false);
      }
    } catch (_) {}
  }, [routeId]);

  const handleStartRename = useCallback((entry, e) => {
    e.stopPropagation();
    setRenamingId(entry.id);
    setRenameValue(entry.name);
  }, []);

  const handleConfirmRename = useCallback(async (id) => {
    if (!renameValue.trim()) { setRenamingId(null); return; }
    try {
      await renameRoute(id, renameValue.trim());
      const updated = await loadAllRoutes();
      setLibrary(updated);
      if (routeId === id) setRouteName(renameValue.trim());
    } catch (_) {}
    setRenamingId(null);
  }, [renameValue, routeId]);

  // ── Ride tracking ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isRiding || isPaused || routePoints.length === 0 || !routeStats) return;

    const interval = setInterval(() => {
      distanceRiddenRef.current += speedRef.current / 3600;
      durationRef.current       += 1;

      if (powerRef.current > 0) {
        ridePowerAccRef.current.total += powerRef.current;
        ridePowerAccRef.current.count += 1;
      }
      if (cadenceRef.current > 0) {
        rideCadenceAccRef.current.total += cadenceRef.current;
        rideCadenceAccRef.current.count += 1;
      }

      const distanceRidden = distanceRiddenRef.current;

      let idx = 0;
      for (let i = 0; i < routePoints.length - 1; i++) {
        if (routePoints[i + 1].distanceFromStart <= distanceRidden) idx = i + 1;
        else break;
      }
      idx = Math.min(idx, routePoints.length - 1);
      setCurrentIndex(idx);

      let grade = 0;
      if (idx < routePoints.length - 1) {
        const curr = routePoints[idx];
        const next = routePoints[idx + 1];
        const segDist = (next.distanceFromStart - curr.distanceFromStart) * 1000;
        if (segDist > 0) grade = ((next.ele - curr.ele) / segDist) * 100;
      }

      const gradeRounded = Math.round(grade * 10) / 10;
      if (Math.abs(gradeRounded - lastGradeRef.current) >= 0.2) {
        lastGradeRef.current = gradeRounded;
        setGrade(gradeRounded).catch(() => {});
      }

      setLiveStats({
        distanceRidden,
        ele:      routePoints[idx].ele,
        grade:    gradeRounded,
        duration: durationRef.current,
      });

      if (distanceRidden >= routeStats.totalDistance) setIsRiding(false);
    }, 1000);

    return () => clearInterval(interval);
  }, [isRiding, isPaused, routePoints, routeStats, setGrade]);

  const handleStartRide = useCallback(() => {
    distanceRiddenRef.current       = 0;
    durationRef.current             = 0;
    lastGradeRef.current            = -999;
    ridePowerAccRef.current         = { total: 0, count: 0 };
    rideCadenceAccRef.current       = { total: 0, count: 0 };
    setCurrentIndex(0);
    setIsPaused(false);
    setLiveStats({ distanceRidden: 0, ele: routePoints[0]?.ele ?? 0, grade: 0, duration: 0 });
    setIsRiding(true);
  }, [routePoints]);

  const handlePauseRide = useCallback(() => {
    setIsPaused(true);
    setGrade(0).catch(() => {});
  }, [setGrade]);

  const handleResumeRide = useCallback(() => {
    lastGradeRef.current = -999;
    setIsPaused(false);
  }, []);

  const handleStopRide = useCallback(() => {
    setIsRiding(false);
    setIsPaused(false);
    setGrade(0).catch(() => {});

    // Log to history if at least 100m was ridden
    if (distanceRiddenRef.current >= 0.1 && routeStats) {
      const p = ridePowerAccRef.current;
      const c = rideCadenceAccRef.current;

      // Elevation gain for the portion actually ridden
      let gainRidden = 0;
      for (let i = 1; i <= Math.min(currentIndexRef.current, routePoints.length - 1); i++) {
        const diff = routePoints[i].ele - routePoints[i - 1].ele;
        if (diff > 0) gainRidden += diff;
      }

      saveRouteRide({
        routeId:       routeId,
        routeName:     routeName,
        date:          new Date().toISOString(),
        distance:      distanceRiddenRef.current,
        duration:      durationRef.current,
        elevationGain: Math.round(gainRidden),
        avgPower:      p.count > 0 ? Math.round(p.total / p.count) : 0,
        avgCadence:    c.count > 0 ? Math.round(c.total / c.count) : 0,
      });
    }
  }, [setGrade, routeStats, routeName, routeId, routePoints]);

  // Keep a ref to currentIndex so handleStopRide can read it without being a dep
  const currentIndexRef = useRef(0);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);

  const gradeClass = useMemo(() => {
    if (liveStats.grade > 5) return 'grade-hard';
    if (liveStats.grade > 0) return 'grade-moderate';
    return 'grade-easy';
  }, [liveStats.grade]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="route-page">
      <TopBar variant="main" onDeviceScanClick={() => setShowDeviceModal(true)} />

      <main id="main-content" className="route-main">
        <div className="route-layout">

          {/* Sidebar */}
          <aside className="route-sidebar">
            <h1 className="route-heading">Route Ride</h1>

            {/* Upload + library toggle */}
            <div className="route-upload-section">
              <label className="gpx-upload-btn" htmlFor="gpx-file-input">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
                </svg>
                {routePoints.length > 0 ? 'Replace GPX' : 'Upload GPX'}
              </label>
              <input
                ref={fileInputRef}
                id="gpx-file-input"
                type="file"
                accept=".gpx"
                onChange={handleFileUpload}
                className="gpx-file-input"
              />
              <button
                type="button"
                className={`btn-library-toggle ${showLibrary ? 'active' : ''}`}
                onClick={() => setShowLibrary(v => !v)}
                title="Saved routes"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V6h5.17l2 2H20v10z"/>
                </svg>
                {library.length > 0 && <span className="library-count">{library.length}</span>}
              </button>
            </div>

            {/* Route library panel */}
            {showLibrary && (
              <div className="route-library">
                <div className="route-library-header">Saved Routes</div>
                {library.length === 0 ? (
                  <p className="route-library-empty">No saved routes yet. Upload a GPX and save it to the library.</p>
                ) : (
                  <ul className="route-library-list">
                    {library.map(entry => (
                      <li
                        key={entry.id}
                        className={`route-library-item ${routeId === entry.id ? 'active' : ''}`}
                        onClick={() => handleLoadFromLibrary(entry)}
                      >
                        {renamingId === entry.id ? (
                          <input
                            className="route-library-rename-input"
                            value={renameValue}
                            autoFocus
                            onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter')  handleConfirmRename(entry.id);
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            onBlur={() => handleConfirmRename(entry.id)}
                            onClick={e => e.stopPropagation()}
                          />
                        ) : (
                          <>
                            <span className="route-library-name">{entry.name}</span>
                            <span className="route-library-meta">
                              {entry.totalDistance?.toFixed(1)} km · +{Math.round(entry.elevationGain ?? 0)} m
                            </span>
                          </>
                        )}
                        <div className="route-library-actions">
                          <button
                            type="button"
                            title="Rename"
                            onClick={e => handleStartRename(entry, e)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                            </svg>
                          </button>
                          <button
                            type="button"
                            title="Delete"
                            className="btn-delete-route"
                            onClick={e => handleDeleteFromLibrary(entry.id, e)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                            </svg>
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

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
                <div className="route-name-row">
                  <span className="route-name">{routeName}</span>
                  {!savedToLib ? (
                    <button
                      type="button"
                      className="btn-save-to-lib"
                      onClick={handleSaveToLibrary}
                      title="Save to library"
                    >
                      Save
                    </button>
                  ) : (
                    <span className="route-saved-badge">✓ Saved</span>
                  )}
                </div>

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
                      <span className="ride-live-label">Time</span>
                      <span className="ride-live-value">{formatDuration(liveStats.duration)}</span>
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
                    <div className="ride-active-controls">
                      {isPaused ? (
                        <button type="button" className="btn-resume-ride" onClick={handleResumeRide}>
                          Resume
                        </button>
                      ) : (
                        <button type="button" className="btn-pause-ride" onClick={handlePauseRide}>
                          Pause
                        </button>
                      )}
                      <button type="button" className="btn-stop-ride" onClick={handleStopRide}>
                        Stop
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </aside>

          {/* Map + elevation */}
          <section className="route-map-section" aria-label="Route map and elevation profile">
            <div className="map-wrapper">
              {routePoints.length === 0 ? (
                <div className="map-placeholder">
                  <svg width="52" height="52" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/>
                  </svg>
                  <p>Upload a GPX file to see your route</p>
                </div>
              ) : (
                <RouteErrorBoundary>
                  <RouteMap routePoints={routePoints} currentIndex={currentIndex} isRiding={isRiding} />
                </RouteErrorBoundary>
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

      <DeviceModal isOpen={showDeviceModal} onClose={() => setShowDeviceModal(false)} />
    </div>
  );
}

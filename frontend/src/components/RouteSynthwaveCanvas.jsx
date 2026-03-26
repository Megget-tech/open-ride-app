import React, { useRef, useEffect, useCallback } from 'react';

// Color based on grade (%) — the terrain tints the whole environment.
// Downhill = cool cyan/teal, flat = green, moderate climb = yellow,
// steep = orange, very steep = red.
function gradeRGB(grade) {
  if (grade <= -3) return [0,   200, 255];  // steep downhill: cyan
  if (grade <=  0) return [68,  204, 204];  // slight downhill: teal
  if (grade <=  2) return [68,  204, 136];  // flat: green
  if (grade <=  5) return [255, 204,   0];  // moderate: yellow
  if (grade <=  8) return [255, 136,   0];  // hard: orange
  return           [255,   60,  60];         // very steep: red
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}

function buildMountains(xMin, xMax, baseY, maxH, numPeaks, rng) {
  const valleys = Array.from({ length: numPeaks + 1 }, (_, i) => [
    xMin + (xMax - xMin) * i / numPeaks, baseY,
  ]);
  const peaks = Array.from({ length: numPeaks }, (_, i) => {
    const cx = (valleys[i][0] + valleys[i + 1][0]) / 2 + (rng() - 0.5) * (xMax - xMin) * 0.22;
    return [cx, baseY - (0.15 + rng() * 0.85) * maxH];
  });
  const tris = [];
  for (let i = 0; i < numPeaks; i++) {
    tris.push({ pts: [valleys[i], peaks[i], valleys[i + 1]], lit: 0.2 + rng() * 0.8 });
  }
  for (let i = 0; i < numPeaks - 1; i++) {
    tris.push({ pts: [peaks[i], valleys[i + 1], peaks[i + 1]], lit: 0.05 + rng() * 0.35 });
  }
  return tris;
}

export default function RouteSynthwaveCanvas({
  telemetry,
  grade,
  distanceRidden,
  totalDistance,
  elapsedTime,
  routeName,
  isPaused,
}) {
  const canvasRef    = useRef(null);
  const animRef      = useRef(null);
  const offsetRef    = useRef(0);
  const starsRef     = useRef(null);
  const mountainsRef = useRef(null);
  const liveRef      = useRef({ telemetry, grade, distanceRidden, totalDistance, isPaused });

  useEffect(() => {
    liveRef.current = { telemetry, grade, distanceRidden, totalDistance, isPaused };
  }, [telemetry, grade, distanceRidden, totalDistance, isPaused]);

  const draw = useCallback((timestamp) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx   = canvas.getContext('2d');
    const dpr   = window.devicePixelRatio || 1;
    const dispW = canvas.offsetWidth;
    const dispH = canvas.offsetHeight;

    if (canvas.width !== dispW * dpr || canvas.height !== dispH * dpr) {
      canvas.width  = dispW * dpr;
      canvas.height = dispH * dpr;
      starsRef.current    = null;
      mountainsRef.current = null;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = dispW;
    const h = dispH;
    if (w < 10 || h < 10) { animRef.current = requestAnimationFrame(draw); return; }

    const { telemetry: tel, grade: g, distanceRidden: dist, totalDistance: total, isPaused: paused } = liveRef.current;
    const speed = tel?.speed || 0;
    const [r, gc, b] = gradeRGB(g || 0);
    const horizonY = h * 0.42;
    const vx = w / 2;

    // Road geometry
    const rNarrow = w * 0.028;
    const rWide   = w * 0.30;
    const rLeft   = (y) => { const t = (y - horizonY) / (h - horizonY); return vx - (rNarrow + (rWide - rNarrow) * t); };
    const rRight  = (y) => { const t = (y - horizonY) / (h - horizonY); return vx + (rNarrow + (rWide - rNarrow) * t); };

    // Scroll
    if (!paused) offsetRef.current = (offsetRef.current + Math.max(speed, 4) / 900) % 1;

    // ── 1. Background ─────────────────────────────────────────────────────────
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0,   '#010108');
    bg.addColorStop(0.5, '#07071a');
    bg.addColorStop(1,   '#0d0617');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // ── 2. Stars ──────────────────────────────────────────────────────────────
    if (!starsRef.current) {
      starsRef.current = Array.from({ length: 90 }, () => ({
        x: Math.random() * w,
        y: Math.random() * horizonY * 0.88,
        r: 0.3 + Math.random() * 1.2,
        a: 0.4 + Math.random() * 0.55,
        tw: Math.random() * Math.PI * 2,
      }));
    }
    for (const s of starsRef.current) {
      const a = s.a * (0.7 + 0.3 * Math.sin(timestamp / 1600 + s.tw));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      ctx.fill();
    }

    // ── 3. Sky glow ───────────────────────────────────────────────────────────
    const skyGlow = ctx.createLinearGradient(0, horizonY - h * 0.30, 0, horizonY);
    skyGlow.addColorStop(0, `rgba(${r},${gc},${b},0)`);
    skyGlow.addColorStop(1, `rgba(${r},${gc},${b},0.30)`);
    ctx.fillStyle = skyGlow;
    ctx.fillRect(0, horizonY - h * 0.30, w, h * 0.30);

    // ── 4. Sun ────────────────────────────────────────────────────────────────
    const sunR = Math.max(8, w * 0.085 + Math.sin(timestamp / 900) * 2.5);
    for (const [mult, alpha] of [[4.5, 0.05], [2.8, 0.11], [1.7, 0.23]]) {
      const bloom = ctx.createRadialGradient(vx, horizonY, 0, vx, horizonY, sunR * mult);
      bloom.addColorStop(0, `rgba(${r},${gc},${b},${alpha})`);
      bloom.addColorStop(1, `rgba(${r},${gc},${b},0)`);
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(vx, horizonY, sunR * mult, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(vx, horizonY, sunR, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = `rgb(${r},${gc},${b})`;
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(vx, horizonY, sunR, Math.PI, 0);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = '#040411';
    ctx.lineWidth = 1.5;
    for (let i = 1; i <= 6; i++) {
      const sy = horizonY - (sunR * i) / 7;
      ctx.beginPath();
      ctx.moveTo(vx - sunR, sy);
      ctx.lineTo(vx + sunR, sy);
      ctx.stroke();
    }
    ctx.restore();

    // ── 5. Flat perspective grid ───────────────────────────────────────────────
    const vLineCount = 14;
    const hLineCount = 12;

    for (let i = 0; i <= vLineCount; i++) {
      const xBot = (w / vLineCount) * i;
      const dist2 = Math.abs(i / vLineCount - 0.5) * 2;
      ctx.beginPath();
      ctx.moveTo(xBot, h);
      ctx.lineTo(vx, horizonY);
      ctx.strokeStyle = `rgba(${r},${gc},${b},${0.05 + dist2 * 0.32})`;
      ctx.lineWidth = 0.5 + dist2 * 0.8;
      ctx.stroke();
    }
    for (let i = 0; i < hLineCount; i++) {
      const t     = ((i + offsetRef.current) % hLineCount) / hLineCount;
      const yLine = horizonY + (h - horizonY) * Math.pow(t, 1.6);
      const u     = (yLine - horizonY) / (h - horizonY);
      ctx.beginPath();
      ctx.moveTo(vx - vx * u, yLine);
      ctx.lineTo(vx + vx * u, yLine);
      ctx.strokeStyle = `rgba(${r},${gc},${b},${0.06 + t * 0.52})`;
      ctx.lineWidth = 0.3 + t * 1.8;
      ctx.stroke();
    }

    // ── 6. Mountains ──────────────────────────────────────────────────────────
    if (!mountainsRef.current) {
      const rng1 = makeRng(0xdeadbeef);
      const rng2 = makeRng(0xc0ffee42);
      const maxH = horizonY * 0.90;
      mountainsRef.current = {
        leftBack:   buildMountains(-w * 0.06, w * 0.46, horizonY + 6, maxH,        9, rng1),
        leftFront:  buildMountains(-w * 0.02, w * 0.38, horizonY + 6, maxH * 0.60, 7, rng1),
        rightBack:  buildMountains(w * 0.54, w * 1.06, horizonY + 6, maxH,        9, rng2),
        rightFront: buildMountains(w * 0.62, w * 1.02, horizonY + 6, maxH * 0.60, 7, rng2),
      };
    }
    const drawMtns = (tris, alphaScale) => {
      for (const { pts, lit } of tris) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        ctx.lineTo(pts[1][0], pts[1][1]);
        ctx.lineTo(pts[2][0], pts[2][1]);
        ctx.closePath();
        ctx.fillStyle = `rgba(${Math.round(r * lit * 0.06)},${Math.round(gc * lit * 0.06)},${Math.round(b * lit * 0.08 + 10)},${0.92 + lit * 0.06})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${r},${gc},${b},${(0.15 + lit * 0.65) * alphaScale})`;
        ctx.lineWidth = 0.5 + lit * 0.7;
        ctx.stroke();
      }
    };
    drawMtns(mountainsRef.current.leftBack,   0.75);
    drawMtns(mountainsRef.current.rightBack,  0.75);
    drawMtns(mountainsRef.current.leftFront,  1.0);
    drawMtns(mountainsRef.current.rightFront, 1.0);

    // ── 7. Road surface ───────────────────────────────────────────────────────
    const roadPath = () => {
      ctx.beginPath();
      ctx.moveTo(rLeft(horizonY),  horizonY);
      ctx.lineTo(rRight(horizonY), horizonY);
      ctx.lineTo(rRight(h),        h);
      ctx.lineTo(rLeft(h),         h);
      ctx.closePath();
    };
    roadPath();
    ctx.fillStyle = 'rgba(3,3,16,0.90)';
    ctx.fill();
    roadPath();
    const roadTint = ctx.createLinearGradient(0, horizonY, 0, h);
    roadTint.addColorStop(0, `rgba(${r},${gc},${b},0.025)`);
    roadTint.addColorStop(1, `rgba(${r},${gc},${b},0.09)`);
    ctx.fillStyle = roadTint;
    ctx.fill();

    // ── 8. Road edges ─────────────────────────────────────────────────────────
    for (const side of [-1, 1]) {
      const xH = side < 0 ? rLeft(horizonY)  : rRight(horizonY);
      const xB = side < 0 ? rLeft(h)         : rRight(h);
      ctx.beginPath();
      ctx.moveTo(xH, horizonY);
      ctx.lineTo(xB, h);
      ctx.strokeStyle = `rgba(${r},${gc},${b},0.20)`;
      ctx.lineWidth = 22;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xH, horizonY);
      ctx.lineTo(xB, h);
      ctx.strokeStyle = `rgba(${r},${gc},${b},0.45)`;
      ctx.lineWidth = 8;
      ctx.stroke();
      const eN = 1.5, eW = 5.0;
      ctx.beginPath();
      ctx.moveTo(xH + (-side) * eN, horizonY);
      ctx.lineTo(xH +   side  * eN, horizonY);
      ctx.lineTo(xB +   side  * eW, h);
      ctx.lineTo(xB + (-side) * eW, h);
      ctx.closePath();
      ctx.fillStyle = `rgba(${r},${gc},${b},0.92)`;
      ctx.fill();
    }

    // ── 9. Route progress bar (bottom strip) ──────────────────────────────────
    const barH  = 4;
    const barY  = h - barH;
    const prog  = total > 0 ? Math.min(1, dist / total) : 0;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, barY, w, barH);
    ctx.fillStyle = `rgba(${r},${gc},${b},0.75)`;
    ctx.fillRect(0, barY, w * prog, barH);
    // Glowing tip of progress bar
    if (prog > 0 && prog < 1) {
      const tipX = w * prog;
      const tipGlow = ctx.createRadialGradient(tipX, barY + barH / 2, 0, tipX, barY + barH / 2, 8);
      tipGlow.addColorStop(0, `rgba(${r},${gc},${b},0.9)`);
      tipGlow.addColorStop(1, `rgba(${r},${gc},${b},0)`);
      ctx.fillStyle = tipGlow;
      ctx.fillRect(tipX - 8, barY - 4, 16, barH + 8);
    }

    animRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [draw]);

  const [r, gc, b] = gradeRGB(grade || 0);
  const gradeColor = `rgb(${r},${gc},${b})`;
  const speed  = Math.round(telemetry?.speed   || 0);
  const power  = Math.round(telemetry?.power   || 0);
  const cadence = Math.round(telemetry?.cadence || 0);
  const progress = totalDistance > 0 ? Math.min(100, (distanceRidden / totalDistance) * 100) : 0;
  const remaining = Math.max(0, totalDistance - distanceRidden);
  const gradeSign = (grade || 0) > 0 ? '+' : '';

  return (
    <div className="synthwave-container">
      <canvas ref={canvasRef} />
      <div className="synthwave-hud">
        {/* Top row */}
        <div>
          <div className="hud-segment-name">{routeName || 'Route Ride'}</div>
          <div className="hud-segment-time">{formatTime(elapsedTime || 0)} elapsed</div>
        </div>
        {/* Bottom row */}
        <div className="hud-bottom">
          <div>
            <div className="hud-power" style={{ color: gradeColor }}>
              {speed}<span style={{ fontSize: '1rem', marginLeft: '0.25rem' }}>km/h</span>
            </div>
            <div className="hud-power-target" style={{ color: gradeColor }}>
              {gradeSign}{(grade || 0).toFixed(1)}%
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="hud-cadence">
              {distanceRidden.toFixed(1)}<span style={{ fontSize: '0.9rem', marginLeft: '0.2rem' }}>km</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)' }}>
              {remaining.toFixed(1)} km left · {progress.toFixed(0)}%
            </div>
            {power > 0 && (
              <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.55)', marginTop: '0.2rem' }}>
                {power} W · {cadence} rpm
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

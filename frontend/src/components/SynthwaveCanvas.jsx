import React, { useRef, useEffect, useCallback } from 'react';

function zoneRGB(watts, ftpVal) {
  const pct = ftpVal > 0 ? watts / ftpVal : 0;
  if (pct < 0.60) return [136, 136, 136];
  if (pct < 0.75) return [68,  136, 255];
  if (pct < 0.90) return [68,  204, 136];
  if (pct < 1.05) return [255, 204,   0];
  if (pct < 1.20) return [255, 136,   0];
  return             [255,   0, 170];
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Deterministic XOR-shift RNG
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}

// Build a low-poly mountain range as triangles.
// Each tri: { pts: [[x,y],[x,y],[x,y]], lit: 0–1 }
// Peaks go ABOVE baseY (upward into the sky).
function buildMountains(xMin, xMax, baseY, maxH, numPeaks, rng) {
  // Valley points evenly spaced along the base
  const valleys = Array.from({ length: numPeaks + 1 }, (_, i) => [
    xMin + (xMax - xMin) * i / numPeaks,
    baseY,
  ]);
  // Peak points — one per inter-valley gap, height varied
  const peaks = Array.from({ length: numPeaks }, (_, i) => {
    const cx = (valleys[i][0] + valleys[i + 1][0]) / 2 + (rng() - 0.5) * (xMax - xMin) * 0.22;
    const ht = (0.15 + rng() * 0.85) * maxH;
    return [cx, baseY - ht];
  });

  const tris = [];
  // Upward triangles: valley[i] → peak[i] → valley[i+1]
  for (let i = 0; i < numPeaks; i++) {
    tris.push({ pts: [valleys[i], peaks[i], valleys[i + 1]], lit: 0.2 + rng() * 0.8 });
  }
  // Inverted triangles between adjacent peaks: peak[i] → valley[i+1] → peak[i+1]
  for (let i = 0; i < numPeaks - 1; i++) {
    tris.push({ pts: [peaks[i], valleys[i + 1], peaks[i + 1]], lit: 0.05 + rng() * 0.35 });
  }
  return tris;
}

export default function SynthwaveCanvas({
  executionPlan,
  currentSegmentIndex,
  segmentElapsed,
  telemetry,
  targetPower,
  ftp,
  isPaused,
}) {
  const canvasRef      = useRef(null);
  const animRef        = useRef(null);
  const offsetRef      = useRef(0);
  const flashRef       = useRef(0);
  const prevSegIdxRef  = useRef(currentSegmentIndex);
  const starsRef       = useRef(null);
  const mountainsRef   = useRef(null);
  const liveRef        = useRef({
    telemetry, targetPower, ftp, isPaused,
    executionPlan, currentSegmentIndex, segmentElapsed,
  });

  useEffect(() => {
    liveRef.current = {
      telemetry, targetPower, ftp, isPaused,
      executionPlan, currentSegmentIndex, segmentElapsed,
    };
  }, [telemetry, targetPower, ftp, isPaused, executionPlan, currentSegmentIndex, segmentElapsed]);

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

    const {
      telemetry: tel, targetPower: tp, ftp: ftpVal,
      isPaused: paused, executionPlan: plan,
      currentSegmentIndex: segIdx, segmentElapsed: segElapsed,
    } = liveRef.current;

    const speed     = tel?.speed || 0;
    const [r, g, b] = zoneRGB(tp || 0, ftpVal || 200);
    const horizonY  = h * 0.42;
    const vx        = w / 2;

    // ── Road geometry ────────────────────────────────────────────────────────
    const rNarrow = w * 0.028;
    const rWide   = w * 0.30;
    const rLeft   = (y) => { const t = (y - horizonY) / (h - horizonY); return vx - (rNarrow + (rWide - rNarrow) * t); };
    const rRight  = (y) => { const t = (y - horizonY) / (h - horizonY); return vx + (rNarrow + (rWide - rNarrow) * t); };

    // ── Animation tick ───────────────────────────────────────────────────────
    if (segIdx !== prevSegIdxRef.current) {
      flashRef.current      = 1;
      prevSegIdxRef.current = segIdx;
    }
    if (!paused) offsetRef.current = (offsetRef.current + Math.max(speed, 4) / 900) % 1;
    if (flashRef.current > 0.001) flashRef.current *= 0.88; else flashRef.current = 0;

    // ── 1. Background ────────────────────────────────────────────────────────
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0,   '#010108');
    bg.addColorStop(0.5, '#07071a');
    bg.addColorStop(1,   '#0d0617');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // ── 2. Stars ─────────────────────────────────────────────────────────────
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

    // ── 3. Sky glow (horizon band) ────────────────────────────────────────────
    const skyGlow = ctx.createLinearGradient(0, horizonY - h * 0.30, 0, horizonY);
    skyGlow.addColorStop(0, `rgba(${r},${g},${b},0)`);
    skyGlow.addColorStop(1, `rgba(${r},${g},${b},0.30)`);
    ctx.fillStyle = skyGlow;
    ctx.fillRect(0, horizonY - h * 0.30, w, h * 0.30);

    // ── 4. Sun ───────────────────────────────────────────────────────────────
    const sunR = Math.max(8, w * 0.085 + Math.sin(timestamp / 900) * 2.5);
    for (const [mult, alpha] of [[4.5, 0.05], [2.8, 0.11], [1.7, 0.23]]) {
      const bloom = ctx.createRadialGradient(vx, horizonY, 0, vx, horizonY, sunR * mult);
      bloom.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
      bloom.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(vx, horizonY, sunR * mult, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(vx, horizonY, sunR, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = `rgb(${r},${g},${b})`;
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

    // ── 5. Flat perspective grid (full ground width) ──────────────────────────
    const vLineCount = 14;
    const hLineCount = 12;

    // Vertical lines converging to vanishing point
    for (let i = 0; i <= vLineCount; i++) {
      const xBot = (w / vLineCount) * i;
      const dist  = Math.abs(i / vLineCount - 0.5) * 2; // 0=center, 1=edge
      ctx.beginPath();
      ctx.moveTo(xBot, h);
      ctx.lineTo(vx, horizonY);
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.05 + dist * 0.32})`;
      ctx.lineWidth = 0.5 + dist * 0.8;
      ctx.stroke();
    }

    // Horizontal lines — perspective spaced, scrolling toward viewer
    for (let i = 0; i < hLineCount; i++) {
      const t     = ((i + offsetRef.current) % hLineCount) / hLineCount;
      const yLine = horizonY + (h - horizonY) * Math.pow(t, 1.6);
      const u     = (yLine - horizonY) / (h - horizonY); // 0 at horizon, 1 at bottom
      // Line spans from left to right edge of perspective grid at this depth
      const xL = vx - vx * u;
      const xR = vx + vx * u;
      ctx.beginPath();
      ctx.moveTo(xL, yLine);
      ctx.lineTo(xR, yLine);
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.06 + t * 0.52})`;
      ctx.lineWidth = 0.3 + t * 1.8;
      ctx.stroke();
    }

    // ── 6. Low-poly mountains ─────────────────────────────────────────────────
    if (!mountainsRef.current) {
      const rng1 = makeRng(0xdeadbeef);
      const rng2 = makeRng(0xc0ffee42);
      const maxH = horizonY * 0.90;
      // Two groups per side for depth: back (taller) + front (shorter, more jagged)
      mountainsRef.current = {
        leftBack:   buildMountains(-w * 0.06, w * 0.46, horizonY + 6, maxH,        9,  rng1),
        leftFront:  buildMountains(-w * 0.02, w * 0.38, horizonY + 6, maxH * 0.60, 7,  rng1),
        rightBack:  buildMountains(w * 0.54, w * 1.06, horizonY + 6, maxH,        9,  rng2),
        rightFront: buildMountains(w * 0.62, w * 1.02, horizonY + 6, maxH * 0.60, 7,  rng2),
      };
    }

    const drawMtns = (tris, edgeAlphaScale) => {
      for (const { pts, lit } of tris) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        ctx.lineTo(pts[1][0], pts[1][1]);
        ctx.lineTo(pts[2][0], pts[2][1]);
        ctx.closePath();
        // Slightly varied dark fill — brighter "lit" faces catch a hint of zone color
        ctx.fillStyle = `rgba(${Math.round(r * lit * 0.06)},${Math.round(g * lit * 0.06)},${Math.round(b * lit * 0.08 + 10)},${0.92 + lit * 0.06})`;
        ctx.fill();
        // Zone-colored wireframe edge — brighter on lit faces
        ctx.strokeStyle = `rgba(${r},${g},${b},${(0.15 + lit * 0.65) * edgeAlphaScale})`;
        ctx.lineWidth = 0.5 + lit * 0.7;
        ctx.stroke();
      }
    };

    // Back ranges first (drawn behind), then front ranges on top
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

    // Dark base — covers the grid lines under the road
    roadPath();
    ctx.fillStyle = 'rgba(3,3,16,0.90)';
    ctx.fill();

    // Subtle zone tint on road surface
    roadPath();
    const roadTint = ctx.createLinearGradient(0, horizonY, 0, h);
    roadTint.addColorStop(0, `rgba(${r},${g},${b},0.025)`);
    roadTint.addColorStop(1, `rgba(${r},${g},${b},0.09)`);
    ctx.fillStyle = roadTint;
    ctx.fill();

    // ── 8. Road edges — neon glow, zone colored ───────────────────────────────
    for (const side of [-1, 1]) {
      const xH = side < 0 ? rLeft(horizonY)  : rRight(horizonY);
      const xB = side < 0 ? rLeft(h)         : rRight(h);

      // Wide outer glow
      ctx.beginPath();
      ctx.moveTo(xH, horizonY);
      ctx.lineTo(xB, h);
      ctx.strokeStyle = `rgba(${r},${g},${b},0.20)`;
      ctx.lineWidth = 22;
      ctx.stroke();

      // Narrow inner glow
      ctx.beginPath();
      ctx.moveTo(xH, horizonY);
      ctx.lineTo(xB, h);
      ctx.strokeStyle = `rgba(${r},${g},${b},0.45)`;
      ctx.lineWidth = 8;
      ctx.stroke();

      // Solid core strip (tapered polygon)
      const eN = 1.5, eW = 5.0;
      ctx.beginPath();
      ctx.moveTo(xH + (-side) * eN, horizonY);
      ctx.lineTo(xH +   side  * eN, horizonY);
      ctx.lineTo(xB +   side  * eW, h);
      ctx.lineTo(xB + (-side) * eW, h);
      ctx.closePath();
      ctx.fillStyle = `rgba(${r},${g},${b},0.92)`;
      ctx.fill();
    }

    // ── 9. Segment transition flash ───────────────────────────────────────────
    if (flashRef.current > 0) {
      ctx.fillStyle = `rgba(${r},${g},${b},${flashRef.current * 0.38})`;
      ctx.fillRect(0, 0, w, h);
    }

    animRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [draw]);

  // HUD values (from props directly — JSX re-renders on prop change)
  const seg       = executionPlan?.[currentSegmentIndex] || {};
  const remaining = Math.max(0, (seg.duration || 0) - segmentElapsed);
  const [pr, pg, pb] = zoneRGB(targetPower || 0, ftp || 200);
  const zoneColor = `rgb(${pr},${pg},${pb})`;
  const power     = Math.round(telemetry?.power   || 0);
  const cadence   = Math.round(telemetry?.cadence || 0);

  return (
    <div className="synthwave-container">
      <canvas ref={canvasRef} />
      <div className="synthwave-hud">
        <div>
          <div className="hud-segment-name">{seg.name || ''}</div>
          <div className="hud-segment-time">{formatTime(remaining)} remaining</div>
        </div>
        <div className="hud-bottom">
          <div>
            <div className="hud-power" style={{ color: zoneColor }}>
              {power}<span style={{ fontSize: '1rem', marginLeft: '0.25rem' }}>W</span>
            </div>
            <div className="hud-power-target">Target: {targetPower || '--'}W</div>
          </div>
          <div>
            <div className="hud-cadence">{cadence}</div>
            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.45)', textAlign: 'right' }}>rpm</div>
          </div>
        </div>
      </div>
    </div>
  );
}

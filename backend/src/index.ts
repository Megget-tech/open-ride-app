/**
 * Open Ride - Backend API Server
 *
 * Serves workout data and static files.
 * ANT+ USB communication is now handled directly in the browser via WebUSB.
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  loadAllWorkouts,
  getWorkoutSummaries,
  formatDuration,
  getCategories,
  filterByCategory,
  filterByTag,
  searchWorkouts,
  Workout
} from './workoutParser.js';

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Banner
console.log('='.repeat(60));
console.log('  Open Ride - Backend API Server');
console.log('  WebUSB Mode - ANT+ handled in browser');
console.log('='.repeat(60));
console.log();

// Create Express app
const app = express();
const server = createServer(app);

// CORS middleware for development
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// JSON body parser (allow up to 10 MB for TCX payloads)
app.use(express.json({ limit: '10mb' }));

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Load workouts
const workoutsDir = path.join(__dirname, '../workouts');
let workouts: Workout[] = loadAllWorkouts(workoutsDir);

// API endpoint for status check
app.get('/api/status', (_req, res) => {
  res.json({
    status: 'ok',
    mode: 'webusb',
    message: 'ANT+ USB handled via WebUSB in browser',
  });
});

// ===== WORKOUTS API =====

// Get all workouts (summaries for listing)
app.get('/api/workouts', (req, res) => {
  const { category, tag, search } = req.query;
  
  let filtered = workouts;
  
  if (typeof category === 'string' && category) {
    filtered = filterByCategory(filtered, category);
  }
  
  if (typeof tag === 'string' && tag) {
    filtered = filterByTag(filtered, tag);
  }
  
  if (typeof search === 'string' && search) {
    filtered = searchWorkouts(filtered, search);
  }
  
  const summaries = getWorkoutSummaries(filtered).map(summary => ({
    ...summary,
    durationFormatted: formatDuration(summary.totalDuration),
  }));
  
  res.json({
    count: summaries.length,
    workouts: summaries,
  });
});

// Get workout categories
app.get('/api/workouts/categories', (_req, res) => {
  res.json({
    categories: getCategories(workouts),
  });
});

// Get a specific workout by ID (full details with elements)
app.get('/api/workouts/:id', (req, res) => {
  const { id } = req.params;
  const workout = workouts.find(w => w.id === id);
  
  if (!workout) {
    res.status(404).json({ error: 'Workout not found' });
    return;
  }
  
  res.json({
    ...workout,
    durationFormatted: formatDuration(workout.totalDuration),
  });
});

// Reload workouts from disk
app.post('/api/workouts/reload', (_req, res) => {
  workouts = loadAllWorkouts(workoutsDir);
  res.json({
    message: 'Workouts reloaded',
    count: workouts.length,
  });
});

// ── Strava OAuth + upload ─────────────────────────────────────────────────────

const STRAVA_CLIENT_ID     = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const FRONTEND_URL         = process.env.FRONTEND_URL || 'http://localhost:3000';

/** Whether Strava credentials are configured in the environment. */
app.get('/api/strava/status', (_req, res) => {
  res.json({ configured: !!(STRAVA_CLIENT_ID && STRAVA_CLIENT_SECRET) });
});

/** Redirect to Strava's OAuth authorisation page. */
app.get('/api/strava/auth', (req, res) => {
  if (!STRAVA_CLIENT_ID) {
    res.status(503).json({ error: 'Strava not configured — set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env' });
    return;
  }
  const redirectUri = `${req.protocol}://${req.get('host')}/api/strava/callback`;
  const url = new URL('https://www.strava.com/oauth/authorize');
  url.searchParams.set('client_id',    STRAVA_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'activity:write');
  res.redirect(url.toString());
});

/** Receives the auth code from Strava, exchanges it for tokens, redirects to frontend. */
app.get('/api/strava/callback', async (req, res) => {
  const { code, error } = req.query as Record<string, string>;

  if (error || !code) {
    res.redirect(`${FRONTEND_URL}/strava/callback?strava_error=${error || 'cancelled'}`);
    return;
  }

  try {
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        code,
        grant_type:    'authorization_code',
      }),
    });

    const data = await tokenRes.json() as Record<string, unknown>;

    if (typeof data.access_token !== 'string') {
      res.redirect(`${FRONTEND_URL}/strava/callback?strava_error=token_exchange_failed`);
      return;
    }

    const athlete = data.athlete as Record<string, unknown> | undefined;
    const params = new URLSearchParams({
      strava_access_token:  data.access_token,
      strava_refresh_token: String(data.refresh_token ?? ''),
      strava_expires_at:    String(data.expires_at ?? '0'),
      strava_athlete:       String(athlete?.firstname ?? ''),
    });
    res.redirect(`${FRONTEND_URL}/strava/callback?${params}`);

  } catch (err) {
    console.error('[Strava] Callback error:', err);
    res.redirect(`${FRONTEND_URL}/strava/callback?strava_error=server_error`);
  }
});

/**
 * Upload a TCX workout to Strava.
 * Body: { accessToken, refreshToken, expiresAt, tcxContent, workoutName }
 */
app.post('/api/strava/upload', async (req, res) => {
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    res.status(503).json({ error: 'Strava not configured on server' });
    return;
  }

  const { accessToken, refreshToken, expiresAt, tcxContent, workoutName } = req.body as {
    accessToken:  string;
    refreshToken: string;
    expiresAt:    number;
    tcxContent:   string;
    workoutName:  string;
  };

  if (!accessToken || !tcxContent) {
    res.status(400).json({ error: 'Missing accessToken or tcxContent' });
    return;
  }

  let activeToken = accessToken;
  let newToken: Record<string, unknown> | null = null;

  // Refresh token if it expires within the next minute
  if (expiresAt < Date.now() / 1000 + 60) {
    try {
      const refreshRes = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id:     STRAVA_CLIENT_ID,
          client_secret: STRAVA_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type:    'refresh_token',
        }),
      });
      const refreshData = await refreshRes.json() as Record<string, unknown>;
      if (typeof refreshData.access_token === 'string') {
        activeToken = refreshData.access_token;
        newToken = {
          accessToken:  refreshData.access_token,
          refreshToken: String(refreshData.refresh_token ?? refreshToken),
          expiresAt:    Number(refreshData.expires_at ?? 0),
        };
      }
    } catch (err) {
      console.error('[Strava] Token refresh failed:', err);
      // Proceed with the existing token; it may still work
    }
  }

  try {
    const formData = new FormData();
    formData.append('file',      new Blob([tcxContent], { type: 'application/vnd.garmin.tcx+xml' }), 'workout.tcx');
    formData.append('data_type', 'tcx');
    formData.append('name',      workoutName || 'Open Ride Workout');

    const uploadRes = await fetch('https://www.strava.com/api/v3/uploads', {
      method: 'POST',
      headers: { Authorization: `Bearer ${activeToken}` },
      body: formData,
    });

    const uploadData = await uploadRes.json() as Record<string, unknown>;

    if (!uploadRes.ok) {
      console.error('[Strava] Upload rejected:', uploadData);
      res.status(uploadRes.status).json({ error: String(uploadData.message ?? 'Strava upload failed'), ...(newToken ? { newToken } : {}) });
      return;
    }

    res.json({ id: uploadData.id, status: uploadData.status, ...(newToken ? { newToken } : {}) });

  } catch (err) {
    console.error('[Strava] Upload error:', err);
    res.status(500).json({ error: 'Server error during upload' });
  }
});

// ── Graceful shutdown
async function shutdown(): Promise<void> {
  console.log('\nShutting down...');
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
async function main(): Promise<void> {
  // Start HTTP server
  server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
    console.log();
    console.log('API Endpoints:');
    console.log(`  GET  /api/status - Server status`);
    console.log(`  GET  /api/workouts - List all workouts`);
    console.log(`  GET  /api/workouts/:id - Get workout details`);
    console.log(`  GET  /api/workouts/categories - List categories`);
    console.log(`  POST /api/workouts/reload - Reload workouts from disk`);
    console.log(`  GET  /api/strava/status   - Check Strava config`);
    console.log(`  GET  /api/strava/auth     - Initiate Strava OAuth`);
    console.log(`  POST /api/strava/upload   - Upload TCX to Strava`);
    console.log();
    console.log('Frontend:');
    console.log('  Run `cd frontend && npm run dev` to start Vite dev server');
    console.log('  Then open http://localhost:3000 in Chrome/Edge');
    console.log();
    console.log('Note: ANT+ USB communication happens via WebUSB in the browser');
    console.log();
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

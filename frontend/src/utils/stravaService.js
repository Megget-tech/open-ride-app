/**
 * Strava OAuth + upload helpers.
 *
 * Token flow:
 *  1. initiateStravaAuth(pendingData) → saves pending workout, redirects to /api/strava/auth
 *  2. Backend handles OAuth, redirects back to /strava/callback with token in query params
 *  3. StravaCallback.jsx saves token and uploads pending workout
 *
 * Tokens are stored in localStorage under 'openride_strava_token'.
 * Pending uploads survive the OAuth redirect via 'openride_strava_pending'.
 */

const TOKEN_KEY   = 'openride_strava_token';
const PENDING_KEY = 'openride_strava_pending';

// ── Token storage ────────────────────────────────────────────────────────────

export function getStravaToken() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); }
  catch { return null; }
}

export function saveStravaToken(data) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(data));
}

export function clearStravaToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/** True if we have a valid, non-expired access token. */
export function isStravaConnected() {
  const token = getStravaToken();
  return !!(token && token.expiresAt > Date.now() / 1000 + 60);
}

export function getStravaAthleteName() {
  return getStravaToken()?.athleteName || null;
}

// ── Pending upload (survives the OAuth redirect) ──────────────────────────────

export function savePendingUpload(data) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(data));
}

export function getPendingUpload() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); }
  catch { return null; }
}

export function clearPendingUpload() {
  localStorage.removeItem(PENDING_KEY);
}

// ── Upload ────────────────────────────────────────────────────────────────────

/**
 * Upload a TCX string to Strava via the backend proxy.
 * Handles token refresh automatically; saves new token if refreshed.
 *
 * @param {string} tcxContent
 * @param {string} workoutName
 * @returns {Promise<{id:number, status:string}>}
 */
export async function uploadToStrava(tcxContent, workoutName) {
  const token = getStravaToken();
  if (!token) throw new Error('Not connected to Strava');

  const res = await fetch('/api/strava/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accessToken:  token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt:    token.expiresAt,
      tcxContent,
      workoutName,
    }),
  });

  const data = await res.json();

  // Backend may return a refreshed token
  if (data.newToken) {
    saveStravaToken({ ...token, ...data.newToken });
  }

  if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
  return data;
}

// ── OAuth entry point ─────────────────────────────────────────────────────────

/**
 * Save pending workout data and redirect to Strava OAuth.
 * After auth, the backend redirects to /strava/callback which uploads the pending workout.
 *
 * @param {{ tcxContent: string, workoutName: string }} pendingData
 */
export function initiateStravaAuth(pendingData) {
  savePendingUpload(pendingData);
  window.location.href = '/api/strava/auth';
}

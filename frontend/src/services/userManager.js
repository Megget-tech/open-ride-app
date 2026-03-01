/**
 * userManager.js — Local multi-profile support using the snapshot-swap strategy.
 *
 * All user-specific localStorage keys are serialized into a snapshot blob when
 * switching away from a user, then restored when switching back. Existing page
 * code reads/writes the same key names and requires zero changes.
 */

// Keys that belong to a user profile (snapshotted on switch)
export const USER_DATA_KEYS = [
  'openride_settings',
  'openride_workout_history',
  'openride_route_history',
  'openride_training_program',
  'openride_custom_workouts',
  'openride_current_route',
];

export const AVATAR_COLORS = [
  '#00d4ff', // cyan
  '#ff7a00', // orange
  '#00e676', // green
  '#ff4db8', // pink
  '#b47aff', // purple
  '#ffe600', // yellow
];

// ─── internal helpers ──────────────────────────────────────────────────────────

function readUsers() {
  try {
    return JSON.parse(localStorage.getItem('openride_users') || '[]');
  } catch {
    return [];
  }
}

function writeUsers(users) {
  localStorage.setItem('openride_users', JSON.stringify(users));
}

function saveSnapshot(userId) {
  const snapshot = {};
  for (const key of USER_DATA_KEYS) {
    const val = localStorage.getItem(key);
    if (val !== null) snapshot[key] = val;
  }
  localStorage.setItem(`openride_snapshot_${userId}`, JSON.stringify(snapshot));
}

function restoreSnapshot(userId) {
  // Clear all user-specific keys first
  for (const key of USER_DATA_KEYS) {
    localStorage.removeItem(key);
  }
  const raw = localStorage.getItem(`openride_snapshot_${userId}`);
  if (!raw) return; // fresh user — keep keys empty
  try {
    const snapshot = JSON.parse(raw);
    for (const [key, val] of Object.entries(snapshot)) {
      localStorage.setItem(key, val);
    }
  } catch {
    // corrupt snapshot — just leave keys empty
  }
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Called once at app startup. Creates the first user from existing data if
 * no `openride_users` list exists yet (first-time migration), or repairs it
 * if the stored value is invalid/corrupted.
 */
export function initUsers() {
  const rawUsers = localStorage.getItem('openride_users');
  if (rawUsers !== null) {
    try {
      const parsed = JSON.parse(rawUsers);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Already set up with at least one user; nothing to do.
        return;
      }
      // If it's not an array or it's empty, fall through to repair.
    } catch {
      // Corrupted JSON; fall through to repair.
    }
  }

  // Read name from existing settings if available
  let name = 'Rider 1';
  try {
    const settings = JSON.parse(localStorage.getItem('openride_settings') || '{}');
    if (settings.displayName) name = settings.displayName;
  } catch {
    // ignore
  }

  const userId = `user-${Date.now()}`;
  const users = [{ id: userId, name, color: AVATAR_COLORS[0], createdAt: new Date().toISOString() }];
  writeUsers(users);
  localStorage.setItem('openride_active_user', userId);
  // Existing localStorage data already belongs to this user — no migration needed.
  // The snapshot is only saved when switching away.
}

/** Returns the list of all user objects: { id, name, color, createdAt } */
export function getUsers() {
  return readUsers();
}

/** Returns the active user's id string, or null if not initialised. */
export function getActiveUserId() {
  return localStorage.getItem('openride_active_user');
}

/** Returns the active user object, or null. */
export function getActiveUser() {
  const id = getActiveUserId();
  return readUsers().find(u => u.id === id) || null;
}

/**
 * Create a new user with the given name. Saves the current user's snapshot,
 * sets the new user as active (with empty data), and returns the new user object.
 * Caller MUST call `window.location.reload()` afterwards.
 */
export function createUser(name) {
  const users = readUsers();
  const activeId = getActiveUserId();

  // Save current user's data
  if (activeId) saveSnapshot(activeId);

  // Pick the next color in rotation
  const color = AVATAR_COLORS[users.length % AVATAR_COLORS.length];
  const newUser = { id: `user-${Date.now()}`, name: name.trim() || 'Rider', color, createdAt: new Date().toISOString() };
  users.push(newUser);
  writeUsers(users);

  // Switch to new user with empty data
  localStorage.setItem('openride_active_user', newUser.id);
  for (const key of USER_DATA_KEYS) {
    localStorage.removeItem(key);
  }

  return newUser;
}

/**
 * Switch to a different user. Saves the current user's snapshot, restores the
 * target user's snapshot, and updates the active user.
 * Caller MUST call `window.location.reload()` afterwards.
 */
export function switchUser(id) {
  const activeId = getActiveUserId();
  if (activeId === id) return;

  if (activeId) saveSnapshot(activeId);
  restoreSnapshot(id);
  localStorage.setItem('openride_active_user', id);
}

/**
 * Rename a user. Updates the users list only — no reload needed.
 */
export function renameUser(id, name) {
  const users = readUsers();
  const user = users.find(u => u.id === id);
  if (!user) return;
  user.name = name.trim() || user.name;
  writeUsers(users);
}

/**
 * Delete a user (and their snapshot). Guards: cannot delete the active user or
 * the only remaining user. Returns true on success, false otherwise.
 */
export function deleteUser(id) {
  const users = readUsers();
  if (users.length <= 1) return false;
  if (getActiveUserId() === id) return false;

  const filtered = users.filter(u => u.id !== id);
  writeUsers(filtered);
  localStorage.removeItem(`openride_snapshot_${id}`);
  return true;
}

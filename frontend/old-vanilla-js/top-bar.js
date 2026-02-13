/**
 * Reusable Top Navigation Bar
 *
 * Usage:
 *   TopBar.init(config)                     — call once after DOM is ready
 *   TopBar.updateConnection(connected, id)  — update badge from status messages
 *   TopBar.setTitle(text)                   — update center title (activity mode)
 *   TopBar.showEmulator(visible)            — show/hide emulator badge (main mode)
 *
 * Main-page config:
 *   { type:'main', activePage:'home'|'settings', showConnection:bool, onConnectionClick:fn }
 *
 * Activity-page config:
 *   { type:'activity', backLabel:'Exit', title:'…', onConnectionClick:fn }
 */
const TopBar = (() => {
  let _config = null;

  // ── shared SVG snippets ───────────────────────────────────────────
  const SVG_HOME = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">'
    + '<path d="M3 13h1v7c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-7h1c.55 0 .85-.66.5-1.08l-9-9c-.28-.28-.72-.28-1 0l-9 9c-.35.42-.05 1.08.5 1.08z"/>'
    + '</svg>';

  const SVG_SETTINGS = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">'
    + '<path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>'
    + '</svg>';

  const SVG_SIGNAL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">'
    + '<circle cx="12" cy="12" r="2"/>'
    + '<path d="M12 6c-3.87 0-7 3.13-7 7h2c0-2.76 2.24-5 5-5s5 2.24 5 5h2c0-3.87-3.13-7-7-7z"/>'
    + '<path d="M12 2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8s8 3.59 8 8h2c0-5.52-4.48-10-10-10z"/>'
    + '</svg>';

  const SVG_ARROW_BACK = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
    + '<path d="M19 12H5m7-7-7 7 7 7"/>'
    + '</svg>';

  const AVATAR_SRC = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E"
    + "%3Ccircle cx='50' cy='50' r='50' fill='%2300d4ff'/%3E"
    + "%3Ctext x='50' y='65' text-anchor='middle' fill='white' font-size='40' font-family='Arial'>U%3C/text%3E%3C/svg%3E";

  // ── templates ─────────────────────────────────────────────────────
  function _mainTemplate() {
    const homeActive     = _config.activePage === 'home'     ? ' active' : '';
    const settingsActive = _config.activePage === 'settings' ? ' active' : '';

    return `
      <div class="nav-left">
        <div class="logo">🚴 Open Ride</div>
        <div class="nav-tabs">
          <a href="index.html"    class="nav-tab${homeActive}">${SVG_HOME} Home</a>
          <a href="settings.html" class="nav-tab${settingsActive}">${SVG_SETTINGS} Settings</a>
        </div>
      </div>
      <div class="nav-right">
        <div id="emulator-badge" class="emulator-badge-nav" style="display:none">🎮 EMULATOR</div>
        ${_config.showConnection ? _connectionBadge() : ''}
        <div class="user-avatar"><img src="${AVATAR_SRC}" alt="User"></div>
      </div>`;
  }

  function _activityTemplate() {
    return `
      <div class="nav-left">
        <a href="index.html" class="nav-back">${SVG_ARROW_BACK}<span>${_config.backLabel || 'Exit'}</span></a>
      </div>
      <div class="nav-center">
        <span id="nav-title" class="nav-title">${_config.title || ''}</span>
      </div>
      <div class="nav-right">
        ${_connectionBadge()}
      </div>`;
  }

  function _connectionBadge() {
    return `<div id="connection-badge" class="connection-badge">${SVG_SIGNAL}<span id="connection-badge-text">Connect Devices</span></div>`;
  }

  // ── public API ────────────────────────────────────────────────────
  function init(config) {
    _config = config;

    const nav = document.createElement('nav');
    nav.className = 'top-nav' + (config.type === 'activity' ? ' top-nav--activity' : '');
    nav.innerHTML = config.type === 'main' ? _mainTemplate() : _activityTemplate();

    document.body.insertBefore(nav, document.body.firstChild);

    if (config.onConnectionClick) {
      const badge = document.getElementById('connection-badge');
      if (badge) badge.addEventListener('click', config.onConnectionClick);
    }

    if (config.type === 'main') _checkEmulatorMode();
  }

  function updateConnection(connected, deviceId) {
    const badge = document.getElementById('connection-badge');
    const text  = document.getElementById('connection-badge-text');
    if (!badge || !text) return;

    badge.classList.toggle('connected', connected);
    text.textContent = connected
      ? (deviceId ? `Connected (${deviceId})` : 'Connected')
      : 'Connect Devices';
  }

  function setTitle(text) {
    const el = document.getElementById('nav-title');
    if (el) el.textContent = text;
  }

  function showEmulator(visible) {
    const badge = document.getElementById('emulator-badge');
    if (badge) badge.style.display = visible ? 'block' : 'none';
  }

  // ── internals ─────────────────────────────────────────────────────
  async function _checkEmulatorMode() {
    try {
      const res  = await fetch('/api/status');
      const data = await res.json();
      if (data.emulator) showEmulator(true);
    } catch (_) { /* ignore */ }
  }

  return { init, updateConnection, setTitle, showEmulator };
})();

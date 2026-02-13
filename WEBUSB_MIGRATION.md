# WebUSB Migration Guide

This project has been migrated from a backend-driven architecture to WebUSB, eliminating the need for a backend to handle ANT+ USB communication.

## Architecture Changes

### Before (WebSocket Architecture)
```
Browser <-> WebSocket <-> Backend (Node.js) <-> ANT+ USB Dongle
```

### After (WebUSB Architecture)
```
Browser (Chrome/Edge) <-> WebUSB <-> ANT+ USB Dongle
         ↓
    Backend API (workouts only)
```

## What Changed

### Frontend
- **New**: `antManagerWebUSB.js` - WebUSB-based ANT+ manager
- **New**: `antManager.js` - Shared singleton instance
- **Updated**: `app.js` - Now uses WebUSB instead of WebSocket
- **New**: `package.json` - Frontend dependencies (ant-plus-next, vite)
- **New**: `vite.config.js` - Vite configuration for dev server

### Backend
- **Removed**: WebSocket handler (`websocket.ts`)
- **Removed**: ANT+ manager dependencies from backend
- **Updated**: `index.ts` - Now only serves API endpoints
- **Updated**: `package.json` - Removed `ant-plus-next` and `ws` dependencies

### Files Still Using WebSocket (Need Migration)
- `workout-runner.js` - Workout execution page
- `freeride.js` - Free ride mode
- `device-modal.js` - Device scan modal (if exists)

## How to Run

### 1. Install Dependencies

**Backend:**
```bash
cd backend
npm install
```

**Frontend:**
```bash
cd frontend
npm install
```

### 2. Start Servers

**Backend (Terminal 1):**
```bash
cd backend
npm run dev
```
This starts the API server on http://localhost:3001

**Frontend (Terminal 2):**
```bash
cd frontend
npm run dev
```
This starts Vite dev server on http://localhost:3000

### 3. Choose Your Mode

**Emulator Mode (No Hardware Required):**
- Open http://localhost:3000?emulator=true
- Or enable in browser console: `localStorage.setItem('openride_use_emulator', 'true')`
- Simulates 3 trainers with realistic telemetry
- Perfect for development and testing

**Real Hardware Mode:**
- Open http://localhost:3000 in **Chrome or Edge**
- Requires actual ANT+ USB dongle and trainer
- Browser will prompt for USB device selection

### 4. Connect ANT+ USB Dongle

1. Click "Device Scan" button in the app
2. Click "Start Scan"
3. Browser will prompt you to select USB device
4. Select your ANT+ USB dongle (Garmin USB or USB-m)
5. Grant permission
6. The app will now scan for trainers

## Browser Compatibility

### ✅ Supported
- Chrome (Desktop)
- Edge (Desktop)
- Opera (Desktop)

### ❌ Not Supported
- Firefox (no WebUSB support)
- Safari (no WebUSB support)
- Mobile browsers (no WebUSB support)

## Important Notes

### HTTPS Requirement
WebUSB requires HTTPS in production. For local development, `localhost` is allowed over HTTP.

### User Permission
Unlike the WebSocket approach, WebUSB requires explicit user interaction to grant USB device access. The browser will show a device picker dialog - this is a security feature and cannot be bypassed.

### Permissions Persist
Once granted, USB device permissions persist across sessions (until revoked by user).

## Emulator Mode

The frontend now includes an emulator for development without hardware:

### Enabling Emulator
```bash
# Option 1: URL parameter
http://localhost:3000?emulator=true

# Option 2: Browser console
localStorage.setItem('openride_use_emulator', 'true')
# Then reload the page
```

### Emulated Devices
- Wahoo KICKR CORE (ID: 12345)
- Wahoo KICKR (ID: 54321)
- Elite Direto (ID: 99999)

### Features
- Realistic power/cadence/speed/heart rate simulation
- Physics-based response to target power and resistance
- No hardware or USB dongle required
- Works in any browser (not just Chrome/Edge)

## Benefits of WebUSB

1. **No Backend for USB** - Eliminates complexity of backend USB handling
2. **Direct Communication** - Lower latency between browser and device
3. **Simpler Deployment** - Backend only needs to serve API, not manage USB
4. **Better Security** - Browser manages USB permissions with user consent
5. **Emulator Available** - Can develop/test without hardware

## Limitations

1. **Browser Dependency** - Only works in Chromium-based browsers
2. **User Interaction Required** - Must click to grant USB access (good for security)
3. **HTTPS Required** - Production deployment needs HTTPS

## Next Steps

To fully migrate, you should also update:
1. `workout-runner.js` - Update to use shared `antManager.js`
2. `freeride.js` - Update to use shared `antManager.js`
3. Any other pages that connect to devices

## Rollback

If you need to rollback to WebSocket architecture, checkout the previous commit:
```bash
git log --oneline  # Find commit before WebUSB migration
git checkout <commit-hash>
```

# AGENTS.md

> Open Ride is an open-source indoor cycling app that connects to ANT+ smart trainers directly from the browser via WebUSB. It serves structured workouts and free-ride sessions with real-time telemetry. No accounts, no cloud, no subscription.

---

## Project overview

```
Browser (React + WebUSB)  <── USB ──>  ANT+ Dongle  <── 2.4 GHz ──>  Trainer
         | REST API
    Node.js Backend (workout files)
```

The frontend is a React SPA that communicates with a Garmin ANT+ USB dongle **directly in the browser** using the WebUSB API and the `ant-plus-next` library. A lightweight Express backend serves workout files via a REST API. There is no database -- workouts are `.orw` XML files on disk.

### Key design principles

- **Privacy first** -- zero accounts, all user data stays in the browser (localStorage).
- **Minimal dependencies** -- small `package.json` on both sides. Do not add dependencies without discussion.
- **No linter / formatter enforced** -- follow the conventions already in the file you are editing.
- **Emulator-first development** -- a full software emulator simulates ANT+ hardware so that development and testing require no physical devices.

---

## Tech stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend framework | React 18 (JSX, no TypeScript) | Functional components, hooks only |
| Build tool | Vite 5 | Dev server on port 3000, proxies `/api` to backend |
| Routing | React Router DOM 6 | Client-side SPA routing |
| ANT+ protocol | `ant-plus-next` | FE-C device profile for smart trainers |
| USB access | WebUSB API | Chrome/Edge/Opera only |
| Backend runtime | Node.js 18+ | ES modules throughout |
| Backend framework | Express 4 | REST API on port 3001 |
| Backend language | TypeScript 5 (strict mode) | ES2022 target, NodeNext modules |
| XML parsing | `fast-xml-parser` | Parses `.orw` workout files |
| State management | React Context + localStorage | No Redux/Zustand |
| CSS | Plain CSS, one file per page | No preprocessor, no CSS-in-JS |

---

## Directory structure

```
open-ride-app/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Express server entry, REST API routes
│   │   ├── types.ts              # Shared TypeScript interfaces
│   │   ├── workoutParser.ts      # .orw XML parser and data structures
│   │   └── antManagerEmulator.ts # Server-side ANT+ emulator (dev)
│   ├── workouts/                 # .orw workout XML files
│   ├── tsconfig.json
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── main.jsx              # React entry point
│   │   ├── App.jsx               # Router setup
│   │   ├── pages/
│   │   │   ├── HomePage.jsx      # Workout listing and filtering
│   │   │   ├── WorkoutPage.jsx   # Structured workout execution
│   │   │   ├── FreeRidePage.jsx  # Free ride mode
│   │   │   ├── SettingsPage.jsx  # User settings (FTP, HR, weight, units)
│   │   │   └── TrainingProgramPage.jsx  # Weekly training program builder
│   │   ├── components/
│   │   │   ├── TopBar.jsx        # Navigation bar
│   │   │   ├── DeviceModal.jsx   # ANT+ device scan/connect modal
│   │   │   └── TelemetryDisplay.jsx  # Real-time metrics display
│   │   ├── contexts/
│   │   │   └── AntContext.jsx    # Global ANT+ state and device management
│   │   ├── services/
│   │   │   ├── antManager.js     # Singleton factory (WebUSB vs emulator)
│   │   │   ├── antManagerWebUSB.js   # Real WebUSB ANT+ communication
│   │   │   └── antManagerEmulator.js # Client-side trainer simulation
│   │   └── styles/               # CSS files (one per page/feature)
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── AGENTS.md          # This file
├── CLAUDE.md          # Claude Code-specific instructions
├── CONTRIBUTING.md    # Contribution guidelines
├── EMULATOR_GUIDE.md  # Emulator usage guide
├── WEBUSB_MIGRATION.md
├── README.md
└── LICENSE            # MIT
```

---

## Build and dev commands

### Backend

```bash
cd backend
npm install            # Install dependencies
npm run dev            # Start dev server with hot reload (tsx watch), port 3001
npm run build          # Compile TypeScript to dist/
npm start              # Run compiled JS from dist/
```

### Frontend

```bash
cd frontend
npm install            # Install dependencies
npm run dev            # Start Vite dev server, port 3000
npm run build          # Production build to dist/
npm run preview        # Preview production build
```

### Running both together

Start the backend in one terminal and the frontend in another. The Vite dev server proxies `/api` requests to `localhost:3001`.

### Emulator mode

No hardware needed. Enable emulator via:
- Settings page toggle, or
- URL parameter: `?emulator=true`
- localStorage: `openride_use_emulator = "true"`

---

## REST API

All endpoints are served from the backend on port 3001 (proxied through Vite in development).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/status` | Server health check and mode |
| `GET` | `/api/workouts` | List workouts (supports `?category=`, `?tag=`, `?search=` query params) |
| `GET` | `/api/workouts/categories` | List all workout categories |
| `GET` | `/api/workouts/:id` | Full workout details with segments |
| `POST` | `/api/workouts/reload` | Reload workout files from disk |

---

## Architecture

### Frontend state management

- **AntContext** (`contexts/AntContext.jsx`): React Context providing global ANT+ state (connection status, telemetry, device list) and actions (initialize, scan, connect, disconnect, setTargetPower, setResistance).
- **localStorage keys**: `openride_settings`, `openride_workout_history`, `openride_training_program`, `openride_use_emulator`, `openride_was_connected`.
- **Component state**: Page-specific UI state uses `useState`/`useRef`. Refs are used for high-frequency telemetry data to avoid excessive re-renders.

### ANT+ communication

The `antManager.js` factory returns a singleton -- either `AntManagerWebUSB` (real hardware) or `AntManagerEmulator` (simulated). Both implement the same EventEmitter interface defined in `backend/src/types.ts` (`IAntManager`).

Events emitted: `status`, `device_discovered`, `telemetry`, `scan_telemetry`, `log`.

### Workout system

Workouts are `.orw` XML files in `backend/workouts/`. The parser (`workoutParser.ts`) reads them into typed structures. Segment types: `Warmup`, `Cooldown`, `SteadyState`, `Ramp`, `IntervalsT`, `FreeRide`, `MaxEffort`. Power values are FTP fractions (e.g., `0.75` = 75% of FTP).

---

## Coding conventions

### General

- 2-space indentation everywhere (JS, JSX, TS, CSS, JSON).
- ES modules (`import`/`export`) -- no CommonJS `require`.
- No semicolons are omitted; semicolons are used consistently.
- Single quotes in JavaScript/TypeScript source.
- Use `const` by default; `let` when reassignment is needed; never `var`.

### Backend (TypeScript)

- Strict mode enabled (`"strict": true` in tsconfig).
- File naming: camelCase (`workoutParser.ts`, `antManagerEmulator.ts`).
- Use explicit type annotations for function parameters and return types.
- Interfaces over type aliases for object shapes. Use discriminated unions (e.g., `WorkoutElement`) for variant types.
- Enums for fixed sets of values (e.g., `EquipmentType`).
- JSDoc comments for public functions.
- Underscore prefix for unused Express params: `(_req, res)`.

### Frontend (React JSX)

- Functional components only. No class components.
- PascalCase for component names and files (`WorkoutPage.jsx`, `DeviceModal.jsx`).
- camelCase for all variables, functions, props.
- Destructure props in the function signature: `function TopBar({ variant, title })`.
- Use `useCallback` for functions passed as props or used in dependency arrays.
- Use `useRef` for values that change frequently but should not trigger re-renders (e.g., accumulated telemetry).
- Use `useMemo` for expensive derived values.
- CSS is imported at the top of the component file: `import '../styles/workout.css'`.
- One CSS file per page; shared styles in `index.css`.

### Patterns

- **Singleton**: `antManager.js` exports a factory that returns a cached instance.
- **Factory**: `getAntManager()` picks WebUSB or Emulator based on URL params / localStorage.
- **EventEmitter**: Both ANT+ managers extend EventEmitter and emit `status`, `telemetry`, `device_discovered` events.
- **Context + hooks**: `AntProvider` wraps the app; pages consume via `useAnt()` hook.

---

## Adding new workouts

1. Create a `.orw` XML file in `backend/workouts/`.
2. Follow the XML schema documented in README.md (see "Workouts" section).
3. Power values are FTP fractions: `0.75` means 75% FTP.
4. Include `<name>`, `<description>`, `<category>`, and `<tags>` metadata.
5. The backend auto-discovers new files on startup; use `POST /api/workouts/reload` to refresh without restart.

---

## Environment variables

| Variable | Default | Where | Description |
|----------|---------|-------|-------------|
| `PORT` | `3001` | Backend | Express server port |
| `HOST` | `0.0.0.0` | Backend | Express bind address |
| `VITE_API_BASE_URL` | `""` | Frontend | API base URL (empty = same origin / Vite proxy) |

---

## Git workflow

- Branch from `main` with descriptive names: `fix/speed-display`, `feat/lap-counter`.
- One logical change per commit.
- Test with the emulator before opening a PR.
- PRs target `main`.

---

## Security notes

- No authentication system -- all data is browser-local.
- WebUSB requires HTTPS or localhost. Chrome enforces user consent for USB device access.
- No server-side secrets or sensitive data. The `.env` file only holds `PORT` and `HOST`.
- Do not introduce external API calls or analytics.

---

## Testing

There is currently no automated test suite. Testing is done manually:
- Use emulator mode for UI and logic testing.
- Use a real ANT+ dongle + trainer for hardware integration testing.
- Always test with emulator before submitting changes.

---

## Common tasks for agents

### Adding a new page

1. Create `frontend/src/pages/NewPage.jsx` (PascalCase, functional component).
2. Create `frontend/src/styles/newpage.css` for page-specific styles.
3. Add a route in `frontend/src/App.jsx`.
4. Add navigation in `TopBar.jsx` if needed.

### Adding a new API endpoint

1. Add the route in `backend/src/index.ts`.
2. Add any needed types in `backend/src/types.ts`.
3. Follow existing patterns: validate query params with `typeof x === 'string'`.

### Modifying the workout parser

1. Edit `backend/src/workoutParser.ts`.
2. Add/update interfaces for new element types.
3. Add parsing logic in the `parseWorkoutElement` function.
4. Add the new type to the `WorkoutElement` union.

### Working with ANT+ telemetry

1. The `AntContext` provides telemetry via `useAnt()` hook.
2. Telemetry fields: `power`, `cadence`, `speed`, `heartRate`, `distance`, `elapsedTime`.
3. For high-frequency updates, use `useRef` to cache values and batch UI updates.

# Contributing to Open Ride

Thanks for your interest. Here's how to get involved.

---

## Getting started

1. Fork the repo and clone your fork.
2. `cd backend && npm install`
3. `npm run dev:emulator` — no hardware needed to develop or test.
4. Open [http://localhost:3000](http://localhost:3000).

---

## How the code is organised

The backend is a small Express + WebSocket server written in TypeScript. The frontend is vanilla HTML, CSS, and JavaScript — no bundler, no framework, no build step. Both sides are intentionally simple so that contributing doesn't require learning a large toolchain.

See [README.md](README.md) → *Project layout* for the full file map.

---

## What to work on

Open issues are the best place to start. If you want to tackle something that isn't tracked yet, open an issue first so there's no duplicated effort.

Good first areas:

- **New workouts** — drop a `.orw` file into `backend/workouts/`. See the workout format docs in the README.
- **UI polish** — the frontend lives in `frontend/`. Styles are in the corresponding `.css` files; shared components (`top-bar.js`, `device-modal.js`, `notifications.js`) are reusable IIFEs.
- **Trainer compatibility** — if you have a trainer that behaves differently from the expected FE-C profile, open an issue with the details and we can fix the parsing or telemetry handling together.

---

## Development workflow

1. Create a branch off `main` with a descriptive name (`fix/speed-display`, `feat/lap-counter`, etc.).
2. Make your changes. Keep commits focused — one logical change per commit.
3. Test with the emulator. If you have real hardware, test with that too.
4. Push and open a pull request against `main`. Describe what changed and why.

---

## Code style

There is no linter or formatter enforced in CI (yet). Follow the conventions already in the file you're editing:

- **Backend (TypeScript):** ES modules (`import`/`export`), strict mode on, 2-space indent.
- **Frontend (JavaScript):** Vanilla DOM APIs, no global state pollution. Shared UI pieces are singleton IIFEs that expose a small public API (look at `DeviceModal` or `TopBar` for the pattern).
- **CSS:** One stylesheet per page, shared styles in `styles.css`. No preprocessor.

Don't add dependencies without a conversation first — the `package.json` is deliberately small.

---

## Reporting bugs

Open an issue with:

- What you were doing
- What you expected vs. what happened
- Your OS, Node.js version, and browser
- If it involves a trainer, the trainer model and firmware version if you know it
- Console output or error messages if available

---

## A note on hardware

Most contributors won't have an ANT+ dongle or smart trainer. That's fine — the emulator covers the vast majority of development and testing scenarios. If a change specifically affects real-hardware behaviour, flag it in the PR and someone with the gear can validate it.

---

## License

By contributing you agree that your work is covered by the [MIT License](LICENSE).

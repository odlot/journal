# Journal

Privacy-first, markdown-first web journal MVP built with vanilla HTML, CSS, and JavaScript.

## MVP Features

- Local-first note storage (`IndexedDB` with `localStorage` fallback)
- Markdown editor with live preview
- Note list with search, create, delete
- Debounced autosave
- Security-minded baseline (CSP + escaped markdown rendering)
- Settings modal for encryption and sync configuration
- First-time passphrase setup prompt
- Unlock verifies passphrase with a persisted encrypted key-check record
- In-memory encryption session unlock/lock with idle auto-lock timer
- Passphrase rotation flow re-encrypts encrypted notes with a new key
- Locked state hides note content and disables editing until unlock
- Notes are stored encrypted at rest and loaded only after unlock
- Encrypted JSON backup export/import from Settings
- Clear local data wipe action for browser-stored notes/keys/sync settings
- Manual cloud sync with REST adapter and encrypted payload-only protocol
- Automatic retry for transient sync network/server failures (bounded backoff)
- Playwright E2E coverage for sync retry recovery on transient failures
- Conflict detection with keep-both merge and local/server resolution controls
- Encrypted local commit history with per-note restore UI and deleted-note recovery view
- Unit tests for crypto and sync helper modules (run via validation script)

## Structure

- `index.html`
- `package.json`
- `src/styles.css`
- `src/crypto.js`
- `src/sync.js`
- `src/app.js`
- `tests/crypto.test.js`
- `tests/sync.test.js`
- `tests/e2e/sync-retry-recovery.spec.js`
- `playwright.config.js`
- `ARCHITECTURE.md`
- `SECURITY.md`
- `SYNC_PROTOCOL.md`
- `scripts/validate.sh`
- `scripts/test-e2e.sh`

## Run

Open `index.html` in a browser.

## Keyboard Shortcuts

- `Ctrl/Cmd + Alt + N`: New note
- `Ctrl/Cmd + S`: Save now
- `Ctrl/Cmd + K`: Focus search

## Developer Scripts

Prerequisites:

- `node` + `npm`
- `python3` (used by Playwright web server config)
- Network access for first-time Playwright dependency/browser download

Scripts:

- `./scripts/validate.sh`
: Full local validation. Runs syntax checks, unit tests, and E2E tests.
- `VALIDATE_SKIP_E2E=1 ./scripts/validate.sh`
: Fast validation path (used by CI `validate` job) without Playwright E2E.
- `./scripts/test-e2e.sh`
: Runs only Playwright E2E. Installs npm deps if missing, installs Chromium, then executes E2E tests.

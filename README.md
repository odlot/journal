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
- Conflict detection with keep-both merge and local/server resolution controls
- Encrypted local commit-history foundation for note create/edit/delete events
- Unit tests for crypto and sync helper modules (run via validation script)

## Structure

- `index.html`
- `src/styles.css`
- `src/crypto.js`
- `src/sync.js`
- `src/app.js`
- `tests/crypto.test.js`
- `tests/sync.test.js`
- `ARCHITECTURE.md`
- `SECURITY.md`
- `SYNC_PROTOCOL.md`
- `scripts/validate.sh`

## Run

Open `index.html` in a browser.

## Keyboard Shortcuts

- `Ctrl/Cmd + Alt + N`: New note
- `Ctrl/Cmd + S`: Save now
- `Ctrl/Cmd + K`: Focus search

## Validate

Run `./scripts/validate.sh` locally (same checks used by CI).

# Journal

Privacy-first, markdown-first web journal MVP built with vanilla HTML, CSS, and JavaScript.

## MVP Features

- Local-first note storage (`localStorage`)
- Markdown editor with live preview
- Note list with search, create, delete
- Debounced autosave
- Security-minded baseline (CSP + escaped markdown rendering)
- Settings modal for encryption and sync configuration
- First-time passphrase setup prompt
- Unlock verifies passphrase with a persisted encrypted key-check record
- In-memory encryption session unlock/lock with idle auto-lock timer
- Locked state hides note content and disables editing until unlock
- Notes are stored encrypted at rest and loaded only after unlock
- Encrypted JSON backup export/import from Settings

## Run

Open `index.html` in a browser.

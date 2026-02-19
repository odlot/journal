# TODO - Privacy-First Markdown Journal (Vanilla Web)

## 1) Project Setup

- [x] Create `index.html`, `src/styles.css`, and `src/app.js`
- [x] Keep everything framework-free (plain HTML/CSS/JS)
- [x] Add a minimal layout: note list, editor, preview, sync/settings panel

## 2) Markdown-First Editing

- [x] Add plain textarea editor for markdown input
- [x] Add live markdown preview pane
- [x] Support basic markdown features (headings, lists, links, code blocks)
- [x] Add autosave on input (debounced)

## 3) Local-First Storage

- [x] Store notes in IndexedDB (fallback: `localStorage`)
- [x] Define note schema: `id`, `title`, `content`, `updatedAt`, `deleted`
- [x] Build CRUD operations for notes
- [x] Add local export/import as encrypted JSON backup

## 4) End-to-End Encryption

- [x] Use Web Crypto API (AES-GCM) for note encryption at rest
- [x] Use Web Crypto API (AES-GCM) for note encryption in transit (sync path)
- [x] Derive key from passphrase (PBKDF2 with salt and high iteration count)
- [x] Never store raw passphrase
- [x] Keep key only in memory for active session
- [x] Add lock/unlock flow with idle auto-lock
- [x] Add passphrase change flow with key rotation

## 5) Cloud Sync (Encrypted Blobs Only)

- [x] Define simple sync protocol (`pull`, `push`, conflict metadata)
- [x] Sync ciphertext + metadata only (server never sees plaintext)
- [x] Add pluggable sync adapter interface
- [x] Implement one simple adapter first (REST endpoint)
- [x] Add manual sync button (periodic sync optional)

## 6) Conflict Handling

- [x] Detect conflicts using `updatedAt` and revision id
- [x] Start with simple strategy: keep both copies
- [x] Show conflict resolution UI for merge/replace

## 7) Privacy and Security Hardening

- [x] Add strict Content Security Policy (no inline scripts)
- [x] Sanitize markdown preview output
- [x] Avoid third-party analytics and trackers
- [x] Add clear local data wipe action
- [x] Add threat model notes in docs

## 8) UX (Keep It Simple)

- [ ] Keyboard shortcuts: new note, save, search
- [ ] Collapsible sidebar
- [ ] Toggle markdown preview visibility
- [x] Fast search by title/content
- [x] Mobile-friendly responsive layout
- [ ] Light/dark theme toggle (local preference only)

## 9) Testing and Verification

- [x] Unit test crypto helpers (key derivation/encrypt/decrypt)
- [ ] Test offline usage and recovery
- [ ] Test sync with network failures/retries
- [x] Validate no plaintext leaves browser during sync

## 10) Documentation

- [x] Add `ARCHITECTURE.md` with data flow and trust boundaries
- [x] Add `SECURITY.md` with crypto decisions and limitations
- [x] Add quick start instructions in `README.md`

# TODO - Privacy-First Markdown Journal (Vanilla Web)

## 1) Project Setup

- [x] Create `index.html`, `styles.css`, and `app.js`
- [x] Keep everything framework-free (plain HTML/CSS/JS)
- [x] Add a minimal layout: note list, editor, preview, sync/settings panel

## 2) Markdown-First Editing

- [x] Add plain textarea editor for markdown input
- [x] Add live markdown preview pane
- [x] Support basic markdown features (headings, lists, links, code blocks)
- [x] Add autosave on input (debounced)

## 3) Local-First Storage

- [ ] Store notes in IndexedDB (fallback: `localStorage`)
- [ ] Define note schema: `id`, `title`, `content`, `updatedAt`, `deleted`
- [x] Build CRUD operations for notes
- [x] Add local export/import as encrypted JSON backup

## 4) End-to-End Encryption

- [ ] Use Web Crypto API (AES-GCM) for note encryption at rest and in transit
- [x] Derive key from passphrase (PBKDF2 with salt and high iteration count)
- [x] Never store raw passphrase
- [x] Keep key only in memory for active session
- [x] Add lock/unlock flow with idle auto-lock

## 5) Cloud Sync (Encrypted Blobs Only)

- [ ] Define simple sync protocol (`pull`, `push`, conflict metadata)
- [ ] Sync ciphertext + metadata only (server never sees plaintext)
- [ ] Add pluggable sync adapter interface
- [ ] Implement one simple adapter first (REST endpoint)
- [ ] Add manual sync button + optional periodic sync

## 6) Conflict Handling

- [ ] Detect conflicts using `updatedAt` and revision id
- [ ] Start with simple strategy: keep both copies
- [ ] Show conflict resolution UI for merge/replace

## 7) Privacy and Security Hardening

- [ ] Add strict Content Security Policy (no inline scripts)
- [ ] Sanitize markdown preview output
- [ ] Avoid third-party analytics and trackers
- [ ] Add clear local data wipe action
- [ ] Add threat model notes in docs

## 8) UX (Keep It Simple)

- [ ] Keyboard shortcuts: new note, save, search
- [ ] Fast search by title/content
- [ ] Mobile-friendly responsive layout
- [ ] Light/dark theme toggle (local preference only)

## 9) Testing and Verification

- [ ] Unit test crypto helpers (key derivation/encrypt/decrypt)
- [ ] Test offline usage and recovery
- [ ] Test sync with network failures/retries
- [ ] Validate no plaintext leaves browser during sync

## 10) Documentation

- [ ] Add `ARCHITECTURE.md` with data flow and trust boundaries
- [ ] Add `SECURITY.md` with crypto decisions and limitations
- [ ] Add quick start instructions in `README.md`

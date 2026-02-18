# Architecture

## Overview

Journal is a browser-only application implemented with vanilla HTML/CSS/JS.
It is local-first and privacy-first:

- notes are edited in plaintext in-memory
- notes are persisted as an encrypted snapshot blob
- sync (optional) exchanges encrypted state only

This repository does not include a backend. Sync is done against a user-configured endpoint that implements `SYNC_PROTOCOL.md`.

## Module Map

- `index.html`: static shell, settings UI, and CSP definition
- `src/app.js`: app state machine, storage orchestration, markdown rendering, crypto/session lifecycle, sync flows
- `src/crypto.js`: Web Crypto primitives (PBKDF2 + AES-GCM) and base64 encoding helpers
- `src/sync.js`: sync protocol helpers, endpoint validation, and REST adapter
- `SYNC_PROTOCOL.md`: request/response contract for the external sync service

## Core Data Structures

### Note

- `id: string`
- `title: string`
- `content: string`
- `updatedAt: string` (ISO timestamp)
- `deleted: boolean` (tombstone flag)

### Encrypted Notes Record

Persisted encrypted snapshot:

- `version: number`
- `revisionId: string`
- `updatedAt: string`
- `payload: { ivB64, ciphertextB64, cipher }`

The ciphertext decrypts to an array of notes.

### Key Check Record

Passphrase verification payload stored in localStorage:

- `saltB64: string`
- `iterations: number`
- `check: { ivB64, ciphertextB64, cipher }`

`check` decrypts to a fixed sentinel string and proves passphrase correctness.

## Persistence Layout

### Primary store

- IndexedDB database: `journal.notes.db.v1`
- object store: `records`
- record id: `encrypted-notes`

### Fallback store

- localStorage key: `journal.notes.encrypted.v2`

### localStorage metadata keys

- `journal.crypto.key_check.v1`
- `journal.crypto.auto_lock_ms.v1`
- `journal.sync.endpoint.v1`
- `journal.sync.meta.v1`

## Runtime Flow

1. Boot: load key-check, sync config, and auto-lock preference; render locked state unless first-time setup.
2. Unlock/setup: derive session key from passphrase (PBKDF2), verify or create key-check sentinel, and decrypt encrypted notes snapshot into memory.
3. Edit/persist: update selected note, debounce autosave, encrypt full notes snapshot, and persist.
4. Sync: package encrypted local state into protocol request, send to endpoint, then apply server state or keep-both conflict handling.
5. Lock/wipe: clear in-memory key and plaintext notes on lock; wipe removes encrypted notes and local metadata.

## Trust Boundaries

1. Browser runtime boundary: trusted context is the current page JS runtime; untrusted contexts include extensions, compromised browser internals, and hostile local processes.
2. Local persistence boundary: IndexedDB/localStorage are treated as untrusted at-rest stores; confidentiality depends on encryption and passphrase strength.
3. Network/backend boundary: sync endpoint is untrusted for plaintext and receives encrypted state plus metadata only.
4. User/admin boundary: user controls passphrase quality, endpoint choice, and wipe operations.

## Threat Model Notes

### Mitigated

- plaintext is not written to local persistent storage
- raw passphrase is never persisted
- key material is held in memory only while session is unlocked
- preview renderer escapes HTML and sanitizes links
- strict CSP disables inline script execution and risky embedding defaults
- conflict strategy avoids silent overwrite by preserving both variants
- explicit local wipe clears notes plus related metadata

### Not Mitigated / Accepted

- active-session compromise (malicious extension, XSS introduced by future bug, OS malware)
- lost passphrase recovery (none by design)
- hardware-backed key protection (not implemented)
- endpoint authenticity pinning and remote attestation (not implemented)

## CI/Verification Snapshot

- `scripts/validate.sh` enforces syntax checks and unit tests
- CI additionally runs Shellcheck and Actionlint

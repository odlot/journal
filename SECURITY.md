# Security Notes

## Scope

This document describes the implemented security model for this repository and its current limits. It is not a formal security audit.

## Security Goals

- keep note plaintext out of persistent local storage
- keep sync payloads encrypted end-to-end from this app's perspective
- avoid storing raw passphrases
- reduce common browser attack surface in the UI layer

## Crypto Decisions

### KDF and content cipher

- KDF: PBKDF2 (SHA-256)
- default iterations: `310000`
- per-user salt: random 16 bytes
- content cipher: AES-GCM 256
- per-encryption IV: random 12 bytes

These values are implemented in `src/crypto.js`.

### Session key lifecycle

- passphrase is entered interactively and used to derive a non-extractable Web Crypto key
- derived key is held in memory only while unlocked
- lock, auto-lock timeout, and wipe flows clear in-memory key material

### Passphrase verification

- app stores an encrypted sentinel (`journal-key-check-v1`) in localStorage
- successful decryption of that sentinel verifies passphrase correctness
- raw passphrase is never written to storage

## Data at Rest

- notes are persisted as one encrypted snapshot record
- primary storage is IndexedDB with localStorage fallback
- decrypted note content exists only in memory while unlocked

## Sync Security Model

- sync request body includes encrypted note state and encrypted key-check record
- server is expected to store and return encrypted blobs + metadata only
- client validates response shape before applying

Important limitation:

- endpoint validation currently accepts both `https://` and `http://`
- plaintext is still encrypted at payload level, but metadata and traffic pattern are exposed on plain HTTP
- production deployment should use HTTPS-only endpoints

## Browser Hardening

- strict CSP defined in `index.html`
- no inline scripts
- markdown preview escapes HTML and sanitizes links (disallows `javascript:` and non-http/mailto schemes)
- no analytics or third-party tracking scripts in this repository

## Threat Model Summary

### Threats this design addresses

- theft of local storage files without passphrase
- passive sync-backend visibility into note contents
- accidental plaintext persistence by normal app operation

### Threats not fully addressed

- compromised client environment during active unlocked session
- malicious browser extensions, local malware, or developer tools access
- weak user passphrases and brute-force attacks against captured ciphertext
- compromised or malicious sync service behavior beyond protocol validation

## Operational Guidance

- use a strong unique passphrase (long and random)
- prefer HTTPS-only sync endpoints
- lock app when idle and keep auto-lock enabled
- export encrypted backups before risky changes
- use "Wipe Local Data" when deprovisioning a shared or temporary device

## Known Gaps / Future Hardening

- enforce HTTPS-only endpoint validation in sync module
- add automated tests for offline recovery and sync failure retry behavior
- add tests proving no plaintext is sent during sync operations
- consider Argon2 (via compatible browser strategy) as a future KDF upgrade path

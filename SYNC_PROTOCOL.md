# Sync Protocol

This document defines the current sync contract between the journal client and a sync server.

## Goal

- Sync encrypted journal state across devices.
- Never send plaintext note content to the server.

## Transport

- Endpoint: configured in Settings (`Sync endpoint`).
- Method: `POST`
- Content type: `application/json`

## Request

```json
{
  "protocolVersion": 1,
  "action": "sync",
  "client": {
    "deviceId": "string",
    "knownServerRevision": "string|null",
    "localRevision": "string",
    "sentAt": "ISO-8601 timestamp",
    "encryptedState": {
      "keyCheck": {
        "version": 1,
        "saltB64": "string",
        "iterations": 310000,
        "check": {
          "ivB64": "string",
          "ciphertextB64": "string"
        }
      },
      "encryptedNotes": {
        "version": 1,
        "revisionId": "string",
        "updatedAt": "ISO-8601 timestamp",
        "payload": {
          "ivB64": "string",
          "ciphertextB64": "string",
          "cipher": "AES-GCM"
        }
      }
    }
  }
}
```

## Response

```json
{
  "protocolVersion": 1,
  "serverRevision": "string|null",
  "serverEncryptedState": {
    "keyCheck": {},
    "encryptedNotes": {}
  },
  "conflict": {
    "type": "string"
  }
}
```

`serverEncryptedState` may be `null` if there is no server-side update to apply.

## Server behavior expectations

- Treat `encryptedState` as opaque ciphertext-bearing data.
- Return the current canonical server state in `serverEncryptedState` when the client should update local state.
- Include `conflict` metadata when divergent revisions are detected.

## Client behavior expectations

- Push latest local encrypted state before sync if unlocked.
- Apply `serverEncryptedState` when `encryptedNotes.revisionId` differs from local revision.
- Persist `serverRevision` as `knownServerRevision`.
- Surface conflict metadata in UI status.

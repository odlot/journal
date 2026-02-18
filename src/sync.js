"use strict";

(function initJournalSync(global) {
  const PROTOCOL_VERSION = 1;

  function isObject(value) {
    return Boolean(value) && typeof value === "object";
  }

  function isValidEndpoint(endpoint) {
    try {
      const url = new URL(endpoint);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }

  function isValidEncryptedState(state, validators = {}) {
    const { isValidKeyCheckRecord, isValidEncryptedNotesRecord } = validators;
    if (
      typeof isValidKeyCheckRecord !== "function" ||
      typeof isValidEncryptedNotesRecord !== "function"
    ) {
      return false;
    }
    return (
      isObject(state) &&
      isValidKeyCheckRecord(state.keyCheck) &&
      isValidEncryptedNotesRecord(state.encryptedNotes)
    );
  }

  function isValidResponsePayload(payload, validators = {}) {
    return (
      isObject(payload) &&
      payload.protocolVersion === PROTOCOL_VERSION &&
      (payload.serverRevision === null || typeof payload.serverRevision === "string") &&
      (payload.serverEncryptedState === null ||
        isValidEncryptedState(payload.serverEncryptedState, validators)) &&
      (payload.conflict === null ||
        payload.conflict === undefined ||
        typeof payload.conflict === "object")
    );
  }

  function buildSyncRequest(clientPayload) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      action: "sync",
      client: clientPayload,
    };
  }

  function createRestAdapter({ endpoint, parseJson = JSON.parse, fetchImpl = fetch, validators = {} }) {
    return {
      async sync(payload) {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Sync request failed (${response.status})`);
        }

        const rawBody = await response.text();
        let parsed = null;
        try {
          parsed = parseJson(rawBody);
        } catch {
          parsed = null;
        }

        if (!isValidResponsePayload(parsed, validators)) {
          throw new Error("Invalid sync response");
        }
        return parsed;
      },
    };
  }

  global.JournalSync = Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    isValidEndpoint,
    isValidEncryptedState,
    isValidResponsePayload,
    buildSyncRequest,
    createRestAdapter,
  });
})(window);

"use strict";

(function initJournalSync(global) {
  const PROTOCOL_VERSION = 1;
  const REQUEST_KEYS = Object.freeze(["protocolVersion", "action", "client"]);
  const CLIENT_KEYS = Object.freeze([
    "deviceId",
    "knownServerRevision",
    "localRevision",
    "sentAt",
    "encryptedState",
  ]);
  const ENCRYPTED_STATE_KEYS = Object.freeze(["keyCheck", "encryptedNotes"]);
  const KEY_CHECK_KEYS = Object.freeze(["version", "saltB64", "iterations", "check"]);
  const ENCRYPTED_NOTES_KEYS = Object.freeze(["version", "revisionId", "updatedAt", "payload"]);
  const ENCRYPTED_BLOB_KEYS = Object.freeze(["ivB64", "ciphertextB64", "cipher"]);
  const RETRYABLE_STATUS_CODES = Object.freeze(new Set([408, 425, 429, 500, 502, 503, 504]));

  function isObject(value) {
    return Boolean(value) && typeof value === "object";
  }

  function isNonEmptyString(value) {
    return typeof value === "string" && value.length > 0;
  }

  function hasOnlyKeys(value, allowedKeys) {
    if (!isObject(value)) {
      return false;
    }
    return Object.keys(value).every((key) => allowedKeys.includes(key));
  }

  function isValidEncryptedBlob(record) {
    return (
      isObject(record) &&
      hasOnlyKeys(record, ENCRYPTED_BLOB_KEYS) &&
      isNonEmptyString(record.ivB64) &&
      isNonEmptyString(record.ciphertextB64) &&
      (record.cipher === undefined || typeof record.cipher === "string")
    );
  }

  function isValidDefaultKeyCheckRecord(record) {
    return (
      isObject(record) &&
      hasOnlyKeys(record, KEY_CHECK_KEYS) &&
      Number.isInteger(record.version) &&
      isNonEmptyString(record.saltB64) &&
      Number.isInteger(record.iterations) &&
      record.iterations > 0 &&
      isValidEncryptedBlob(record.check)
    );
  }

  function isValidDefaultEncryptedNotesRecord(record) {
    return (
      isObject(record) &&
      hasOnlyKeys(record, ENCRYPTED_NOTES_KEYS) &&
      Number.isInteger(record.version) &&
      isNonEmptyString(record.revisionId) &&
      isNonEmptyString(record.updatedAt) &&
      isValidEncryptedBlob(record.payload)
    );
  }

  function isValidDefaultEncryptedState(state) {
    return (
      isObject(state) &&
      hasOnlyKeys(state, ENCRYPTED_STATE_KEYS) &&
      isValidDefaultKeyCheckRecord(state.keyCheck) &&
      isValidDefaultEncryptedNotesRecord(state.encryptedNotes)
    );
  }

  function isValidEndpoint(endpoint) {
    try {
      const url = new URL(endpoint);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }

  function normalizeRetryConfig(retry) {
    if (!isObject(retry)) {
      return Object.freeze({
        maxRetries: 0,
        retryOnNetworkError: true,
        delayMs: 200,
        backoffFactor: 2,
      });
    }

    const maxRetries = Number.isInteger(retry.maxRetries) && retry.maxRetries >= 0
      ? retry.maxRetries
      : 0;
    const delayMs = Number.isFinite(retry.delayMs) && retry.delayMs >= 0
      ? Number(retry.delayMs)
      : 200;
    const backoffFactor = Number.isFinite(retry.backoffFactor) && retry.backoffFactor >= 1
      ? Number(retry.backoffFactor)
      : 2;

    return Object.freeze({
      maxRetries,
      retryOnNetworkError: retry.retryOnNetworkError !== false,
      delayMs,
      backoffFactor,
    });
  }

  function retryDelayMsForAttempt(attemptNumber, retryConfig) {
    return Math.round(
      retryConfig.delayMs * Math.pow(retryConfig.backoffFactor, Math.max(0, attemptNumber - 1))
    );
  }

  function shouldRetryStatus(status) {
    return RETRYABLE_STATUS_CODES.has(status);
  }

  async function sleep(ms, sleepImpl) {
    if (ms <= 0) {
      return;
    }
    await sleepImpl(ms);
  }

  function isValidEncryptedState(state, validators = {}) {
    const normalizedValidators = isObject(validators) ? validators : {};
    const { isValidKeyCheckRecord, isValidEncryptedNotesRecord } = normalizedValidators;
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

  function isValidClientPayload(clientPayload, validators = {}) {
    const normalizedValidators = isObject(validators) ? validators : {};
    if (!isObject(clientPayload) || !hasOnlyKeys(clientPayload, CLIENT_KEYS)) {
      return false;
    }

    if (
      !isNonEmptyString(clientPayload.deviceId) ||
      !isNonEmptyString(clientPayload.localRevision) ||
      !isNonEmptyString(clientPayload.sentAt) ||
      !(
        clientPayload.knownServerRevision === null ||
        typeof clientPayload.knownServerRevision === "string"
      )
    ) {
      return false;
    }

    const hasCustomEncryptedStateValidators =
      typeof normalizedValidators.isValidKeyCheckRecord === "function" &&
      typeof normalizedValidators.isValidEncryptedNotesRecord === "function";

    if (!hasOnlyKeys(clientPayload.encryptedState, ENCRYPTED_STATE_KEYS)) {
      return false;
    }

    if (hasCustomEncryptedStateValidators) {
      return isValidEncryptedState(clientPayload.encryptedState, normalizedValidators);
    }
    return isValidDefaultEncryptedState(clientPayload.encryptedState);
  }

  function isValidRequestPayload(payload, validators = {}) {
    const normalizedValidators = isObject(validators) ? validators : {};
    return (
      isObject(payload) &&
      hasOnlyKeys(payload, REQUEST_KEYS) &&
      payload.protocolVersion === PROTOCOL_VERSION &&
      payload.action === "sync" &&
      isValidClientPayload(payload.client, normalizedValidators)
    );
  }

  function isValidResponsePayload(payload, validators = {}) {
    const normalizedValidators = isObject(validators) ? validators : {};
    return (
      isObject(payload) &&
      payload.protocolVersion === PROTOCOL_VERSION &&
      (payload.serverRevision === null || typeof payload.serverRevision === "string") &&
      (payload.serverEncryptedState === null ||
        isValidEncryptedState(payload.serverEncryptedState, normalizedValidators)) &&
      (payload.conflict === null ||
        payload.conflict === undefined ||
        typeof payload.conflict === "object")
    );
  }

  function buildSyncRequest(clientPayload, options = {}) {
    const validators =
      isObject(options) && isObject(options.validators) ? options.validators : {};
    if (!isValidClientPayload(clientPayload, validators)) {
      throw new Error("Invalid sync request payload");
    }

    return {
      protocolVersion: PROTOCOL_VERSION,
      action: "sync",
      client: clientPayload,
    };
  }

  function createRestAdapter({
    endpoint,
    parseJson = JSON.parse,
    fetchImpl = fetch,
    validators = {},
    retry = {},
    sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }) {
    const normalizedValidators = isObject(validators) ? validators : {};
    const retryConfig = normalizeRetryConfig(retry);
    const maxAttempts = retryConfig.maxRetries + 1;

    return {
      async sync(payload) {
        if (!isValidRequestPayload(payload, normalizedValidators)) {
          throw new Error("Invalid sync request");
        }

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          let response = null;

          try {
            response = await fetchImpl(endpoint, {
              method: "POST",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify(payload),
            });
          } catch (error) {
            const shouldRetry =
              retryConfig.retryOnNetworkError && attempt < maxAttempts;
            if (!shouldRetry) {
              throw error;
            }
            await sleep(retryDelayMsForAttempt(attempt, retryConfig), sleepImpl);
            continue;
          }

          if (!response.ok) {
            const shouldRetry = shouldRetryStatus(response.status) && attempt < maxAttempts;
            if (shouldRetry) {
              await sleep(retryDelayMsForAttempt(attempt, retryConfig), sleepImpl);
              continue;
            }
            throw new Error(`Sync request failed (${response.status})`);
          }

          const rawBody = await response.text();
          let parsed = null;
          try {
            parsed = parseJson(rawBody);
          } catch {
            parsed = null;
          }

          if (!isValidResponsePayload(parsed, normalizedValidators)) {
            throw new Error("Invalid sync response");
          }
          return parsed;
        }
      },
    };
  }

  global.JournalSync = Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    isValidEndpoint,
    isValidEncryptedState,
    isValidClientPayload,
    isValidRequestPayload,
    isValidResponsePayload,
    buildSyncRequest,
    createRestAdapter,
  });
})(window);

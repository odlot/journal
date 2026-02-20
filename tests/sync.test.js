"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createBrowserLikeContext, loadBrowserScript } = require("./helpers/browser-module");

function createEncryptedBlob() {
  return {
    ivB64: "aXY=",
    ciphertextB64: "Y2lwaGVydGV4dA==",
    cipher: "AES-GCM",
  };
}

function createValidEncryptedState() {
  return {
    keyCheck: {
      version: 1,
      saltB64: "c2FsdA==",
      iterations: 310000,
      check: createEncryptedBlob(),
    },
    encryptedNotes: {
      version: 1,
      revisionId: "rev-local-1",
      updatedAt: "2026-02-18T20:00:00.000Z",
      payload: createEncryptedBlob(),
    },
  };
}

function createValidClientPayload() {
  return {
    deviceId: "device-1",
    knownServerRevision: null,
    localRevision: "rev-local-1",
    sentAt: "2026-02-18T20:00:00.000Z",
    encryptedState: createValidEncryptedState(),
  };
}

function createValidators() {
  return {
    isValidKeyCheckRecord: (value) =>
      Boolean(
        value &&
          typeof value === "object" &&
          Number.isInteger(value.version) &&
          typeof value.saltB64 === "string" &&
          Number.isInteger(value.iterations) &&
          value.check &&
          typeof value.check.ivB64 === "string" &&
          typeof value.check.ciphertextB64 === "string"
      ),
    isValidEncryptedNotesRecord: (value) =>
      Boolean(
        value &&
          typeof value === "object" &&
          Number.isInteger(value.version) &&
          typeof value.revisionId === "string" &&
          typeof value.updatedAt === "string" &&
          value.payload &&
          typeof value.payload.ivB64 === "string" &&
          typeof value.payload.ciphertextB64 === "string"
      ),
  };
}

function createValidResponse() {
  return {
    protocolVersion: 1,
    serverRevision: "rev-2",
    serverEncryptedState: createValidEncryptedState(),
    conflict: null,
  };
}

test("sync module exposes expected API", async () => {
  const context = loadBrowserScript("src/sync.js");
  const api = context.JournalSync;

  assert.ok(api);
  assert.equal(api.protocolVersion, 1);
  assert.equal(typeof api.isValidEndpoint, "function");
  assert.equal(typeof api.isValidRequestPayload, "function");
  assert.equal(typeof api.buildSyncRequest, "function");
  assert.equal(typeof api.createRestAdapter, "function");
});

test("isValidEndpoint accepts http/https and rejects others", async () => {
  const context = loadBrowserScript("src/sync.js");
  const api = context.JournalSync;

  assert.equal(api.isValidEndpoint("https://example.com/api/sync"), true);
  assert.equal(api.isValidEndpoint("http://localhost:3000/sync"), true);
  assert.equal(api.isValidEndpoint("ftp://example.com"), false);
  assert.equal(api.isValidEndpoint("not-a-url"), false);
});

test("buildSyncRequest wraps encrypted client payload with protocol metadata", async () => {
  const context = loadBrowserScript("src/sync.js");
  const api = context.JournalSync;

  const request = api.buildSyncRequest(createValidClientPayload());
  assert.equal(request.protocolVersion, 1);
  assert.equal(request.action, "sync");
  assert.equal(request.client.deviceId, "device-1");
  assert.equal(request.client.encryptedState.encryptedNotes.revisionId, "rev-local-1");
});

test("buildSyncRequest rejects plaintext-shaped client payloads", async () => {
  const context = loadBrowserScript("src/sync.js");
  const api = context.JournalSync;

  const invalidClientPayload = createValidClientPayload();
  invalidClientPayload.notes = [{ title: "Draft", content: "secret body" }];

  assert.throws(
    () => api.buildSyncRequest(invalidClientPayload),
    /invalid sync request payload/i
  );
});

test("isValidResponsePayload validates payload using supplied validators", async () => {
  const context = loadBrowserScript("src/sync.js");
  const api = context.JournalSync;
  const validators = createValidators();

  assert.equal(api.isValidResponsePayload(createValidResponse(), validators), true);

  const invalid = createValidResponse();
  invalid.serverEncryptedState.keyCheck = { wrong: true };
  assert.equal(api.isValidResponsePayload(invalid, validators), false);
});

test("createRestAdapter returns parsed validated response", async () => {
  const context = createBrowserLikeContext();
  loadBrowserScript("src/sync.js", context);
  const api = context.JournalSync;
  const validators = createValidators();

  const adapter = api.createRestAdapter({
    endpoint: "https://example.com/api/sync",
    validators,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(createValidResponse()),
    }),
  });

  const payload = await adapter.sync(api.buildSyncRequest(createValidClientPayload()));
  assert.equal(payload.serverRevision, "rev-2");
});

test("createRestAdapter rejects non-OK and invalid responses", async () => {
  const context = createBrowserLikeContext();
  loadBrowserScript("src/sync.js", context);
  const api = context.JournalSync;
  const validators = createValidators();
  const request = api.buildSyncRequest(createValidClientPayload());

  const failingAdapter = api.createRestAdapter({
    endpoint: "https://example.com/api/sync",
    validators,
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      text: async () => "",
    }),
  });
  await assert.rejects(() => failingAdapter.sync(request), /sync request failed/i);

  const invalidAdapter = api.createRestAdapter({
    endpoint: "https://example.com/api/sync",
    validators,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () =>
        '{"protocolVersion":1,"serverRevision":null,"serverEncryptedState":{"keyCheck":{"wrong":true},"encryptedNotes":{"version":1,"revisionId":"x","updatedAt":"2026-02-18T20:00:00.000Z","payload":{"ivB64":"aXY=","ciphertextB64":"Y2lwaGVydGV4dA=="}}}}',
    }),
  });
  await assert.rejects(() => invalidAdapter.sync(request), /invalid sync response/i);
});

test("sync request body never includes note plaintext", async () => {
  const context = createBrowserLikeContext();
  loadBrowserScript("src/crypto.js", context);
  loadBrowserScript("src/sync.js", context);
  const cryptoApi = context.JournalCrypto;
  const syncApi = context.JournalSync;
  const validators = createValidators();
  const plaintextSentinel = "__SYNC_PLAINTEXT_SENTINEL::do-not-leak__";

  const derived = await cryptoApi.deriveSessionKey("correct horse battery staple", { iterations: 5000 });
  const encryptedNotesPayload = await cryptoApi.encryptString(
    JSON.stringify([
      {
        id: "note-1",
        title: "Private title",
        content: plaintextSentinel,
        updatedAt: "2026-02-18T20:00:00.000Z",
        deleted: false,
      },
    ]),
    derived.key
  );
  const checkPayload = await cryptoApi.encryptString("journal-key-check-v1", derived.key);

  const request = syncApi.buildSyncRequest({
    deviceId: "device-plain-check",
    knownServerRevision: null,
    localRevision: "rev-plain-check",
    sentAt: "2026-02-18T20:00:00.000Z",
    encryptedState: {
      keyCheck: {
        version: 1,
        saltB64: derived.params.saltB64,
        iterations: derived.params.iterations,
        check: checkPayload,
      },
      encryptedNotes: {
        version: 1,
        revisionId: "rev-plain-check",
        updatedAt: "2026-02-18T20:00:00.000Z",
        payload: encryptedNotesPayload,
      },
    },
  });

  let capturedBody = "";
  const adapter = syncApi.createRestAdapter({
    endpoint: "https://example.com/api/sync",
    validators,
    fetchImpl: async (_endpoint, requestOptions) => {
      capturedBody = String(requestOptions.body || "");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(createValidResponse()),
      };
    },
  });

  await adapter.sync(request);

  assert.equal(capturedBody.includes(plaintextSentinel), false);
  assert.equal(/"title"\s*:/.test(capturedBody), false);
  assert.equal(/"content"\s*:/.test(capturedBody), false);
});

test("createRestAdapter rejects outgoing requests that include plaintext fields", async () => {
  const context = createBrowserLikeContext();
  loadBrowserScript("src/sync.js", context);
  const api = context.JournalSync;
  const validators = createValidators();

  const requestWithPlaintextFields = {
    protocolVersion: 1,
    action: "sync",
    client: {
      ...createValidClientPayload(),
      notes: [{ title: "Draft", content: "secret body" }],
    },
  };

  const adapter = api.createRestAdapter({
    endpoint: "https://example.com/api/sync",
    validators,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(createValidResponse()),
    }),
  });

  await assert.rejects(() => adapter.sync(requestWithPlaintextFields), /invalid sync request/i);
});

test("createRestAdapter retries transient HTTP failures and then succeeds", async () => {
  const context = createBrowserLikeContext();
  loadBrowserScript("src/sync.js", context);
  const api = context.JournalSync;
  const validators = createValidators();
  const request = api.buildSyncRequest(createValidClientPayload());
  let attemptCount = 0;
  const sleepCalls = [];

  const adapter = api.createRestAdapter({
    endpoint: "https://example.com/api/sync",
    validators,
    retry: { maxRetries: 2, delayMs: 10, backoffFactor: 2 },
    sleepImpl: async (ms) => {
      sleepCalls.push(ms);
    },
    fetchImpl: async () => {
      attemptCount += 1;
      if (attemptCount < 3) {
        return {
          ok: false,
          status: 503,
          text: async () => "",
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(createValidResponse()),
      };
    },
  });

  const response = await adapter.sync(request);
  assert.equal(response.serverRevision, "rev-2");
  assert.equal(attemptCount, 3);
  assert.deepEqual(sleepCalls, [10, 20]);
});

test("createRestAdapter retries network failures when enabled", async () => {
  const context = createBrowserLikeContext();
  loadBrowserScript("src/sync.js", context);
  const api = context.JournalSync;
  const validators = createValidators();
  const request = api.buildSyncRequest(createValidClientPayload());
  let attemptCount = 0;

  const adapter = api.createRestAdapter({
    endpoint: "https://example.com/api/sync",
    validators,
    retry: { maxRetries: 1, delayMs: 0, retryOnNetworkError: true },
    fetchImpl: async () => {
      attemptCount += 1;
      if (attemptCount === 1) {
        throw new Error("network down");
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(createValidResponse()),
      };
    },
  });

  const response = await adapter.sync(request);
  assert.equal(response.serverRevision, "rev-2");
  assert.equal(attemptCount, 2);
});

test("createRestAdapter does not retry non-retryable HTTP status", async () => {
  const context = createBrowserLikeContext();
  loadBrowserScript("src/sync.js", context);
  const api = context.JournalSync;
  const validators = createValidators();
  const request = api.buildSyncRequest(createValidClientPayload());
  let attemptCount = 0;

  const adapter = api.createRestAdapter({
    endpoint: "https://example.com/api/sync",
    validators,
    retry: { maxRetries: 3, delayMs: 0 },
    fetchImpl: async () => {
      attemptCount += 1;
      return {
        ok: false,
        status: 400,
        text: async () => "",
      };
    },
  });

  await assert.rejects(() => adapter.sync(request), /sync request failed \(400\)/i);
  assert.equal(attemptCount, 1);
});

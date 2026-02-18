"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createBrowserLikeContext, loadBrowserScript } = require("./helpers/browser-module");

function createValidators() {
  return {
    isValidKeyCheckRecord: (value) => Boolean(value && typeof value === "object" && value.kind === "key"),
    isValidEncryptedNotesRecord: (value) =>
      Boolean(value && typeof value === "object" && value.kind === "notes"),
  };
}

function createValidResponse() {
  return {
    protocolVersion: 1,
    serverRevision: "rev-2",
    serverEncryptedState: {
      keyCheck: { kind: "key" },
      encryptedNotes: { kind: "notes" },
    },
    conflict: null,
  };
}

test("sync module exposes expected API", async () => {
  const context = loadBrowserScript("src/sync.js");
  const api = context.JournalSync;

  assert.ok(api);
  assert.equal(api.protocolVersion, 1);
  assert.equal(typeof api.isValidEndpoint, "function");
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

test("buildSyncRequest wraps client payload with protocol metadata", async () => {
  const context = loadBrowserScript("src/sync.js");
  const api = context.JournalSync;

  const request = api.buildSyncRequest({ deviceId: "device-1" });
  assert.equal(request.protocolVersion, 1);
  assert.equal(request.action, "sync");
  assert.equal(request.client.deviceId, "device-1");
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

  const payload = await adapter.sync({ any: "request" });
  assert.equal(payload.serverRevision, "rev-2");
});

test("createRestAdapter rejects non-OK and invalid responses", async () => {
  const context = createBrowserLikeContext();
  loadBrowserScript("src/sync.js", context);
  const api = context.JournalSync;
  const validators = createValidators();

  const failingAdapter = api.createRestAdapter({
    endpoint: "https://example.com/api/sync",
    validators,
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      text: async () => "",
    }),
  });
  await assert.rejects(() => failingAdapter.sync({}), /sync request failed/i);

  const invalidAdapter = api.createRestAdapter({
    endpoint: "https://example.com/api/sync",
    validators,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => '{"protocolVersion":1,"serverRevision":null,"serverEncryptedState":{"keyCheck":{"wrong":true},"encryptedNotes":{"kind":"notes"}}}',
    }),
  });
  await assert.rejects(() => invalidAdapter.sync({}), /invalid sync response/i);
});

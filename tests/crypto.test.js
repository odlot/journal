"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { loadBrowserScript } = require("./helpers/browser-module");

test("crypto module exposes expected API", async () => {
  const context = loadBrowserScript("src/crypto.js");
  const api = context.JournalCrypto;

  assert.ok(api);
  assert.equal(typeof api.deriveSessionKey, "function");
  assert.equal(typeof api.encryptString, "function");
  assert.equal(typeof api.decryptString, "function");
});

test("deriveSessionKey rejects short passphrase", async () => {
  const context = loadBrowserScript("src/crypto.js");
  await assert.rejects(
    () => context.JournalCrypto.deriveSessionKey("short"),
    /at least 8 characters/i
  );
});

test("encryptString/decryptString roundtrip", async () => {
  const context = loadBrowserScript("src/crypto.js");
  const api = context.JournalCrypto;
  const derived = await api.deriveSessionKey("correct horse battery staple", { iterations: 5000 });

  const payload = await api.encryptString("journal secret", derived.key);
  const plaintext = await api.decryptString(payload, derived.key);
  assert.equal(plaintext, "journal secret");
});

test("key derivation with same salt+iterations yields compatible key", async () => {
  const context = loadBrowserScript("src/crypto.js");
  const api = context.JournalCrypto;

  const first = await api.deriveSessionKey("same-passphrase", { iterations: 4000 });
  const second = await api.deriveSessionKey("same-passphrase", {
    iterations: first.params.iterations,
    saltB64: first.params.saltB64,
  });

  const payload = await api.encryptString("compatibility check", first.key);
  const decrypted = await api.decryptString(payload, second.key);
  assert.equal(decrypted, "compatibility check");
});

test("decryptString rejects invalid payload", async () => {
  const context = loadBrowserScript("src/crypto.js");
  const api = context.JournalCrypto;
  const derived = await api.deriveSessionKey("valid-passphrase", { iterations: 3000 });

  await assert.rejects(
    () => api.decryptString(null, derived.key),
    /invalid encrypted payload/i
  );
});

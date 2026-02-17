"use strict";

(function initJournalCrypto(global) {
  const DEFAULT_ITERATIONS = 310000;
  const DEFAULT_SALT_BYTES = 16;
  const DEFAULT_IV_BYTES = 12;
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  function base64ToBytes(base64Value) {
    const binary = atob(base64Value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function deriveSessionKey(passphrase, options = {}) {
    if (typeof passphrase !== "string" || passphrase.length < 8) {
      throw new Error("Passphrase must be at least 8 characters.");
    }

    const iterations = Number.isInteger(options.iterations)
      ? options.iterations
      : DEFAULT_ITERATIONS;
    const salt = options.saltB64
      ? base64ToBytes(options.saltB64)
      : crypto.getRandomValues(new Uint8Array(DEFAULT_SALT_BYTES));

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      textEncoder.encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );

    return {
      key,
      params: {
        kdf: "PBKDF2",
        hash: "SHA-256",
        cipher: "AES-GCM",
        iterations,
        saltB64: bytesToBase64(salt),
      },
    };
  }

  async function encryptString(plaintext, key) {
    const iv = crypto.getRandomValues(new Uint8Array(DEFAULT_IV_BYTES));
    const encoded = textEncoder.encode(String(plaintext));
    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded
    );
    return {
      ivB64: bytesToBase64(iv),
      ciphertextB64: bytesToBase64(new Uint8Array(ciphertextBuffer)),
      cipher: "AES-GCM",
    };
  }

  async function decryptString(payload, key) {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid encrypted payload.");
    }
    const iv = base64ToBytes(String(payload.ivB64 || ""));
    const ciphertext = base64ToBytes(String(payload.ciphertextB64 || ""));
    const plaintextBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    return textDecoder.decode(plaintextBuffer);
  }

  global.JournalCrypto = Object.freeze({
    defaults: Object.freeze({
      iterations: DEFAULT_ITERATIONS,
      saltBytes: DEFAULT_SALT_BYTES,
      ivBytes: DEFAULT_IV_BYTES,
    }),
    bytesToBase64,
    base64ToBytes,
    deriveSessionKey,
    encryptString,
    decryptString,
  });
})(window);

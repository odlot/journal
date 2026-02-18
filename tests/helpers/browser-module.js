"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

function toBase64(input) {
  return Buffer.from(input, "binary").toString("base64");
}

function fromBase64(input) {
  return Buffer.from(input, "base64").toString("binary");
}

function createBrowserLikeContext() {
  const context = {
    console,
    window: {},
    TextEncoder,
    TextDecoder,
    crypto: webcrypto,
    URL,
    fetch: async () => {
      throw new Error("Unexpected fetch call in test context.");
    },
    setTimeout,
    clearTimeout,
    btoa: (value) => toBase64(String(value)),
    atob: (value) => fromBase64(String(value)),
  };
  context.window = context;
  return vm.createContext(context);
}

function loadBrowserScript(relativePath, existingContext) {
  const context = existingContext || createBrowserLikeContext();
  const filePath = path.join(__dirname, "..", "..", relativePath);
  const source = fs.readFileSync(filePath, "utf8");
  const script = new vm.Script(source, { filename: filePath });
  script.runInContext(context);
  return context;
}

module.exports = {
  createBrowserLikeContext,
  loadBrowserScript,
};

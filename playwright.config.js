"use strict";

const { defineConfig, devices } = require("@playwright/test");

const rawPort = Number.parseInt(process.env.PLAYWRIGHT_PORT || "4173", 10);
const port = Number.isInteger(rawPort) && rawPort > 0 ? rawPort : 4173;
const baseURL = `http://127.0.0.1:${port}`;

module.exports = defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL,
    headless: true,
  },
  webServer: {
    command: `python3 -m http.server ${port} --bind 127.0.0.1`,
    url: `${baseURL}/index.html`,
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});

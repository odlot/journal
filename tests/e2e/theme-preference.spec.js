"use strict";

const { test, expect } = require("@playwright/test");

const PASSPHRASE = "correct horse battery staple";

async function ensureSettingsOpen(page) {
  const settingsView = page.locator("#settings-view");
  if ((await settingsView.getAttribute("aria-hidden")) === "true") {
    const overlayTrigger = page.locator("#open-settings-overlay-btn");
    if (await overlayTrigger.isVisible()) {
      await overlayTrigger.click();
    } else {
      await page.click("#open-settings-btn");
    }
  }
  await expect(settingsView).toHaveAttribute("aria-hidden", "false");
}

async function unlockSession(page) {
  await ensureSettingsOpen(page);
  await page.fill("#passphrase-input", PASSPHRASE);
  if (await page.locator("#setup-confirm-wrap").isVisible()) {
    await page.fill("#passphrase-confirm-input", PASSPHRASE);
  }
  await page.click("#unlock-btn");
  await expect(page.locator("#crypto-status")).toHaveText("Unlocked");
}

async function closeSettings(page) {
  if ((await page.locator("#settings-view").getAttribute("aria-hidden")) === "false") {
    await page.click("#close-settings-btn");
  }
  await expect(page.locator("#settings-view")).toHaveAttribute("aria-hidden", "true");
}

test("theme preference persists between sessions", async ({ page }) => {
  await page.goto("/index.html");
  await unlockSession(page);

  await page.selectOption("#theme-select", "dark");
  await expect(page.locator("body")).toHaveClass(/theme-dark/);
  await closeSettings(page);

  await page.reload();
  await expect(page.locator("body")).toHaveClass(/theme-dark/);

  await unlockSession(page);
  await expect(page.locator("#theme-select")).toHaveValue("dark");
  await page.selectOption("#theme-select", "light");
  await expect(page.locator("body")).not.toHaveClass(/theme-dark/);
  await closeSettings(page);

  await page.reload();
  await expect(page.locator("body")).not.toHaveClass(/theme-dark/);
});

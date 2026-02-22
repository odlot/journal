"use strict";

const { test, expect } = require("@playwright/test");

const PASSPHRASE = "correct horse battery staple";

async function waitForAutosave() {
  await new Promise((resolve) => setTimeout(resolve, 450));
}

async function ensureSettingsOpen(page) {
  const settingsView = page.locator("#settings-view");
  const isHidden = (await settingsView.getAttribute("aria-hidden")) === "true";
  if (isHidden) {
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

test("history diff panel and time travel mode work for note revisions", async ({ page }) => {
  await page.goto("/index.html");
  await unlockSession(page);
  await closeSettings(page);

  await page.fill("#note-title-input", "Time Travel Note");
  await page.fill("#note-content-input", "version one");
  await waitForAutosave();
  await page.fill("#note-content-input", "version two");
  await waitForAutosave();

  await page.click("#open-history-btn");
  await expect(page.locator("#history-view")).toHaveAttribute("aria-hidden", "false");

  await page.locator("button[data-history-select-commit-id]").first().click();
  await expect(page.locator("#history-diff-output")).toContainText("Content diff:");
  await expect(page.locator("#history-diff-output")).toContainText("+ version two");

  await page.locator("button[data-history-travel-commit-id]").nth(1).click();
  await expect(page.locator("#history-view")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#exit-time-travel-btn")).toBeVisible();
  await expect(page.locator("#time-travel-badge")).toContainText("Viewing");
  await expect(page.locator("#note-content-input")).toHaveValue("version one");
  await expect(page.locator("#note-content-input")).toBeDisabled();

  await page.click("#exit-time-travel-btn");
  await expect(page.locator("#exit-time-travel-btn")).toBeHidden();
  await expect(page.locator("#note-content-input")).toBeEnabled();
  await expect(page.locator("#note-content-input")).toHaveValue("version two");
});

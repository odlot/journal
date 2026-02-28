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

async function updateSelectedNote(page, { title, tags, content }) {
  await page.fill("#note-title-input", title);
  await page.fill("#note-tags-input", tags);
  await page.fill("#note-content-input", content);
  await waitForAutosave();
}

test("search filters and organization controls work for tags and pinned notes", async ({ page }) => {
  await page.goto("/index.html");
  await unlockSession(page);
  await closeSettings(page);

  await updateSelectedNote(page, {
    title: "Work Plan",
    tags: "work, urgent",
    content: "alpha content",
  });
  await page.click("#toggle-pin-btn");

  await page.click("#new-note-btn");
  await updateSelectedNote(page, {
    title: "Home Task",
    tags: "home",
    content: "beta content",
  });

  await expect(page.locator("#note-list button").first()).toContainText("Work Plan");

  await page.fill("#search-input", "tag:home");
  await expect(page.locator("#note-list button")).toHaveCount(1);
  await expect(page.locator("#note-list button").first()).toContainText("Home Task");

  await page.fill("#search-input", "is:pinned tag:work");
  await expect(page.locator("#note-list button")).toHaveCount(1);
  await expect(page.locator("#note-list button").first()).toContainText("Work Plan");

  await page.fill("#search-input", "updated:1d");
  await expect(page.locator("#note-list button")).toHaveCount(2);
});

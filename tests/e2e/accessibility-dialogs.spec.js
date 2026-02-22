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

async function waitForAutosave() {
  await new Promise((resolve) => setTimeout(resolve, 400));
}

async function createNote(page, title, content) {
  await page.click("#new-note-btn");
  await page.fill("#note-title-input", title);
  await page.fill("#note-content-input", content);
  await waitForAutosave();
}

test("settings dialog traps focus with Tab and Shift+Tab", async ({ page }) => {
  await page.goto("/index.html");
  await unlockSession(page);
  await closeSettings(page);

  await page.click("#open-settings-btn");
  await expect(page.locator("#settings-view")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#settings-card")).toBeVisible();

  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press("Tab");
    const focusInside = await page.evaluate(() => {
      const card = document.getElementById("settings-card");
      return Boolean(card) && card.contains(document.activeElement);
    });
    expect(focusInside).toBe(true);
  }

  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press("Shift+Tab");
    const focusInside = await page.evaluate(() => {
      const card = document.getElementById("settings-card");
      return Boolean(card) && card.contains(document.activeElement);
    });
    expect(focusInside).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(page.locator("#settings-view")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#open-settings-btn")).toBeFocused();
});

test("labels are associated and Escape closes dialogs restoring trigger focus", async ({ page }) => {
  await page.goto("/index.html");
  await unlockSession(page);
  await closeSettings(page);

  const missingLabels = await page.evaluate(() => {
    const ids = [
      "search-input",
      "note-title-input",
      "note-content-input",
      "passphrase-input",
      "auto-lock-select",
      "theme-select",
      "sync-endpoint-input",
    ];
    return ids.filter((id) => !document.querySelector(`label[for="${id}"]`));
  });
  expect(missingLabels).toEqual([]);

  await createNote(page, "Dialog Seed", "seed content");
  await page.click("#delete-note-btn");
  await expect(page.locator("#delete-confirm-view")).toHaveAttribute("aria-hidden", "false");
  await page.keyboard.press("Escape");
  await expect(page.locator("#delete-confirm-view")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#delete-note-btn")).toBeFocused();

  await createNote(page, "Deleted Candidate", "delete me");
  await page.click("#delete-note-btn");
  await page.click("#delete-confirm-confirm-btn");
  await waitForAutosave();

  await page.click("#open-history-btn");
  await expect(page.locator("#history-view")).toHaveAttribute("aria-hidden", "false");
  await page.keyboard.press("Escape");
  await expect(page.locator("#history-view")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#open-history-btn")).toBeFocused();

  await page.click("#open-deleted-notes-btn");
  await expect(page.locator("#deleted-notes-view")).toHaveAttribute("aria-hidden", "false");
  await page.keyboard.press("Escape");
  await expect(page.locator("#deleted-notes-view")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#open-deleted-notes-btn")).toBeFocused();
});

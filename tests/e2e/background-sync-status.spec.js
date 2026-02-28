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

test("queued background sync runs automatically and updates status center", async ({ page }) => {
  const syncBodies = [];

  await page.route("**/mock-sync-auto", async (route) => {
    syncBodies.push(route.request().postData() || "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        protocolVersion: 1,
        serverRevision: `server-${syncBodies.length}`,
        serverEncryptedState: null,
        conflict: null,
      }),
    });
  });

  await page.goto("/index.html");
  const appOrigin = new URL(page.url()).origin;
  await unlockSession(page);
  await page.fill("#sync-endpoint-input", `${appOrigin}/mock-sync-auto`);
  await closeSettings(page);

  await page.fill("#note-title-input", "Auto Sync Note");
  await page.fill("#note-content-input", "queued background sync payload");
  await waitForAutosave();

  await expect.poll(() => syncBodies.length, { timeout: 10000 }).toBeGreaterThan(0);
  await expect(syncBodies[0]).toContain("\"action\":\"sync\"");
  await expect(syncBodies[0]).not.toContain("queued background sync payload");

  await ensureSettingsOpen(page);
  await expect(page.locator("#sync-queue-status")).toHaveText("No queued background sync.");
  await expect(page.locator("#sync-events-list")).toContainText("Background sync completed");
});

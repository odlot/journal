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

test("encrypted attachments persist across reload and can be removed", async ({ page }) => {
  await page.goto("/index.html");
  await unlockSession(page);
  await closeSettings(page);

  await page.fill("#note-title-input", "Attachment Note");
  await page.fill("#note-content-input", "Contains encrypted attachment payloads.");
  await waitForAutosave();

  await page.locator("#attach-files-input").setInputFiles([
    {
      name: "receipt.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("super-private-content", "utf8"),
    },
  ]);

  await expect(page.locator("#attachments-status")).toContainText("1 attachment");
  await expect(page.locator("#attachments-list li", { hasText: "receipt.txt" })).toHaveCount(1);
  await expect(page.locator("#note-list .note-meta", { hasText: "1 attachment" }).first()).toBeVisible();
  await waitForAutosave();

  await page.reload();
  await unlockSession(page);
  await closeSettings(page);

  const noteButton = page.locator("#note-list button", { hasText: "Attachment Note" }).first();
  await noteButton.click();
  await expect(page.locator("#attachments-list li", { hasText: "receipt.txt" })).toHaveCount(1);

  await page
    .locator("#attachments-list li", { hasText: "receipt.txt" })
    .locator("button[data-attachment-remove-id]")
    .click();

  await expect(page.locator("#attachments-list li", { hasText: "receipt.txt" })).toHaveCount(0);
  await expect(page.locator("#attachments-status")).toContainText("Attachment removed");
});

"use strict";

const { test, expect } = require("@playwright/test");

const PASSPHRASE = "correct horse battery staple";

async function waitForAutosave() {
  await new Promise((resolve) => setTimeout(resolve, 400));
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

async function createOrUpdateSelectedNote(page, title, content) {
  await page.fill("#note-title-input", title);
  await page.fill("#note-content-input", content);
  await waitForAutosave();
}

async function createNote(page, title, content) {
  await page.click("#new-note-btn");
  await createOrUpdateSelectedNote(page, title, content);
}

async function selectNoteByTitle(page, title) {
  const noteButton = page.locator("#note-list button", { hasText: title }).first();
  await expect(noteButton).toBeVisible();
  await noteButton.click();
  await expect(page.locator("#note-title-input")).toHaveValue(title);
}

async function deleteSelectedNote(page) {
  await page.click("#delete-note-btn");
  await expect(page.locator("#delete-confirm-view")).toHaveAttribute("aria-hidden", "false");
  await page.click("#delete-confirm-confirm-btn");
  await expect(page.locator("#delete-confirm-view")).toHaveAttribute("aria-hidden", "true");
  await waitForAutosave();
}

test("offline create/edit/delete persists after reload recovery", async ({ page }) => {
  await page.goto("/index.html");
  await unlockSession(page);
  await closeSettings(page);

  await page.context().setOffline(true);

  await createOrUpdateSelectedNote(page, "Delete Me Offline", "ephemeral body");
  await createNote(page, "Offline Survivor", "offline-survivor-content");
  await selectNoteByTitle(page, "Delete Me Offline");
  await deleteSelectedNote(page);

  await expect(page.locator("#note-list button", { hasText: "Delete Me Offline" })).toHaveCount(0);

  await page.context().setOffline(false);
  await page.reload();
  await unlockSession(page);
  await closeSettings(page);

  await selectNoteByTitle(page, "Offline Survivor");
  await expect(page.locator("#note-content-input")).toHaveValue("offline-survivor-content");
  await expect(page.locator("#note-list button", { hasText: "Delete Me Offline" })).toHaveCount(0);

  await page.click("#open-deleted-notes-btn");
  await expect(page.locator("#deleted-notes-view")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#deleted-notes-list li", { hasText: "Delete Me Offline" })).toHaveCount(1);
});

test("offline edits recover and sync successfully after reconnect", async ({ page }) => {
  const syncBodies = [];
  let syncEndpointOnline = true;

  await page.route("**/mock-sync-reconnect", async (route) => {
    if (!syncEndpointOnline) {
      await route.abort("internetdisconnected");
      return;
    }
    const rawBody = route.request().postData() || "{}";
    syncBodies.push(rawBody);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        protocolVersion: 1,
        serverRevision: "server-reconnect-1",
        serverEncryptedState: null,
        conflict: null,
      }),
    });
  });

  await page.goto("/index.html");
  const appOrigin = new URL(page.url()).origin;
  await unlockSession(page);
  await closeSettings(page);

  const sentinel = "__OFFLINE_RECONNECT_SECRET__";
  await createOrUpdateSelectedNote(page, "Reconnect Note", sentinel);

  await ensureSettingsOpen(page);
  await page.fill("#sync-endpoint-input", `${appOrigin}/mock-sync-reconnect`);

  syncEndpointOnline = false;
  await page.press("#sync-endpoint-input", "Enter");
  await expect(page.locator("#sync-status")).toHaveClass(/error/);

  syncEndpointOnline = true;
  await page.press("#sync-endpoint-input", "Enter");
  await expect(page.locator("#sync-status")).toContainText("Last synced");

  expect(syncBodies).toHaveLength(1);
  expect(syncBodies[0].includes(sentinel)).toBe(false);
  const parsed = JSON.parse(syncBodies[0]);
  expect(parsed.action).toBe("sync");
  expect(parsed.client).toBeTruthy();
  expect(parsed.client.encryptedState).toBeTruthy();
  expect(parsed.client.notes).toBeUndefined();

  await page.reload();
  await unlockSession(page);
  await closeSettings(page);
  await selectNoteByTitle(page, "Reconnect Note");
  await expect(page.locator("#note-content-input")).toHaveValue(sentinel);
});

test("lock/unlock retains offline edits and restore flows recover note data", async ({ page }) => {
  await page.goto("/index.html");
  await unlockSession(page);
  await closeSettings(page);

  await page.context().setOffline(true);

  await createNote(page, "History Note", "snapshot-one");
  await page.fill("#note-content-input", "snapshot-two");
  await waitForAutosave();
  await createNote(page, "Delete Me Recoverable", "deleted-body");
  await deleteSelectedNote(page);

  await page.context().setOffline(false);

  await ensureSettingsOpen(page);
  await page.click("#lock-btn");
  await expect(page.locator("#crypto-status")).toContainText("Locked");

  await unlockSession(page);
  await closeSettings(page);

  await selectNoteByTitle(page, "History Note");
  await expect(page.locator("#note-content-input")).toHaveValue("snapshot-two");

  await page.click("#open-history-btn");
  const historyItem = page.locator("#history-list li", { hasText: "snapshot-one" }).first();
  await expect(historyItem).toBeVisible();
  await historyItem.locator("button[data-history-commit-id]").click();
  await expect(page.locator("#note-content-input")).toHaveValue("snapshot-one");
  await page.click("#history-close-btn");
  await expect(page.locator("#history-view")).toHaveAttribute("aria-hidden", "true");

  await page.click("#open-deleted-notes-btn");
  const deletedItem = page.locator("#deleted-notes-list li", { hasText: "Delete Me Recoverable" }).first();
  await expect(deletedItem).toBeVisible();
  await deletedItem.locator("button[data-deleted-note-id]").click();
  await expect(page.locator("#note-list button", { hasText: "Delete Me Recoverable" })).toHaveCount(1);
  await page.click("#deleted-notes-close-btn");
  await expect(page.locator("#deleted-notes-view")).toHaveAttribute("aria-hidden", "true");

  await selectNoteByTitle(page, "Delete Me Recoverable");
  await expect(page.locator("#note-content-input")).toHaveValue("deleted-body");

  await page.reload();
  await unlockSession(page);
  await closeSettings(page);

  await selectNoteByTitle(page, "History Note");
  await expect(page.locator("#note-content-input")).toHaveValue("snapshot-one");
  await selectNoteByTitle(page, "Delete Me Recoverable");
  await expect(page.locator("#note-content-input")).toHaveValue("deleted-body");
});

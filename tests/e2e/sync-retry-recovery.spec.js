"use strict";

const { test, expect } = require("@playwright/test");

test("sync retries transient failures and eventually completes", async ({ page }) => {
  let attemptCount = 0;
  const capturedPayloads = [];

  await page.route("**/mock-sync", async (route) => {
    attemptCount += 1;
    const rawBody = route.request().postData() || "{}";
    const parsedBody = JSON.parse(rawBody);
    capturedPayloads.push(parsedBody);

    if (attemptCount < 3) {
      await route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "",
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        protocolVersion: 1,
        serverRevision: "server-rev-1",
        serverEncryptedState: null,
        conflict: null,
      }),
    });
  });

  await page.goto("/index.html");
  const appOrigin = new URL(page.url()).origin;

  await page.fill("#passphrase-input", "correct horse battery staple");
  await page.fill("#passphrase-confirm-input", "correct horse battery staple");
  await page.click("#unlock-btn");
  await expect(page.locator("#crypto-status")).toHaveText("Unlocked");

  await page.fill("#sync-endpoint-input", `${appOrigin}/mock-sync`);
  await expect(page.locator("#sync-now-btn")).toBeEnabled();
  await page.press("#sync-endpoint-input", "Enter");

  await expect(page.locator("#sync-status")).toContainText("Last synced");

  expect(attemptCount).toBe(3);
  expect(capturedPayloads).toHaveLength(3);
  for (const payload of capturedPayloads) {
    expect(payload.action).toBe("sync");
    expect(payload.client).toBeTruthy();
    expect(payload.client.encryptedState).toBeTruthy();
    expect(payload.client.notes).toBeUndefined();
  }
});

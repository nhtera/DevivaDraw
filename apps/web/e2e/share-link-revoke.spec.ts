import { test, expect } from "@playwright/test";

/**
 * Revocable share links, end to end through the dialog: creating a link records it in this
 * browser's history (revoke-only — no urls or keys persisted), Revoke deletes the blob server-side,
 * and a recipient opening the revoked link lands on the existing "expired or no longer exists"
 * notice. The collab-server is intercepted (PUT stores, DELETE removes, GET replays or 404s), so
 * the client's real header/method construction is exercised without a live Worker.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("a shared link can be revoked from the dialog's history, after which the link is dead", async ({ page }) => {
  const blobs = new Map<string, Buffer>();
  let deleteTokenHeader: string | null = null;
  let putHashHeader: string | null = null;
  await page.route("**/blobs/**", async (route) => {
    const request = route.request();
    const blobId = new URL(request.url()).pathname.split("/").pop()!;
    if (request.method() === "PUT") {
      putHashHeader = (await request.allHeaders())["x-deviva-delete-token-hash"] ?? null;
      blobs.set(blobId, request.postDataBuffer()!);
      await route.fulfill({ status: 204 });
      return;
    }
    if (request.method() === "DELETE") {
      deleteTokenHeader = (await request.allHeaders())["x-deviva-delete-token"] ?? null;
      blobs.delete(blobId);
      await route.fulfill({ status: 204 });
      return;
    }
    const stored = blobs.get(blobId);
    if (!stored) {
      await route.fulfill({ status: 404 });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/octet-stream", body: stored });
  });

  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(400, 380);
  await page.mouse.up();

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-share").click();
  const shareUrl = await page.getByTestId("share-dialog-link").inputValue();
  expect(putHashHeader).toMatch(/^[A-Za-z0-9_-]{43}$/); // the revocation hash rode the upload

  // The fresh link appears in "Links you've shared"; revoking it removes the row and the blob.
  await expect(page.getByTestId("share-dialog-history")).toBeVisible();
  const revokeButtons = page.locator('[data-testid^="share-history-revoke-"]');
  await expect(revokeButtons).toHaveCount(1);
  await revokeButtons.first().click();
  await expect(revokeButtons).toHaveCount(0);
  expect(deleteTokenHeader).toMatch(/^[A-Za-z0-9_-]{43}$/); // the raw token was presented on DELETE
  expect(blobs.size).toBe(0);

  // The revoked link was the one on display — the dialog must stop offering it for copying.
  await expect(page.getByTestId("share-dialog-current-revoked")).toBeVisible();
  await expect(page.getByTestId("share-dialog-link")).toHaveCount(0);

  // ...but not dead-end: generating a replacement link works right from the revoked state, and the
  // stale "revoked" notice never leaks onto the fresh link.
  await page.getByTestId("share-dialog-regenerate").click();
  await expect(page.getByTestId("share-dialog-link")).toBeVisible();
  await expect(page.getByTestId("share-dialog-current-revoked")).toHaveCount(0);
  const replacementUrl = await page.getByTestId("share-dialog-link").inputValue();
  expect(replacementUrl).not.toBe(shareUrl);

  // A recipient with the old link now gets the not-found notice, not the board.
  await page.goto(shareUrl);
  await expect(page.getByTestId("shared-scene-viewer-notice")).toBeVisible();
  await expect(page.getByTestId("shared-scene-viewer-notice")).not.toHaveText("");
});

test("history survives a reload and never persists the share url or key material", async ({ page }) => {
  await page.route("**/blobs/**", (route) => route.fulfill({ status: 204 }));
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(400, 380);
  await page.mouse.up();
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-share").click();
  const shareUrl = await page.getByTestId("share-dialog-link").inputValue();
  const keyFragment = new URL(shareUrl).hash;

  const persisted = await page.evaluate(() => localStorage.getItem("deviva-draw:share-links"));
  expect(persisted).not.toBeNull();
  expect(persisted!).not.toContain("http");
  expect(persisted!).not.toContain(keyFragment.slice(5, 20)); // no piece of the key survives

  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-share").click(); // generates a new link — history should show both
  await expect(page.locator('[data-testid^="share-history-revoke-"]')).toHaveCount(2);
});

test("a new link can be generated with an expiry, which rides the upload and shows in history", async ({ page }) => {
  let lastExpiryHeader: string | null = null;
  const blobs = new Map<string, Buffer>();
  await page.route("**/blobs/**", async (route) => {
    const request = route.request();
    const blobId = new URL(request.url()).pathname.split("/").pop()!;
    if (request.method() === "PUT") {
      lastExpiryHeader = (await request.allHeaders())["x-deviva-expires-at"] ?? null;
      blobs.set(blobId, request.postDataBuffer()!);
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 404 });
  });

  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(400, 380);
  await page.mouse.up();
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-share").click();
  const firstUrl = await page.getByTestId("share-dialog-link").inputValue();
  expect(lastExpiryHeader).toBeNull(); // the default link never expires

  await page.getByTestId("share-dialog-expiry").selectOption("7d");
  await page.getByTestId("share-dialog-regenerate").click();
  await expect(page.getByTestId("share-dialog-link")).not.toHaveValue(firstUrl);
  expect(lastExpiryHeader).not.toBeNull();
  const expiresAtMs = Date.parse(lastExpiryHeader!);
  expect(expiresAtMs).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  expect(expiresAtMs).toBeLessThan(Date.now() + 8 * 86_400_000);

  // Two links now, the newer one labeled with its expiry date.
  await expect(page.locator('[data-testid^="share-history-revoke-"]')).toHaveCount(2);
  await expect(page.getByTestId("share-dialog-history")).toContainText("expires");
});

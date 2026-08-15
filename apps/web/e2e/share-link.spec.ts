import { test, expect } from "@playwright/test";
import type { Request as PlaywrightRequest } from "@playwright/test";

/**
 * Proves the share-link feature's core security invariant end-to-end: the AES-GCM decryption key
 * generated for a share link never appears anywhere in an outgoing network request — not the URL, not
 * any header, not the request body. The collab-server (`apps/collab-server`) is intercepted via
 * `page.route` rather than run for real: interception happens in the browser before a request ever
 * reaches the network, so this test exercises the app's *actual* request-construction code (the real
 * risk surface for a key leak) without needing a live Worker/R2 binding in CI.
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("the share flow never sends the plaintext decryption key/iv to the server", async ({ page }) => {
  const capturedRequests: PlaywrightRequest[] = [];
  await page.route("**/blobs/**", async (route) => {
    capturedRequests.push(route.request());
    await route.fulfill({ status: 204 });
  });

  // Draw something so the shared scene isn't trivially empty.
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(320, 300);
  await page.mouse.up();

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-share").click();
  await page.getByTestId("share-dialog-regenerate").click(); // opening no longer auto-mints — creating a link is explicit

  const linkInput = page.getByTestId("share-dialog-link");
  await expect(linkInput).toBeVisible();
  const shareUrl = await linkInput.inputValue();

  expect(capturedRequests.length).toBeGreaterThan(0);

  const fragment = new URL(shareUrl).hash;
  const key = new URLSearchParams(fragment.slice(1)).get("key");
  const iv = new URLSearchParams(fragment.slice(1)).get("iv");
  expect(key).toBeTruthy();
  expect(iv).toBeTruthy();

  for (const request of capturedRequests) {
    expect(request.url()).not.toContain(key!);
    expect(request.url()).not.toContain(iv!);

    const headers = await request.allHeaders();
    expect(JSON.stringify(headers)).not.toContain(key!);
    expect(JSON.stringify(headers)).not.toContain(iv!);

    const postDataBuffer = request.postDataBuffer();
    if (postDataBuffer) {
      const bodyAsLatin1 = postDataBuffer.toString("latin1");
      expect(bodyAsLatin1).not.toContain(key!);
      expect(bodyAsLatin1).not.toContain(iv!);
    }
  }
});

test("a share link with a corrupted key fails to decrypt gracefully instead of crashing", async ({ page }) => {
  await page.route("**/blobs/**", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({ status: 204 });
      return;
    }
    // GET: return some arbitrary ciphertext-shaped bytes — decryption must fail against any key,
    // since this response was never actually encrypted with the fragment's key in the first place.
    await route.fulfill({ status: 200, contentType: "application/octet-stream", body: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) });
  });

  await page.goto("/s/00000000-0000-0000-0000-000000000000#key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&iv=BBBBBBBBBBBBBBBBBBBB");

  await expect(page.getByTestId("shared-scene-viewer-notice")).toBeVisible();
  // Never crashes into a blank/broken page — some human-readable notice is always shown.
  await expect(page.getByTestId("shared-scene-viewer-notice")).not.toHaveText("");
});

test("a multi-page document round-trips through a share link, read-only with page navigation", async ({ page }) => {
  // Intercept the collab-server: capture the PUT ciphertext, replay it on GET — the real crypto runs
  // in the browser on both legs.
  let storedBlob: Buffer | null = null;
  await page.route("**/blobs/**", async (route) => {
    if (route.request().method() === "PUT") {
      storedBlob = route.request().postDataBuffer();
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/octet-stream", body: storedBlob! });
  });

  // Two pages with content, then share.
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(320, 300);
  await page.mouse.up();
  await page.getByTestId("pages-toggle").click();
  await page.getByTestId("page-add").click();
  await page.getByTestId("toolbar-ellipse-tool").click();
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(500, 380);
  await page.mouse.up();

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-share").click();
  await page.getByTestId("share-dialog-regenerate").click(); // opening no longer auto-mints — creating a link is explicit
  const shareUrl = await page.getByTestId("share-dialog-link").inputValue();

  // Open the link: both pages arrive, switching works, editing affordances don't exist.
  await page.goto(shareUrl);
  await expect(page.getByTestId("pages-toggle")).toBeVisible();
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 2");
  await page.getByTestId("pages-toggle").click();
  await expect(page.locator('[data-testid^="page-item-"]')).toHaveCount(2);
  await expect(page.getByTestId("page-add")).toHaveCount(0);
  await expect(page.locator('[data-testid^="page-delete-"]')).toHaveCount(0);
  await page.locator('[data-testid^="page-item-"]').first().click();
  await expect(page.getByTestId("pages-active-name")).toHaveText("Page 1");
});

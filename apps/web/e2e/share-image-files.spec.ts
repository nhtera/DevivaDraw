import { test, expect } from "@playwright/test";
import { RED_BLUE_PNG, clearFileDatabase, insertImage, patchColor } from "./image-file-store-fixtures";

/**
 * A share link has to be self-contained. Image bytes live outside the document now
 * (`image-files-indexeddb.spec.ts`), and the recipient has neither the sender's database nor any way
 * to ask for it — so the shared payload must still carry them inline. The failure this guards against
 * is silent and only visible to the other person: the sender sees their board, the recipient sees
 * broken boxes.
 *
 * The collab-server is intercepted rather than run, but the payload is stored and served back
 * unmodified, so the round trip exercises the real encrypt/serialize/decrypt/restore path.
 */
test("an image survives a share link, seen from the recipient's side", async ({ page }) => {
  let stored: Buffer | null = null;
  await page.route("**/blobs/**", async (route) => {
    const request = route.request();
    if (request.method() === "PUT" || request.method() === "POST") {
      stored = request.postDataBuffer();
      await route.fulfill({ status: 204 });
      return;
    }
    if (!stored) {
      await route.fulfill({ status: 404 });
      return;
    }
    await route.fulfill({ status: 200, body: stored, contentType: "application/octet-stream" });
  });

  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await clearFileDatabase(page);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  await insertImage(page, RED_BLUE_PNG);
  await page.waitForTimeout(1500); // let the bytes reach the file store, so the document no longer holds them

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-share").click();
  await page.getByTestId("share-dialog-regenerate").click();
  const shareUrl = await page.getByTestId("share-dialog-link").inputValue();
  expect(stored).not.toBeNull();

  // Open the link the way the person on the other end would.
  await page.goto(shareUrl);
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  // The 200x100 image at the viewport centre: red on its left half, blue on its right.
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const left = await patchColor(page, viewport.width / 2 - 40, viewport.height / 2);
      return left.r > 200 && left.g < 60 && left.b < 60;
    })
    .toBe(true);
  const right = await patchColor(page, viewport.width / 2 + 40, viewport.height / 2);
  expect(right.b).toBeGreaterThan(200);
  expect(right.r).toBeLessThan(60);
});

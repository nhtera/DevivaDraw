import { test, expect } from "@playwright/test";

/**
 * The offline-hints seam (desktop phase 5) is host-gated: `<DevivaDraw offlineHints/>` is set only
 * by the desktop shell, so the WEB app must render byte-identically even when the browser is
 * actually offline — no hint elements, no disabled entry points. This pins the "no web behavior
 * smuggled in via shared components" red-team requirement.
 */

test("web renders no offline hints even when the browser is offline", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  await context.setOffline(true);
  // navigator.onLine flips async with the CDP switch; give the event a beat.
  await page.waitForFunction(() => !navigator.onLine);

  // Mermaid dialog (hosts the AI section) — hint must not exist, generate stays gated only by its own rules.
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-mermaid").click();
  await expect(page.getByTestId("mermaid-ai-prompt")).toBeVisible();
  await expect(page.getByTestId("mermaid-ai-offline")).toHaveCount(0);
  await page.getByTestId("mermaid-dialog-overlay").click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId("mermaid-dialog-overlay")).toHaveCount(0);

  // Collaborate dialog — start/join render enabled, no hint.
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-collab").click();
  await expect(page.getByTestId("collab-dialog-start")).toBeEnabled();
  await expect(page.getByTestId("collab-dialog-offline")).toHaveCount(0);
  await page.getByTestId("collab-dialog-overlay").click({ position: { x: 5, y: 5 } });

  // Share dialog — whatever status the offline attempt lands in, the web build renders no hint.
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-share").click();
  await expect(page.getByTestId("share-dialog")).toBeVisible();
  await expect(page.getByTestId("share-dialog-offline")).toHaveCount(0);

  await context.setOffline(false);
});

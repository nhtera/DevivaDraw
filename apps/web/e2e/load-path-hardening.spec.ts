import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Load-path hardening (offline-desktop plan phase 3): a crafted document file is untrusted input —
 * with OS file association, double-click IS the attack surface — so unsafe `element.link` schemes
 * must be nulled by the shared load path while the element itself (and safe links) load intact.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

/** Same real-`drop` dispatch as canvas-file-drop.spec.ts — the canvas file-drop path is a first-class load path. */
async function dropFile(page: Page, name: string, contents: unknown): Promise<void> {
  const dataTransfer = await page.evaluateHandle(
    ([fileName, json]) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([json!], fileName!, { type: "application/json" }));
      return transfer;
    },
    [name, JSON.stringify(contents)],
  );
  await page.getByTestId("deviva-draw-canvas-host").dispatchEvent("drop", { dataTransfer });
}

/** The active page's scene from autosave (document envelope unwrapped). */
async function autosavedScene(page: Page): Promise<{ schemaVersion: number; elements: Array<Record<string, unknown>> }> {
  await page.waitForTimeout(1300); // autosave debounce
  return page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("devivadraw:autosave:v1")!) as { pages?: Array<{ id: string; scene: unknown }>; activePageId?: string };
    return (doc.pages ? (doc.pages.find((entry) => entry.id === doc.activePageId) ?? doc.pages[0]!).scene : doc) as { schemaVersion: number; elements: Array<Record<string, unknown>> };
  });
}

test("a dropped file's javascript: link is nulled on load while a https link survives", async ({ page }) => {
  // Draw one real rectangle to get a fully-valid element template (strict open validation would
  // reject a hand-built partial element — and that rejection is not what this test is about).
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(460, 400);
  await page.mouse.up();
  const drawn = await autosavedScene(page);
  const template = drawn.elements[0]!;

  const file = {
    type: "devivadraw/scene",
    schemaVersion: drawn.schemaVersion,
    elements: [
      { ...template, id: "link-bad", index: "a1", x: 100, link: "javascript:alert(1)" },
      { ...template, id: "link-good", index: "a2", x: 300, link: "https://example.com/docs" },
    ],
    files: {},
  };
  await dropFile(page, "links.devivadraw", file);

  const loaded = await autosavedScene(page);
  const byId = new Map(loaded.elements.map((element) => [element.id, element]));
  expect(byId.get("link-bad")!.link).toBeNull();
  expect(byId.get("link-good")!.link).toBe("https://example.com/docs");

  // The UI reflects it: only the safe link renders a badge (the badge is a live anchor — exactly
  // the surface the nulling protects).
  await expect(page.getByTestId("link-badge-link-good")).toBeVisible();
  await expect(page.getByTestId("link-badge-link-bad")).toHaveCount(0);
});

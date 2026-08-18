import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Escape closes every modal dialog, which is the dismissal users reach for first and the one these
 * dialogs shipped without: each grew its own overlay-click and header-× close independently, so the
 * key worked on the shortcuts dialog alone and left the other five open. Asserted per dialog rather
 * than on one representative, since that is exactly how the gap opened in the first place.
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

async function openFromMenu(page: Page, item: string): Promise<void> {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId(item).click();
}

const DIALOGS = [
  { menuItem: "main-menu-export-image", testId: "export-dialog" },
  { menuItem: "main-menu-share", testId: "share-dialog" },
  { menuItem: "main-menu-collab", testId: "collab-dialog" },
  { menuItem: "main-menu-embed", testId: "embed-dialog" },
  { menuItem: "main-menu-mermaid", testId: "mermaid-dialog" },
  { menuItem: "main-menu-shortcuts", testId: "shortcuts-dialog" },
];

for (const { menuItem, testId } of DIALOGS) {
  test(`Escape closes the ${testId}`, async ({ page }) => {
    await openFromMenu(page, menuItem);
    await expect(page.getByTestId(testId)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId(testId)).toHaveCount(0);
  });
}

test("Escape reaches the dialog even while its autofocused input holds the keyboard", async ({ page }) => {
  // The embed dialog focuses its URL field on open, so the key never lands on the dialog element —
  // a dialog-level handler would miss it entirely, which is why the listener is on the window.
  await openFromMenu(page, "main-menu-embed");
  const input = page.getByTestId("embed-input");
  await expect(input).toBeFocused();
  await input.pressSequentially("https://youtube.com/watch?v=x");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("embed-dialog")).toHaveCount(0);
});

test("closing a dialog with Escape leaves the canvas selection alone", async ({ page }) => {
  // Escape is also the canvas's deselect key. One press must not do both jobs at once.
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(300, 250);
  await page.mouse.down();
  await page.mouse.move(460, 360, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("properties-panel")).toBeVisible();

  await openFromMenu(page, "main-menu-export-image");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("export-dialog")).toHaveCount(0);
  await expect(page.getByTestId("properties-panel")).toBeVisible(); // still selected
});

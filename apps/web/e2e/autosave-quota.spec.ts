import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The storage-full warning.
 *
 * A rejected autosave write is the editor's one invisible failure: the board keeps accepting edits
 * and looks healthy, and the work is gone at the next reload. These specs drive the real condition —
 * an actually-full `localStorage` — rather than faking the state, because the thing worth proving is
 * that the app notices, not that a banner renders when told to.
 */

/** Fills `localStorage` down to a few dozen free bytes, so any autosave write is rejected. */
async function fillStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    let index = 0;
    // Coarse to fine: big chunks get there in a few iterations, small ones close the gap so the
    // remaining free space is smaller than any real payload's growth.
    for (const size of [512 * 1024, 8 * 1024, 512, 64]) {
      const chunk = "x".repeat(size);
      for (;;) {
        try {
          localStorage.setItem(`e2e-pad-${index++}`, chunk);
        } catch {
          break;
        }
      }
    }
  });
}

async function freeStorage(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) if (key.startsWith("e2e-pad-")) localStorage.removeItem(key);
  });
}

/** One rectangle, drawn clear of the properties panel (which is on screen while a creation tool is active). */
async function drawRectangle(page: Page, x: number): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(x, 300);
  await page.mouse.down();
  await page.mouse.move(x + 120, 420, { steps: 8 });
  await page.mouse.up();
}

/** Autosave debounce (1s) plus room for the write itself. */
async function settleAutosave(page: Page): Promise<void> {
  await page.waitForTimeout(1600);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("warns when storage is full, and retracts the warning once saving works again", async ({ page }) => {
  await drawRectangle(page, 700);
  await settleAutosave(page);
  await expect(page.getByTestId("autosave-quota-banner")).toHaveCount(0);

  await fillStorage(page);
  await drawRectangle(page, 900);
  await expect(page.getByTestId("autosave-quota-banner")).toBeVisible();
  await expect(page.getByTestId("autosave-quota-banner")).toContainText(/storage is full/i);
  await expect(page.getByTestId("autosave-quota-save")).toBeVisible();

  // The recovery half: freeing space must clear the warning on its own, with no reload and no
  // dismiss button — otherwise the banner outlives the problem and the user learns to ignore it.
  await freeStorage(page);
  await drawRectangle(page, 1100);
  await expect(page.getByTestId("autosave-quota-banner")).toHaveCount(0);
});

test("the banner's save button really writes the scene out", async ({ page }) => {
  // Headless Chromium has `showSaveFilePicker`, so the real save path opens a native dialog no test
  // can drive. Stubbing the picker (not the app) keeps every line of the save action under test and
  // captures exactly what it would have written to disk.
  await page.addInitScript(() => {
    const state = window as unknown as { __savedFile?: { name: string; content: string } };
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = (options: { suggestedName: string }) => {
      let content = "";
      return Promise.resolve({
        createWritable: () =>
          Promise.resolve({
            write: (data: string) => {
              content = data;
              return Promise.resolve();
            },
            close: () => {
              state.__savedFile = { name: options.suggestedName, content };
              return Promise.resolve();
            },
          }),
      });
    };
  });
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();

  await fillStorage(page);
  await drawRectangle(page, 700);
  await expect(page.getByTestId("autosave-quota-banner")).toBeVisible();

  await page.getByTestId("autosave-quota-save").click();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __savedFile?: { name: string } }).__savedFile?.name))
    .toMatch(/\.devivadraw$/);
  const elementCount = await page.evaluate(() => {
    const saved = (window as unknown as { __savedFile?: { content: string } }).__savedFile!;
    const document = JSON.parse(saved.content);
    return document.pages[0].scene.elements.length;
  });
  expect(elementCount).toBe(1);
});

test("zen mode does not hide it — a data-loss warning outranks a clean canvas", async ({ page }) => {
  await fillStorage(page);
  await drawRectangle(page, 700);
  await expect(page.getByTestId("autosave-quota-banner")).toBeVisible();

  await page.keyboard.press("Alt+z");
  await expect(page.getByTestId("exit-zen-pill")).toBeVisible();
  await expect(page.getByTestId("library-toggle")).toHaveCount(0);
  await expect(page.getByTestId("autosave-quota-banner")).toBeVisible();
});

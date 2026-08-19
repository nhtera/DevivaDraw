import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { autosavedElements, clearFileDatabase } from "./image-file-store-fixtures";
import { clearVersionDatabase, storedVersions } from "./version-history-fixtures";

/**
 * The two behaviours that govern how history grows: the automatic cadence, and retention.
 *
 * Both are gated on time or on volume, which is why they live in a spec of their own with a test
 * harness that can move both. Waiting five real minutes for one snapshot, or drawing forty boards to
 * see the thirty-first prune the first, is not a test anybody runs — so the clock and the store are
 * driven directly, against the real scheduler in the real app rather than a stand-in.
 *
 * The harness is entirely in this file's init script; nothing here exists in product code.
 */

/**
 * Installs a controllable clock and a handle on the snapshot scheduler's own interval.
 *
 * `Date.now` gains an offset the test can advance. `setInterval` is wrapped so the five-minute
 * registration the scheduler makes is *also* exposed as a callable — it still registers normally, so
 * nothing about the app's behaviour changes; the test simply gains a way to say "pretend that
 * interval just fired" instead of waiting for it.
 */
async function installClockHarness(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const AUTO_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
    let offset = 0;
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + offset;
    const realSetInterval = window.setInterval.bind(window);
    (window as unknown as Record<string, unknown>).__advanceClock = (ms: number) => (offset += ms);
    window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === AUTO_SNAPSHOT_INTERVAL_MS && typeof handler === "function") {
        (window as unknown as Record<string, unknown>).__tickVersionSnapshots = handler;
      }
      return realSetInterval(handler, delay, ...args);
    }) as typeof window.setInterval;
  });
}

/** Moves the clock forward and fires the cadence evaluation the scheduler's own timer would have fired. */
async function advanceAndTick(page: Page, ms: number): Promise<void> {
  await page.evaluate((amount) => {
    const scope = window as unknown as { __advanceClock(value: number): void; __tickVersionSnapshots?: () => void };
    scope.__advanceClock(amount);
    scope.__tickVersionSnapshots?.();
  }, ms);
}

async function drawRect(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.getByTestId("toolbar-rectangle-tool").click();
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 6 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await installClockHarness(page);
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await clearFileDatabase(page);
  await clearVersionDatabase(page);
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  // The scheduler starts only once the image restore has settled, so its interval — and therefore
  // the handle above — appears a moment after the first paint.
  await expect.poll(() => page.evaluate(() => "__tickVersionSnapshots" in window)).toBe(true);
});

test("the board snapshots itself once the interval has passed and something has changed", async ({ page }) => {
  await drawRect(page, [300, 240], [420, 340]);
  await expect.poll(async () => (await autosavedElements(page)).length).toBe(1);

  await advanceAndTick(page, 5 * 60 * 1000);

  await expect.poll(() => storedVersions(page)).toMatchObject([{ trigger: "auto", elementCount: 1 }]);
  // …and it survives a reload, which is the whole point of history over undo.
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  expect(await storedVersions(page)).toHaveLength(1);
});

test("an idle session writes nothing, however long it sits there", async ({ page }) => {
  await drawRect(page, [300, 240], [420, 340]);
  await advanceAndTick(page, 5 * 60 * 1000);
  await expect.poll(() => storedVersions(page)).toHaveLength(1);

  // Half an hour of looking at the board without touching it.
  for (let elapsed = 0; elapsed < 6; elapsed += 1) await advanceAndTick(page, 5 * 60 * 1000);

  expect(await storedVersions(page)).toHaveLength(1);
});

test("a second automatic snapshot needs both the interval and an actual edit", async ({ page }) => {
  await drawRect(page, [300, 240], [420, 340]);
  await advanceAndTick(page, 5 * 60 * 1000);
  await expect.poll(() => storedVersions(page)).toHaveLength(1);

  // An edit, but not enough time.
  await drawRect(page, [520, 240], [640, 340]);
  await expect.poll(async () => (await autosavedElements(page)).length).toBe(2);
  await advanceAndTick(page, 60 * 1000);
  expect(await storedVersions(page)).toHaveLength(1);

  // Now the rest of the interval.
  await advanceAndTick(page, 4 * 60 * 1000);
  await expect.poll(() => storedVersions(page)).toHaveLength(2);
  expect((await storedVersions(page))[0]!.elementCount).toBe(2);
});

/**
 * Retention, exercised against the real policy by seeding the store past its caps and then making one
 * ordinary write. Seeding rather than drawing forty boards: what is under test is which records
 * survive, and the app cannot tell a seeded record from one it wrote itself.
 */
test("retention prunes the oldest automatic versions and keeps every version the user named", async ({ page }) => {
  await drawRect(page, [300, 240], [420, 340]);

  await page.evaluate(
    ([autoCount, manualCount]) =>
      new Promise<void>((resolve) => {
        const request = indexedDB.open("devivadraw-versions");
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(["versions", "documents"], "readwrite");
          const summaries = transaction.objectStore("versions");
          const documents = transaction.objectStore("documents");
          const emptyDocument = { type: "devivadraw/document", schemaVersion: 1, pages: [] };
          for (let index = 0; index < autoCount!; index += 1) {
            const id = `seed-auto-${String(index).padStart(3, "0")}`;
            summaries.put({ id, createdAt: 1000 + index, trigger: "auto", pageCount: 1, elementCount: 1, bytes: 100, fileIds: [] });
            documents.put(emptyDocument, id);
          }
          for (let index = 0; index < manualCount!; index += 1) {
            const id = `seed-manual-${String(index).padStart(3, "0")}`;
            summaries.put({ id, createdAt: 2000 + index, trigger: "manual", label: `named ${index}`, pageCount: 1, elementCount: 1, bytes: 100, fileIds: [] });
            documents.put(emptyDocument, id);
          }
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => {
            database.close();
            resolve();
          };
        };
        request.onerror = () => resolve();
      }),
    [40, 8] as const,
  );
  expect(await storedVersions(page)).toHaveLength(48);

  // One ordinary automatic write, which is what runs retention.
  await advanceAndTick(page, 5 * 60 * 1000);

  await expect
    .poll(async () => {
      const versions = await storedVersions(page);
      return { automatic: versions.filter((entry) => entry.trigger !== "manual").length, manual: versions.filter((entry) => entry.trigger === "manual").length };
    })
    // 40 seeded + 1 new = 41 prunable, capped at 30. The 8 named ones are under their own cap of 10
    // and are never touched to make room for an automatic one.
    .toEqual({ automatic: 30, manual: 8 });

  const surviving = await storedVersions(page);
  // The oldest went, the newest stayed — pruning takes the correct end of the history.
  expect(surviving.some((entry) => entry.id === "seed-auto-000")).toBe(false);
  expect(surviving.some((entry) => entry.id === "seed-auto-039")).toBe(true);
  expect(surviving.filter((entry) => entry.trigger === "manual").map((entry) => entry.label).sort()).toEqual(["named 0", "named 1", "named 2", "named 3", "named 4", "named 5", "named 6", "named 7"]);
});

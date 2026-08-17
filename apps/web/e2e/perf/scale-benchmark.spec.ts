import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { AUTOSAVE_STORAGE_KEY, DROP_SCENE_SCRIPT, buildAutosaveDocument, buildScaleScene } from "./seed-scene";

/**
 * Scale benchmark: what Deviva costs at 1k / 5k / 10k elements.
 *
 * Report-first by design. These are wall-clock numbers from a real browser on whatever machine runs
 * them, so they are printed and collected rather than asserted — a tight threshold here would fail
 * on a loaded laptop and teach everyone to ignore it. The only hard assertion is a ceiling far above
 * any plausible real timing, there to catch an algorithmic regression (something going quadratic)
 * rather than to police milliseconds. Set `PERF_BUDGET=1` to additionally enforce the frame budget.
 *
 * The regression gate that DOES run on every change is the deterministic engine bench
 * (`packages/engine/src/render/render-scale.bench.test.ts`) — no browser, no scheduler noise.
 *
 * Methodology follows the drag-testing playbook already used for this project's published
 * numbers: per-frame sampling via `requestAnimationFrame` during a synthetic interaction, reported
 * as a median plus a 95th percentile (the median alone hides exactly the stutter users complain
 * about).
 */

const SCALES = [1_000, 5_000, 10_000] as const;
/** Sustained-60fps target. Frames slower than this are what a user perceives as stutter. */
const FRAME_BUDGET_MS = 1000 / 55;
/** Absurdly high on purpose — an algorithmic regression tripwire, not a performance standard. */
const CEILING_MS = 400;
const ENFORCE_BUDGET = process.env.PERF_BUDGET === "1";

interface FrameStats {
  median: number;
  p95: number;
  worst: number;
  frames: number;
}

const collected: { scale: number; metric: string; stats: FrameStats }[] = [];

/** Waits for two consecutive animation frames — enough for the restore's first full paint to land. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))));
}

/** Starts a `requestAnimationFrame` sampler in the page; returns nothing (state lives on `window`). */
async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store: { times: number[]; stop?: boolean } = { times: [] };
    (window as unknown as { __perf?: { times: number[]; stop?: boolean } }).__perf = store;
    const tick = (now: number) => {
      store.times.push(now);
      if (!store.stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Stops the sampler and reduces the raw frame timestamps to interval statistics. */
async function stopSampling(page: Page): Promise<FrameStats> {
  const times = await page.evaluate(() => {
    const store = (window as unknown as { __perf?: { times: number[]; stop?: boolean } }).__perf;
    if (store) store.stop = true;
    return store?.times ?? [];
  });
  const intervals: number[] = [];
  for (let i = 1; i < times.length; i += 1) intervals.push(times[i]! - times[i - 1]!);
  if (intervals.length === 0) return { median: 0, p95: 0, worst: 0, frames: 0 };
  const sorted = [...intervals].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)]!,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!,
    worst: sorted[sorted.length - 1]!,
    frames: intervals.length,
  };
}

function record(scale: number, metric: string, stats: FrameStats): void {
  collected.push({ scale, metric, stats });
  console.log(`PERF ${scale}\t${metric}\tmedian=${stats.median.toFixed(1)}ms p95=${stats.p95.toFixed(1)}ms worst=${stats.worst.toFixed(1)}ms frames=${stats.frames}`);
  expect(stats.median, `${metric} at ${scale} exceeded the regression ceiling`).toBeLessThan(CEILING_MS);
  if (ENFORCE_BUDGET) expect(stats.median, `${metric} at ${scale} breached the frame budget`).toBeLessThan(FRAME_BUDGET_MS);
}

test.describe.configure({ mode: "serial" });

for (const scale of SCALES) {
  test(`scale ${scale}: cold paint, pan, zoom, drag-all, marquee`, async ({ page }) => {
    test.setTimeout(180_000);

    // --- cold first paint: navigation start to the first frame after the scene restores ---
    await page.goto("/");
    const scene = buildScaleScene(scale);
    const doc = buildAutosaveDocument(scene.elements);
    const seeded = await page.evaluate(
      ({ key, document }) => {
        try {
          localStorage.clear();
          localStorage.setItem(key, JSON.stringify(document));
          return { ok: true, bytes: (localStorage.getItem(key) ?? "").length };
        } catch {
          // localStorage quota — a real audit finding at this scale, reported rather than thrown.
          return { ok: false, bytes: JSON.stringify(document).length };
        }
      },
      { key: AUTOSAVE_STORAGE_KEY, document: doc },
    );
    console.log(`PERF ${scale}\tautosave-bytes\t${seeded.bytes}\tfits=${seeded.ok}`);

    const coldStart = Date.now();
    if (seeded.ok) {
      await page.reload();
      await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
    } else {
      // Quota-exceeded scale: load through the document-drop path instead, so the scale is still
      // measured. Cold paint is then "import + first paint", which the report notes explicitly.
      await page.reload();
      await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
      await page.evaluate(`(${DROP_SCENE_SCRIPT})(${JSON.stringify(doc)})`);
      await expect.poll(async () => page.evaluate(() => document.querySelectorAll('[data-testid="deviva-draw-canvas-host"] canvas').length), { timeout: 60_000 }).toBeGreaterThan(0);
    }
    await settle(page);
    const coldPaintMs = Date.now() - coldStart;
    console.log(`PERF ${scale}\tcold-paint\t${coldPaintMs}ms`);
    collected.push({ scale, metric: "cold-paint", stats: { median: coldPaintMs, p95: coldPaintMs, worst: coldPaintMs, frames: 1 } });

    // --- pan: hand tool dragged across the scene ---
    await page.keyboard.press("h");
    await startSampling(page);
    await page.mouse.move(700, 400);
    await page.mouse.down();
    for (let i = 0; i < 30; i += 1) await page.mouse.move(700 - i * 12, 400 - i * 6);
    await page.mouse.up();
    record(scale, "pan", await stopSampling(page));

    // --- zoom: ctrl+wheel at a fixed anchor, in and back out ---
    await startSampling(page);
    for (let i = 0; i < 20; i += 1) {
      await page.mouse.wheel(0, i < 10 ? -120 : 120);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    }
    record(scale, "zoom", await stopSampling(page));

    // --- drag-all: select everything, then move it ---
    await page.keyboard.press("v");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
    await settle(page);
    await startSampling(page);
    await page.mouse.move(700, 400);
    await page.mouse.down();
    for (let i = 0; i < 30; i += 1) await page.mouse.move(700 + i * 10, 400 + i * 5);
    await page.mouse.up();
    record(scale, "drag-all", await stopSampling(page));

    // --- marquee: a rubber-band drag over the whole viewport from empty canvas ---
    await page.keyboard.press("Escape");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z"); // undo the drag
    await settle(page);
    await startSampling(page);
    await page.mouse.move(60, 120);
    await page.mouse.down();
    for (let i = 0; i < 30; i += 1) await page.mouse.move(60 + i * 40, 120 + i * 18);
    await page.mouse.up();
    record(scale, "marquee", await stopSampling(page));
  });
}

test.afterAll(() => {
  if (collected.length === 0) return;
  const header = "| scale | metric | median | p95 | worst |\n|---|---|---|---|---|";
  const rows = collected.map((r) => `| ${r.scale} | ${r.metric} | ${r.stats.median.toFixed(1)} | ${r.stats.p95.toFixed(1)} | ${r.stats.worst.toFixed(1)} |`);
  console.log(`\nPERF-TABLE\n${header}\n${rows.join("\n")}\n`);
});

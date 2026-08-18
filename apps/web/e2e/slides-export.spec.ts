import { test, expect } from "@playwright/test";
import type { Download, Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deckDocument, frameElement, loadDeck } from "./presentation-fixtures";

/**
 * Deck export: the scene's frames as a `.pptx` or a multi-page PDF.
 *
 * The PPTX assertions parse the downloaded archive's own central directory rather than trusting a
 * filename — that is what proves the bytes are a real ZIP whose parts a consumer will find, without
 * needing PowerPoint installed on a CI runner.
 */

/** Part paths listed in a ZIP's central directory, walked from the end-of-central-directory record. */
function zipEntryNames(bytes: Buffer): string[] {
  const end = bytes.length - 22;
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    expect(bytes.readUInt32LE(at)).toBe(0x02014b50);
    const nameLength = bytes.readUInt16LE(at + 28);
    names.push(bytes.toString("utf8", at + 46, at + 46 + nameLength));
    at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  return names;
}

/** One entry's bytes, located through the archive's central directory. */
function zipEntry(bytes: Buffer, path: string): Buffer {
  const end = bytes.length - 22;
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const localOffset = bytes.readUInt32LE(at + 42);
    const name = bytes.toString("utf8", at + 46, at + 46 + nameLength);
    if (name === path) {
      const dataStart = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
      return bytes.subarray(dataStart, dataStart + size);
    }
    at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  throw new Error(`slides-export: ${path} is not in the archive`);
}

async function downloadedBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  return readFile(path!);
}

async function openExportDialog(page: Page): Promise<void> {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-export-image").click();
}

/** Three frames, deliberately out of scene order relative to their numeric prefixes. */
function threeSlideDeck(): unknown {
  return deckDocument([
    frameElement("f-c", "3. Third", 2000, "a003"),
    frameElement("f-a", "1. First", 0, "a001"),
    frameElement("f-b", "2. Second", 1000, "a002"),
  ]);
}

test("a three-frame deck exports a three-slide pptx a reader can walk", async ({ page }) => {
  await loadDeck(page, threeSlideDeck());
  await openExportDialog(page);

  const download = page.waitForEvent("download");
  await page.getByTestId("export-pptx").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pptx$/);

  const names = zipEntryNames(await downloadedBytes(file));
  expect(names).toContain("[Content_Types].xml");
  expect(names).toContain("ppt/presentation.xml");
  expect(names).toContain("ppt/theme/theme1.xml");
  for (const number of [1, 2, 3]) {
    expect(names).toContain(`ppt/slides/slide${number}.xml`);
    expect(names).toContain(`ppt/slides/_rels/slide${number}.xml.rels`);
    expect(names).toContain(`ppt/media/image${number}.png`);
  }
  // Exactly three: a fourth slide part would mean a non-frame element leaked into the deck.
  expect(names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(3);
});

test("the same deck exports a multi-page PDF", async ({ page }) => {
  await loadDeck(page, threeSlideDeck());
  await openExportDialog(page);

  const download = page.waitForEvent("download");
  await page.getByTestId("export-slides-pdf").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);

  const bytes = await downloadedBytes(file);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  // One `/Type /Page` object per frame — the page count, read out of the PDF itself.
  expect(bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).toHaveLength(3);
});

/** A plain rectangle, for the overhang fixture below. */
function rectElement(id: string, x: number, y: number, width: number, height: number, index: string): Record<string, unknown> {
  return {
    id,
    type: "rectangle",
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: null,
    seed: 1,
    groupIds: [],
    frameId: null,
    boundElements: null,
    link: null,
    locked: false,
    index,
    version: 1,
    versionNonce: 1,
    updated: 1,
    isDeleted: false,
  };
}

test("a slide whose contents overhang its frame is placed undistorted", async ({ page }) => {
  // Frame membership goes by an element's CENTRE, so this 600-wide bar belongs to the 400-wide frame
  // while sticking out both sides. The render's bounds are therefore wider than the frame — and the
  // slide picture is placed with a stretch fill, so a placement sized from the frame would squash it.
  await loadDeck(page, deckDocument([frameElement("f-a", "1. Wide", 0, "a001"), rectElement("r-1", -100, 125, 600, 50, "a002")]));
  await openExportDialog(page);

  const download = page.waitForEvent("download");
  await page.getByTestId("export-pptx").click();
  const bytes = await downloadedBytes(await download);

  const png = zipEntry(bytes, "ppt/media/image1.png");
  const imageAspect = png.readUInt32BE(16) / png.readUInt32BE(20);
  expect(imageAspect, "the render should be wider than the 4:3 frame — otherwise this fixture proves nothing").toBeGreaterThan(1.4);

  const slide = zipEntry(bytes, "ppt/slides/slide1.xml").toString("utf8");
  // The PICTURE's extent — the shape tree's own group `a:ext` is a zero-sized placeholder, so anchor
  // on the `a:prstGeom` that only the picture carries.
  const extent = /<a:ext cx="(\d+)" cy="(\d+)"\/><\/a:xfrm><a:prstGeom/.exec(slide)!;
  expect(Number(extent[1]) / Number(extent[2])).toBeCloseTo(imageAspect, 2);
});

test("the deck actions are disabled, with a reason, when the scene has no frames", async ({ page }) => {
  await loadDeck(page, deckDocument([]));
  await openExportDialog(page);

  await expect(page.getByTestId("export-pptx")).toBeDisabled();
  await expect(page.getByTestId("export-slides-pdf")).toBeDisabled();
  await expect(page.getByTestId("export-slides-hint")).toBeVisible();
});

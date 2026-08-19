/**
 * Regenerates `src/text/hand-drawn-font-data.ts` — the base64 `woff2` data URI behind the default
 * hand-drawn text face — by subsetting the committed source font in `assets/` to the unicode ranges
 * below.
 *
 * Run by hand (`pnpm --filter @deviva-draw/engine font:build`), never by the build: the output is
 * committed, so an ordinary build and an ordinary CI run need no font toolchain at all. Re-running it
 * on an unchanged source must produce a byte-identical file — that is what makes the committed
 * artifact reviewable.
 *
 * The source hash is verified before anything is subset (see `assets/PROVENANCE.md`).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_FONT = join(packageRoot, "assets", "PatrickHand-Regular.ttf");
const SOURCE_SHA256 = "0f173b3e6cb6d1af25babf7f0057c5ac4ee11f9992b0469bb817e967ef4ad0fc";
const OUTPUT = join(packageRoot, "src", "text", "hand-drawn-font-data.ts");

/**
 * What the shipped subset covers. Each entry is `[first, last, why]`; the `why` is reproduced in the
 * generated file's header so a future reader can tell which ranges are load-bearing before dropping
 * one. Widening this list is the supported way to add coverage — hand-editing the generated file is
 * not, and `text/font-coverage.test.ts` is what catches a range going missing.
 */
const RANGES = [
  [0x0020, 0x00ff, "Basic Latin + Latin-1 Supplement"],
  [0x0100, 0x017f, "Latin Extended-A (đ Đ ł ő ž, European diacritics)"],
  [0x0180, 0x024f, "Latin Extended-B (Vietnamese ơ ư live here, plus ș)"],
  [0x0300, 0x0323, "combining marks Vietnamese stacks with"],
  [0x1ea0, 0x1ef9, "Latin Extended Additional — the Vietnamese precomposed block"],
  [0x2013, 0x2014, "en/em dash"],
  [0x2018, 0x201d, "curly quotes"],
  [0x2026, 0x2026, "ellipsis"],
  [0x2212, 0x2212, "minus sign"],
];

const source = readFileSync(SOURCE_FONT);
const actualSha256 = createHash("sha256").update(source).digest("hex");
if (actualSha256 !== SOURCE_SHA256) {
  console.error(
    `Source font hash mismatch.\n  expected ${SOURCE_SHA256}\n  actual   ${actualSha256}\n` +
      `${SOURCE_FONT} is not the file assets/PROVENANCE.md describes. Work out why before updating the hash.`,
  );
  process.exit(1);
}

const text = RANGES.flatMap(([first, last]) => {
  const codepoints = [];
  for (let codepoint = first; codepoint <= last; codepoint += 1) codepoints.push(String.fromCodePoint(codepoint));
  return codepoints;
}).join("");

const woff2 = await subsetFont(source, text, { targetFormat: "woff2" });
const base64 = Buffer.from(woff2).toString("base64");

const rangeDoc = RANGES.map(
  ([first, last, why]) =>
    ` *   U+${first.toString(16).toUpperCase().padStart(4, "0")}-${last.toString(16).toUpperCase().padStart(4, "0")}  ${why}`,
).join("\n");

writeFileSync(
  OUTPUT,
  `/**
 * Embedded hand-drawn text font (Patrick Hand, SIL Open Font License 1.1) as a self-contained base64
 * \`woff2\` data URI, so the default sketchy text face ships with the package with no external host/CDN
 * request (matching the app's no-external-asset stance) and works under a strict CSP.
 *
 * Generated — do not hand-edit. Produced by \`scripts/build-hand-drawn-font.mjs\` from
 * \`assets/PatrickHand-Regular.ttf\` (provenance and source hash: \`assets/PROVENANCE.md\`). Covers:
 *
${rangeDoc}
 *
 * That includes full Vietnamese; glyphs outside these ranges still fall back per the
 * \`TEXT_FONT_FAMILY_CSS\` stack. Referenced only by \`font-loading.ts\` (registers the \`FontFace\`) and
 * \`font-coverage.test.ts\` (asserts the ranges above survived the subset). Data module, not logic —
 * exempt from the file-size guideline.
 */
export const HAND_DRAWN_FONT_FAMILY = "DevivaHand";
export const HAND_DRAWN_FONT_DATA_URL = "data:font/woff2;base64,${base64}";
`,
);

console.log(`wrote ${OUTPUT}`);
console.log(`  woff2  ${woff2.length} bytes`);
console.log(`  base64 ${base64.length} bytes`);

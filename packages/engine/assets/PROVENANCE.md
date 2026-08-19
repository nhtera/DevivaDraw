# Bundled hand-drawn font — provenance

`PatrickHand-Regular.ttf` is the source the shipped `src/text/hand-drawn-font-data.ts` subset is
generated from. It is committed so the artifact is reproducible: anyone can re-run
`pnpm --filter @deviva-draw/engine font:build` and get byte-identical output without hunting for the
upstream file.

| Field | Value |
|---|---|
| Family | Patrick Hand |
| Designer | Patrick Wagesreiter |
| Copyright | Copyright (c) 2010-2012 Patrick Wagesreiter (mail@patrickwagesreiter.at) |
| License | SIL Open Font License 1.1 (`PatrickHand-OFL.txt`, beside this file) |
| Reserved Font Name | none declared — the copyright line carries no "with Reserved Font Name" clause, so a subset may be redistributed under the original name |
| Upstream | https://github.com/google/fonts/blob/main/ofl/patrickhand/PatrickHand-Regular.ttf |
| Retrieved | 2026-08-19 |
| SHA-256 | `0f173b3e6cb6d1af25babf7f0057c5ac4ee11f9992b0469bb817e967ef4ad0fc` |

`scripts/build-hand-drawn-font.mjs` verifies that SHA-256 before it subsets anything and refuses to
run on a mismatch. A binary every visitor's font engine parses should not change silently: if the
hash check fails, the file in the tree is not the file this table describes, and the right response
is to work out why rather than to update the hash.

## Why this face

The previous bundled face covered Latin-1 only (212 codepoints), so Vietnamese — a locale this
product ships — rendered in the sans fallback mid-sentence, on canvas and in every export. Patrick
Hand carries the full Vietnamese precomposed block, Latin Extended-A and Latin Extended-B, is
OFL-licensed with no reserved name, and subsets to ~72 KB of base64 for the ranges the generator
lists. Its glyphs are narrower than the previous face's, so text laid out before the change re-wraps
narrower — stored text is always the raw unwrapped string (`elements/text-element.ts`), so the wrap
is re-derived at render time and no stored data is invalidated by the swap.

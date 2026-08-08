# Phase 11 — Persistence & Export

## Context Links
- `plans/reports/research-260808-full-feature-scope-excalidraw-parity.md` §9 (Persistence & Export)
- Depends on: `phase-10-selection-transforms-snapping-grid.md` (selection-only export scope, "M1 Solo MVP" milestone)

## Overview
- **Priority:** 🔴 blocking — closes out the dogfoodable Solo MVP milestone (M1)
- **Status:** pending
- Implement the `.devivadraw`-style JSON scene format with schema versioning/migrations, localStorage autosave/restore, PNG export (multiple scales, transparent/dark options, selection-only, embedded scene data), SVG export (with font embedding), and copy-as-image to system clipboard.

## Key Insights
- JSON scene format needs a `schemaVersion` field from file #1 (not added later) — every future element-model change (e.g. adding a new arrow type, a new style field) is a migration function keyed off this version, run on load. Skipping this now means the first real schema change has no migration path for already-saved scenes.
- `Scene.files` (phase 09) serializes as a **separate top-level key** from `elements` in the JSON, matching the files-map indirection decision made in phase 09 — large images don't bloat the elements array, and this mirrors the wire format phase 14 will reuse for collab sync.
- PNG export renders the scene to an **offscreen canvas at export resolution** (not a screenshot of the live DOM canvas) so scale (1x/2x/3x) and selection-only cropping are exact — reuses phase 03's `StaticLayer` rendering logic against a temporary camera/viewport sized for the export, not the live viewport.
- "Embed scene in PNG": the scene JSON is embedded as a PNG `tEXt` chunk (a standard, lossless technique — Excalidraw does the same) so a previously-exported PNG can be re-imported as an editable scene later; this needs a small PNG chunk-writing utility (no image library needed, PNG chunk format is simple enough to hand-roll in <100 lines, avoiding a heavier dependency — YAGNI check passed).
- SVG export renders shapes as native SVG paths (rough.js has an SVG-output mode, reused instead of re-implementing sketchy rendering for SVG) — font embedding/subsetting for portable SVGs is flagged 🟡 (parity, not MVP-blocking); ship SVG export referencing system/webfont URLs first, add embedding as a follow-up within this phase's own todo list if time allows, not a blocker for phase 12+.
- Copy-as-image to system clipboard uses the `ClipboardItem` API (same PNG-rendering path as export, just written to `navigator.clipboard.write` instead of triggering a file download).

## Requirements
- Scene JSON schema: `{schemaVersion, elements, files, appState: {...}}`; migration registry (`migrations[fromVersion] -> toVersion` functions).
- localStorage autosave: debounced write on every scene change (reuse phase 02's subscription), restore on load via `initialData`.
- Multiple scenes/workspaces: 🟢 extra, explicitly deferred — single-scene localStorage key for V1, structured so a future multi-scene key scheme is additive (don't hardcode a single global key name in more than one place).
- PNG export: 1x/2x/3x scale, transparent-background toggle, dark-mode-background toggle, selection-only, embedded scene data (tEXt chunk).
- SVG export: valid standalone SVG, embedded scene data (as an SVG `<metadata>` or comment block), font references.
- Copy-as-image via Clipboard API.
- Open/save file: native file picker (File System Access API where available, `<input type=file>`/download-link fallback elsewhere).

## Architecture
```
packages/engine/src/persistence/
├── scene-schema.ts             JSON shape + schemaVersion constant
├── migrations.ts                 migration registry, applyMigrations(json)
├── serialize-scene.ts             Scene -> JSON, JSON -> Scene
└── local-storage-autosave.ts      debounced save/restore
packages/engine/src/export/
├── export-to-png.ts               offscreen render -> PNG blob, tEXt chunk embed
├── export-to-svg.ts               offscreen render -> SVG string (rough.js SVG mode)
├── png-chunk-writer.ts             minimal tEXt chunk writer (hand-rolled, no dependency)
└── copy-as-image.ts                Clipboard API wrapper
```

## Related Code Files
- Create: all files listed in Architecture, each with `.test.ts`
- Modify: `packages/engine/src/scene/scene.ts` (expose `toJSON()`/`fromJSON()` delegating to `serialize-scene.ts`)
- Modify: `packages/engine/src/render/static-layer.ts` (expose a reusable "render to arbitrary canvas at arbitrary camera" entry point that both live rendering and export share — no duplicated rendering logic)

## Implementation Steps
1. Define `scene-schema.ts` (`schemaVersion = 1` constant, full JSON shape) and `migrations.ts` (empty registry, ready for `2: (json) => ...` entries later).
2. Implement `serialize-scene.ts`: `Scene.toJSON()` strips soft-deleted (`isDeleted`) elements by default for export, but autosave/localStorage keeps tombstones (needed for potential future undo-across-reload — decide explicitly and comment why the two serialization modes differ).
3. Implement `local-storage-autosave.ts`: debounced (e.g. 1s) write on scene subscription callback; restore path called once at app boot.
4. Refactor `static-layer.ts` to expose a shared `renderSceneToCanvas(ctx, scene, camera, viewportSize)` function; both live rendering and export call this — no copy-pasted rendering logic (DRY).
5. Implement `export-to-png.ts`: create offscreen canvas sized per scale/selection-bounds, call the shared render function, `canvas.toBlob()`, then `png-chunk-writer.ts` injects a `tEXt` chunk with the serialized scene JSON before returning the final blob.
6. Implement `export-to-svg.ts`: iterate visible/selected elements, use rough.js's `generator.toPaths()` (SVG path-data mode) instead of canvas drawing, assemble an SVG string with embedded metadata.
7. Implement `copy-as-image.ts`: reuse `export-to-png.ts`'s blob, `navigator.clipboard.write([new ClipboardItem({'image/png': blob})])`.
8. Implement open/save: File System Access API (`showSaveFilePicker`/`showOpenFilePicker`) with a `<input>`/download-link fallback for browsers without it (explicit feature-detection branch, not a silent failure).
9. Unit tests: round-trip serialize→deserialize produces an identical scene; migration registry applies correctly given a fixture "old schema" JSON; PNG tEXt chunk written and re-read back correctly (round-trip test on the chunk writer itself).

## Todo List
- [ ] Scene JSON schema + migration registry scaffolded (even if only version 1 exists so far)
- [ ] localStorage autosave/restore working
- [ ] PNG export: scales, transparent/dark bg, selection-only, embedded scene data
- [ ] SVG export: valid output, embedded scene data, rough.js SVG-mode reused (not reimplemented)
- [ ] Copy-as-image working via Clipboard API
- [ ] Open/save file working (File System Access API + fallback)
- [ ] Round-trip serialize/deserialize test green

## Success Criteria
- Reload the browser tab — scene restores exactly from localStorage.
- Export PNG at 2x with embedded scene, drag that PNG back into the app (open flow), scene re-imports identically.
- Export SVG opens correctly in a browser/image viewer with sketchy rendering intact.
- **M1 Solo MVP milestone formally closes here**: phases 01–11 together deliver a fully usable, saveable, exportable solo whiteboard.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PNG tEXt chunk writer has a subtle bug (wrong CRC, chunk ordering) corrupting exported files | Medium | Medium | Round-trip unit test (write then re-read own chunk) plus a manual check that exported PNGs open correctly in standard image viewers, not just re-imported by this app |
| localStorage quota exceeded on large scenes with many embedded images | Medium | Medium | Files map (phase 09) already isolates large binaries; consider warning the user near quota rather than silently failing — flagged for this phase's UI hook, full warning UI itself lands in phase 12 |
| SVG font embedding gap makes exported SVGs render with fallback fonts on other machines | Medium | Low (marked 🟡 not blocking) | Documented limitation, tracked as a follow-up within this phase, not silently dropped from scope |

## Security Considerations
- SVG export must escape all user text content when building SVG markup as a string (XSS-adjacent risk if the exported SVG is ever re-opened in a browser context) — explicit escaping utility, unit tested with a fixture containing `<script>`-like text content.
- Embedded scene JSON in PNG/SVG is plaintext (not sensitive by default — same trust level as the scene itself); no additional encryption needed here (encryption is scoped to share links, phase 13).

## Next Steps
- Blocks: 12 (UI chrome wires export/save buttons), 13 (share links reuse `serialize-scene.ts`'s JSON as the payload to encrypt), 14 (collab reuses the same JSON schema as the initial-load/snapshot format).
- Rollback: JSON schema is versioned from day one specifically so this phase's format can evolve without breaking already-saved user scenes — rollback of a bad migration means adding a corrective migration, not deleting user data.

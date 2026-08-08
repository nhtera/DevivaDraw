# Phase 09 — Image Elements

## Context Links
- `plans/reports/research-260808-full-feature-scope-excalidraw-parity.md` §7 (Images)
- Depends on: `phase-02-core-element-model-scene-store-history.md`, `phase-03-canvas-renderer-dual-layer-viewport.md`, `phase-04-input-pipeline-and-tools-state-machine.md`

## Overview
- **Priority:** 🟡 parity
- **Status:** pending
- Implement image elements: insert via toolbar/paste/drag-drop, stored as a binary "files" map referenced by `fileId` (not inlined into every element), resizable, with SVG-paste support.

## Key Insights
- Files map indirection (`element.fileId -> Scene.files[fileId] = {mimeType, dataURL, createdAt}`) rather than storing image data directly on the element is required for two reasons that matter later: (1) phase 11 export/persistence serializes files separately so JSON scene files don't balloon with duplicate base64 if the same image is used twice, (2) phase 14 collab syncs files as a distinct payload (large binary, different sync cadence than element deltas) — get the indirection right now, it's a schema decision that's expensive to retrofit.
- Paste handling must distinguish: image file paste (clipboard `items` with `type` starting `image/`), SVG paste (text `image/svg+xml` or plain SVG markup — rendered as an image element, not parsed into native shapes; parsing SVG into editable elements is out of scope/YAGNI), and internal element paste (copy/paste of Deviva Draw elements themselves, which is phase 10's clipboard concern, not this phase's).
- Drag-drop from OS file system reuses the same `files` map insertion path as toolbar-insert and paste — one `insertImageFile(blob)` engine function, three UI entry points calling it (toolbar file picker in phase 12, paste handler here, drop handler here).
- No cropping in V1 (marked 🟢 extra in the feature inventory, explicitly deferrable) — resize only, via phase 10's generic transform handles once that phase exists; this phase just needs the image element to report correct aspect-ratio-lockable bounds.

## Requirements
- `ImageElement`: `fileId, width, height` (+ base fields); no inline pixel data on the element itself.
- `Scene.files: Map<fileId, {mimeType, dataURL}>` alongside the element list — files are logically part of the scene but stored/synced separately.
- `insertImageFile(blob): {element, fileId}` engine function: reads blob as dataURL, generates fileId, inserts into `Scene.files` and creates an `ImageElement`.
- Paste handler: image blob → `insertImageFile`; SVG text → wrap as a data URL image blob → `insertImageFile`.
- Drag-drop handler: same `insertImageFile` path.
- Image renderer: draws `HTMLImageElement` (decoded from the files map) into the canvas at the element's bounds, respecting rotation.

## Architecture
```
packages/engine/src/images/
├── files-map.ts             Scene.files storage + fileId generation
├── insert-image-file.ts      shared insertion path for toolbar/paste/drop
└── image-decode-cache.ts     dataURL -> decoded HTMLImageElement cache (decode once, reuse across renders)
packages/engine/src/render/image-renderer.ts
packages/react/src/hooks/use-paste-and-drop.ts   DOM paste/drop event wiring (React-layer, like phase 07's text overlay)
```

## Related Code Files
- Create: `packages/engine/src/images/files-map.ts`, `.test.ts`
- Create: `packages/engine/src/images/insert-image-file.ts`, `.test.ts`
- Create: `packages/engine/src/images/image-decode-cache.ts`
- Create: `packages/engine/src/render/image-renderer.ts`
- Modify: `packages/engine/src/elements/element-types.ts` (add `ImageElement`)
- Modify: `packages/engine/src/scene/scene.ts` (add `files` map alongside elements)
- Create: `packages/react/src/hooks/use-paste-and-drop.ts`

## Implementation Steps
1. Extend `Scene` with a `files: Map<string, StoredFile>` alongside elements; ensure it's included in the scene's subscription/version signal (image insertion should trigger a redraw same as any element change).
2. Implement `files-map.ts` (fileId generation via crypto random, get/set/has) and `insert-image-file.ts` (blob → dataURL via `FileReader`, register in files map, create `ImageElement` sized to the image's natural dimensions).
3. Implement `image-decode-cache.ts`: lazily decode each dataURL into an `HTMLImageElement` once, cache by fileId, so the static-layer renderer (phase 03) doesn't redecode every frame.
4. Implement `image-renderer.ts`: draw the cached decoded image at element bounds/rotation.
5. Implement `use-paste-and-drop.ts` in `packages/react`: `paste` event → detect `image/*` or SVG clipboard items → `insertImageFile`; `drop` event → same for dropped files.
6. Unit tests: files-map fileId uniqueness, insert-image-file produces correctly-sized element from a fixture image, SVG-paste wraps correctly as a data URL.

## Todo List
- [ ] `Scene.files` map added, included in change notifications
- [ ] `insert-image-file` shared path implemented and tested
- [ ] Image decode cache implemented (no redundant decodes per render)
- [ ] Image renderer draws correctly at bounds/rotation
- [ ] Paste (image + SVG) and drag-drop wired in `packages/react`
- [ ] Toolbar insert entry point stubbed (real toolbar UI is phase 12 — this phase exposes the function it will call)

## Success Criteria
- Dev harness: paste a PNG from clipboard, drag-drop a PNG from Finder/Explorer, paste SVG markup — all three render on canvas.
- Same image pasted twice reuses one `files` map entry (verified via a test asserting fileId reuse when byte-identical, or explicitly documented as "not deduped in V1" if dedup is cut for scope — decide and state the choice in code comments, don't leave it ambiguous).
- Unit tests green.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Large images bloat scene JSON size (base64 dataURL) once persistence (phase 11) and collab (phase 14) exist | Medium | Medium | Files-map indirection already isolates this to one payload type; phase 11/14 can apply size limits or R2-backed storage for large files without touching element schema |
| SVG paste executes embedded scripts if rendered as live SVG rather than rasterized image | Low | High (XSS) | Render pasted SVG as a rasterized `<img>`/canvas draw (data URL image), never as inline `dangerouslySetInnerHTML` SVG DOM — decided here explicitly as a security requirement, not an incidental implementation detail |

## Security Considerations
- Pasted/dropped SVG must never be injected as live DOM (script execution risk) — always decoded through `Image()`/canvas, never `innerHTML`. Documented above as a hard requirement, verify in code review.
- File size sanity limit on paste/drop (reject or warn above a configurable threshold, e.g. 10MB) to avoid a single paste freezing the tab — exact threshold is a product decision, default conservatively and make it configurable.

## Next Steps
- Blocks: 10 (resize handles apply to images), 11 (files map serializes alongside elements), 14 (files sync separately from element deltas).
- Rollback: additive — revert commit.

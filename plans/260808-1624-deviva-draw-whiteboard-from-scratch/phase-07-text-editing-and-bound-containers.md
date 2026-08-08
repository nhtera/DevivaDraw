# Phase 07 — Text Editing & Bound Containers

## Context Links
- `plans/reports/research-260808-full-feature-scope-excalidraw-parity.md` §5 (Text)
- `deviva/apps/web/components/extract-canvas-diagram.ts` (`readLabel` — the diagram-extraction contract expects a plain-text label readable off any node-like element; this phase's text model must support that read path)
- Depends on: `phase-04-input-pipeline-and-tools-state-machine.md`, `phase-05-shape-tools-and-style-system.md`

## Overview
- **Priority:** 🔴 blocking (MVP) — text is required for the diagram-extraction use case that motivates the deviva.app integration (phase 15)
- **Status:** pending
- Implement standalone text elements with WYSIWYG overlay editing, plus text bound inside containers (rect/ellipse/diamond) with auto-grow and wrapping. Establishes font loading/measurement used by every text-bearing feature after this (arrow labels in phase 08).

## Key Insights
- WYSIWYG editing uses a real HTML `<textarea>` positioned absolutely over the canvas, matching the element's screen position/rotation/zoom (via phase 03's `sceneToScreen`) — this is the standard technique (native browser text input/IME/spellcheck instead of hand-rolled canvas text editing, which is a well-known rabbit hole). The textarea is swapped for the canvas-rendered text on blur/Escape.
- **Font licensing is an open blocker, not a code task**: Excalifont (Excalidraw's hand-drawn font) is OFL-licensed — redistribution terms under a new brand need verification, or a Deviva-commissioned/substitute hand-drawn font is needed before this phase's "hand-drawn" font option ships. Flagged in `plan.md` unresolved questions; this phase proceeds with the "normal" and "code" font families (both have unambiguous open licenses, e.g. a standard sans-serif + a monospace) and treats the hand-drawn family as a swappable font-family slot, not a hard dependency.
- Container auto-grow: when text is bound inside a rect/ellipse/diamond, the container resizes to fit wrapped text (vertical growth), and conversely, resizing the container reflows text wrap width — a two-way relationship implemented via the `boundElements` field (phase 02) linking container ↔ text element, updated by both the container-resize path (phase 10, hook added here) and the text-edit path (this phase).
- Text measurement uses `CanvasRenderingContext2D.measureText` for wrapping — must load the target font via `FontFace` API and await `document.fonts.ready` before measuring, or wrapping is computed against a fallback font and looks wrong for one frame (or permanently, if measurement happens before font load completes — a common bug).
- Diagram-extraction contract (from `extract-canvas-diagram.ts`): a node-like element must expose a plain-text label. This phase's `TextElement.text` (and bound-text's container-side accessor) directly satisfies that; no special-casing needed if the element model exposes `getLabel(element)` uniformly — worth adding as a small engine utility now so phase 15's scene-read API is trivial.

## Requirements
- `TextElement`: `text (raw string), fontFamily (normal|code|hand-drawn-slot), fontSize (S|M|L|XL), textAlign (left|center|right), containerId (nullable — set when bound)`.
- Standalone text tool: click to place cursor, type, click-away/Escape commits.
- WYSIWYG overlay: `<textarea>` synced to element position/rotation/zoom; IME-safe (don't commit on every keystroke, commit on blur/explicit finish).
- Bound text: double-click inside a rect/ellipse/diamond enters text-edit mode for a bound `TextElement`; container auto-grows vertically; text wraps to container width minus padding.
- Font loading utility: loads the 2 (initially) font families via `FontFace`, exposes a `fontsReady` promise gating text measurement/render.
- `getLabel(element)` utility: returns the plain-text label for any element type that can carry one (text, bound-text-container, later: arrow with bound label in phase 08).

## Architecture
```
packages/engine/src/text/
├── text-measurement.ts     font loading + measureText wrapping algorithm
├── bound-text.ts           container<->text linking, auto-grow, wrap-on-resize hook
└── get-label.ts            uniform label read used by extraction (phase 15) and arrows (phase 08)
packages/engine/src/tools/text-tool.ts
packages/react/src/components/text-editor-overlay.tsx   the actual <textarea>, first React-layer component (React bindings start here since native DOM text input is inherently a DOM/React concern, not engine-internal)
```
This is the first phase where `packages/react` gets real content — text editing needs a real DOM overlay element, which is naturally React's job even though the engine stays framework-agnostic for everything else.

## Related Code Files
- Create: `packages/engine/src/text/text-measurement.ts`, `.test.ts`
- Create: `packages/engine/src/text/bound-text.ts`, `.test.ts`
- Create: `packages/engine/src/text/get-label.ts`, `.test.ts`
- Create: `packages/engine/src/tools/text-tool.ts`, `.test.ts`
- Modify: `packages/engine/src/elements/element-types.ts` (add `TextElement`, add `containerId`/`boundElements` wiring)
- Create: `packages/react/src/components/text-editor-overlay.tsx`
- Create: `packages/react/src/hooks/use-text-editing.ts`

## Implementation Steps
1. Add `TextElement` to the union; add font-loading utility (`FontFace` for 2 initial families, `fontsReady` promise).
2. Implement `text-measurement.ts`: word-wrap algorithm using `measureText`, given a max width, returns wrapped lines + total height.
3. Implement `text-tool.ts`: click-to-place creates an empty `TextElement`, hands off to the (React-layer) overlay for editing.
4. Implement `text-editor-overlay.tsx` in `packages/react`: absolutely-positioned `<textarea>` synced via `sceneToScreen` + camera zoom (font-size scales with zoom), commits text to `Scene` on blur/Escape/Enter-outside-shift.
5. Implement `bound-text.ts`: double-click inside a container creates/edits a bound `TextElement`, links via `containerId`/`boundElements`, recomputes container height on text change (calls into `Scene.updateElement` for the container's height — this is the auto-grow).
6. Implement `get-label.ts`: `getLabel(element): string` — text element returns `.text`, shape-with-bound-text returns the bound text's `.text`, everything else returns `""`.
7. Unit tests: wrap algorithm correctness (known strings at known widths), auto-grow height math, `getLabel` covers all current element types.

## Todo List
- [ ] Font loading + `fontsReady` gating implemented
- [ ] Text measurement/wrap algorithm implemented and unit tested
- [ ] Standalone text tool + WYSIWYG overlay working (position/zoom/rotation synced)
- [ ] Bound text: double-click-to-edit inside shapes, auto-grow vertical, wrap on container resize hook in place
- [ ] `getLabel` utility implemented and tested for all current element types
- [ ] Hand-drawn font treated as swappable slot, not hard dependency (license blocker documented, not silently worked around)

## Success Criteria
- Dev harness: create standalone text, edit it, see it render on canvas after blur.
- Dev harness: double-click a rectangle, type multi-line text, container visibly grows to fit.
- Unit tests green for wrap algorithm and `getLabel`.
- Zoom to 200%, edit text — overlay textarea font size and position stay pixel-aligned with the underlying canvas element (manual check).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hand-drawn font licensing unresolved blocks shipping the signature Excalidraw-like look | High (open question) | Medium (cosmetic, not functional) | Ship with normal/code fonts now; swap in licensed/commissioned font later behind the same `fontFamily` slot — zero code rework needed |
| Textarea-overlay position drifts from canvas render under rotation | Medium | Medium | Reuse phase 03's exact `sceneToScreen` transform for the overlay's CSS transform, not a hand-rolled approximation |
| IME composition (CJK/Vietnamese diacritics) breaks with naive `onChange` commit-per-keystroke | Medium | Medium (VI is a required i18n language per phase 12) | Commit only on blur/explicit finish, not per-keystroke; test with Vietnamese diacritic input specifically since VI is a locked requirement |

## Security Considerations
- Text content is user input rendered later as SVG/export (phase 11) — ensure no raw HTML injection path exists (canvas text rendering via `fillText`/measureText is inherently safe; SVG export in phase 11 must escape text content when building SVG markup).

## Next Steps
- Blocks: 08 (arrow-bound labels reuse `bound-text.ts`/`get-label.ts`), 10 (resize must trigger bound-text rewrap), 15 (scene-read API for deviva.app leans directly on `getLabel`).
- Rollback: additive — revert commit.

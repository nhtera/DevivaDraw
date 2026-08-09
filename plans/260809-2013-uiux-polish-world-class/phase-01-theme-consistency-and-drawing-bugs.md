# Phase 01 — Theme Consistency & Drawing Bugs (P0)

**Status:** Not started · **Priority:** P0 (this IS the user-reported bug)
**Context:** Research report F1, F2 · fixes "line and text drawing bugs" + dark-mode brokenness.

## Problem (verified)
The `canvasBackground` theme token is never painted on the live canvas — the canvas host is transparent → browser white. When the theme resolves to **dark**, element colors invert to light (`#1e1e1e`→`#e9ecef`) for a dark canvas that never renders, so strokes/text are light-on-white = invisible. The text-edit overlay backs with the dark token but colors text with the raw un-inverted stroke → black-on-black, and its width never grows.

## Requirements
- Canvas surface shows the active theme's `canvasBackground` in both modes.
- Newly drawn strokes and typed/committed text are clearly visible in dark mode.
- Text-edit overlay: text color == the color the canvas will render (theme-adapted); backing == real canvas background; textarea sizes to content width.
- Light mode visually unchanged. No regression to export (export already passes its own `background` explicitly).

## Related Code Files
- `packages/react/src/deviva-draw-shell.tsx` — apply `tokens.canvasBackground` to the canvas host div (the single, simplest fix for the surface).
- `packages/react/src/hooks/use-text-editing.ts:70,109` — text `color` must use `adaptStrokeColorForTheme(strokeColor, mode)`; `backgroundColor` already themed; add content-width sizing.
- `packages/react/src/components/text-editor-overlay.tsx` — grow width (mirror the existing height auto-grow, or `white-space:pre` + intrinsic sizing).
- `packages/react/src/theme/canvas-color-inversion.ts` — reuse `adaptStrokeColorForTheme` (exported already).
- (Verify) `packages/engine/src/render/*` — confirm host-div background is sufficient; only paint on-canvas background if the host approach leaves seams during export/hi-dpi.

## Implementation Steps
1. Set canvas host `style.background = var(--dd-canvas-background)` (or `tokens.canvasBackground`) in `deviva-draw-shell.tsx`. Re-check `canvasHostBg` is no longer transparent.
2. In `use-text-editing.ts`, thread the active `ThemeMode` in and set overlay text color to `adaptStrokeColorForTheme(element.strokeColor, mode)`.
3. Auto-size textarea width to content (reset-then-measure like the height effect, or shrink-to-fit).
4. Manual repro in dark mode: draw line → visible; type text → visible & matches committed render; box background matches canvas.
5. Confirm light mode identical to before.

## Todo
- [ ] Canvas host paints `canvasBackground` (dark canvas in dark mode)
- [ ] Line/shape strokes visible in dark mode
- [ ] Text overlay color theme-adapted (WYSIWYG vs committed)
- [ ] Textarea grows to content width (no thin black bar)
- [ ] Light mode unchanged; export background unaffected
- [ ] Existing engine + react tests green; add a regression test asserting host bg == token per mode

## Success Criteria
Dark-mode: drawn line and typed text are legible; text box blends with canvas. Re-run the F1/F2 live probes → `canvasHostBg` non-transparent, overlay `color` ≠ `background`.

## Risks
- Element-color inversion already exists for committed render; ensure overlay uses the **same** function so edit == result. Low risk, single source (`canvas-color-inversion.ts`).
- Hi-DPI/export: host-div bg won't appear in canvas exports — that's correct (export passes its own `background`); do not double-paint.

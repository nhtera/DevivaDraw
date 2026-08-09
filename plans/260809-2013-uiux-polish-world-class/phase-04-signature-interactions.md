# Phase 04 — Signature Interactions (P2)

**Status:** Not started · **Priority:** P2
**Context:** The touches that make competitors feel premium. Additive; no P0 dependency beyond Phase 03 tokens.

## Deliverables

### 4.1 Color picker popover (Excalidraw parity)
Current: flat swatch row. Target: popover on swatch click with
- palette grid (optionally keyboard-letter quick-select),
- **shades** row for the active hue,
- **hex input** (typed + validated),
- **eyedropper** (`EyeDropper` API where supported, feature-detected).
- Files: `components/color-picker.tsx` (+ a `color-picker-popover.tsx` if > 200 lines). Reuse `styleState.getRecentColors()`.

### 4.2 Contextual selection toolbar (tldraw-style)
When ≥1 element selected, a small floating action bar (duplicate / delete / layer / link) near the selection or docked — quick actions without traveling to the panel.
- Files: new `components/selection-action-bar.tsx`; mount in `deviva-draw-shell.tsx` gated on `selection.size > 0`; reuse existing `layer-actions-section.tsx` handlers + `actions/*`.

### 4.3 Surfaced theme toggle + follow-system
Expose light/dark/system toggle in the UI (top bar or main menu). Persist preference (theme storage already exists); default = follow system.
- Files: `top-bar.tsx` or `main-menu.tsx`, `theme/theme-provider.tsx`, `theme/theme-storage.ts`.

### 4.4 Contextual hints
Excalidraw-style top hint line ("Enter to add text", "hold Shift to constrain"). Subtle, dismissible, i18n.
- Files: new `components/canvas-hint.tsx`; drive from active tool via `toolStateMachine`.

## Implementation Steps
1. Build color-picker popover; feature-detect eyedropper; validate hex.
2. Build selection action bar; position from selection bbox (reuse camera/store math).
3. Add theme toggle control + persistence; verify embed can still force a theme via `theme` prop.
4. Add contextual hint component keyed off active tool; i18n strings (en+vi).

## Todo
- [ ] Color popover: shades + hex + eyedropper (feature-detected)
- [ ] Contextual selection action bar
- [ ] Theme toggle (light/dark/system) + persistence
- [ ] Contextual hints (en+vi)
- [ ] `<DevivaDraw/>` `theme`/`locale` props still authoritative for embedders

## Success Criteria
Color editing, quick selection actions, theme switching, and guidance all feel first-class and match/exceed competitors.

## Risks
- `EyeDropper` unsupported in some browsers → feature-detect, hide gracefully.
- Selection bar overlapping panel/toolbar → collision-aware placement.

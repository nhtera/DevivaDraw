# Phase 03 — Chrome Visual Language Refresh (P1)

**Status:** Not started · **Priority:** P1
**Context:** Make the chrome read as intentional next to Excalidraw/tldraw. Taste, not features.

## Requirements
Introduce a small, explicit design-token scale and apply it everywhere so the toolbar, panel, menus, and dialogs share one visual language.

## Token Scale (extend `theme-tokens.ts` + `chrome-styles.ts`)
- **Spacing:** 4 / 8 / 12 / 16 (already ad-hoc — formalize).
- **Radius:** control 8, button 6, pill/toolbar 10–12 (one scale, Shape Consistency Lock).
- **Shadow:** tinted to background hue, not pure black (`0 4px 16px rgba(15,16,20,.12)` light; deeper in dark). Replace the current `0 2px 12px rgba(0,0,0,.15)`.
- **Type:** section labels 11px secondary; control text 13px; consistent `font-feature-settings`. Consider `system-ui` display for numbers.
- **Elevation tiers:** toolbar/panel = elevated surface + border + shadow; popovers = one step higher.

## Component Restyle
- **Toolbar** (`toolbar.tsx`): tighter pill, subtle divider groups (select/pan | shapes | text/image), refined active state (soft accent tint, not full-saturation fill), hover = surface tint, `:active` = `scale(.96)` press.
- **Properties panel** (`properties-panel.tsx`): consistent section rhythm, hairline dividers between groups, segmented-control look for icon groups (shared background track + sliding active), opacity slider restyle.
- **Top bar / zoom** (`top-bar.tsx`): match radius/shadow; group undo/redo + zoom cleanly.
- **Menus/dialogs** (`main-menu.tsx`, `*-dialog.tsx`): apply the same tokens.

## Related Code Files
`theme-tokens.ts`, `chrome-styles.ts` (add spacing/radius/shadow/type helpers), `toolbar.tsx`, `properties-panel.tsx`, `style-section.tsx` (segmented look), `top-bar.tsx`, `main-menu.tsx`, dialogs, `components/mobile/bottom-toolbar.tsx`.

## Implementation Steps
1. Add token constants + helper style builders in `chrome-styles.ts`.
2. Refactor toolbar → grouped, dividers, refined active/hover/press.
3. Refactor panel → segmented icon groups (needs Phase 02 icons), consistent rhythm.
4. Sweep top bar, menus, dialogs, mobile toolbar for the same tokens.
5. Side-by-side screenshot review vs Excalidraw + tldraw, both themes.

## Todo
- [ ] Token scale defined (spacing/radius/shadow/type) in one place
- [ ] Toolbar restyled (groups, active/hover/press)
- [ ] Panel segmented-control look
- [ ] Top bar / zoom / menus / dialogs consistent
- [ ] Mobile bottom toolbar consistent
- [ ] Both-theme screenshot review passes

## Success Criteria
A neutral reviewer, shown deviva-draw beside Excalidraw/tldraw, cannot tell it is the "less polished" one.

## Risks
- Scope creep — keep to tokens + applying them; no new components here.
- Over-animation belongs to Phase 05, not here.

# Phase 02 — Iconography & Compact Properties Panel (P1)

**Status:** Not started · **Priority:** P1
**Context:** Research F3. Competitors use icon buttons; deviva-draw uses wrapping text labels → dated, cramped.

## Problem
`icon.tsx` has no style icons, so `style-section.tsx` renders text ("Hachure/Cross-hatch/Solid/Zigzag", "Thin/Bold/Extra bold", "Architect/Artist/Cartoonist", "Sharp/Round"). Long labels wrap; the panel looks classic and takes vertical space.

## Requirements
- Every discrete style control is an **icon button** with a `title` + `aria-label` tooltip (accessibility + discoverability preserved).
- One icon family, one strokeWidth, consistent 20–24px hit targets.
- Panel becomes noticeably more compact; no wrapping.

## New Icons (add to `icon.tsx`, hand-authored SVG, matching existing style)
- Fill: `fill-hachure`, `fill-cross-hatch`, `fill-solid`, `fill-zigzag`
- Stroke width: `stroke-width-thin`, `stroke-width-bold`, `stroke-width-extra-bold` (line-weight glyphs)
- Stroke style: `stroke-style-solid`, `stroke-style-dashed`, `stroke-style-dotted`
- Sloppiness: `sloppiness-architect`, `sloppiness-artist`, `sloppiness-cartoonist` (increasingly wavy line)
- Edges: `edge-sharp`, `edge-round`
- Arrowheads (already text?): `arrowhead-*` as needed

## Related Code Files
- `packages/react/src/components/icon.tsx` — add the icon set (keep < 200 lines; split to `icon-style-glyphs.tsx` if needed).
- `packages/react/src/components/style-section.tsx` — accept optional `icon` per option; render `<Icon/>` with `title=label`, fall back to text when no icon.
- `packages/react/src/components/properties-panel.tsx` — pass icon names per option; keep i18n labels as tooltips.
- `packages/react/src/components/type-style-sections.tsx` — same treatment for text/arrow extras.
- Keep `data-testid`s stable (e2e depends on `stroke-width-thin` etc.).

## Implementation Steps
1. Author icons; unit-render smoke test (each name resolves to an `<svg>`).
2. Extend `StyleOption` with `icon?: IconName`; render icon+tooltip, text fallback.
3. Wire icons in `properties-panel.tsx` / `type-style-sections.tsx`; keep labels as `title`.
4. Verify existing e2e selectors still pass (testids unchanged).
5. Screenshot both themes; compare density vs before.

## Todo
- [ ] Style icons added, one family/strokeWidth
- [ ] `StyleSection` supports icon + tooltip, text fallback
- [ ] Properties panel + type/arrow sections use icons
- [ ] i18n labels preserved as tooltips + aria-label
- [ ] testids stable; e2e green
- [ ] Panel visibly more compact, zero wrapping

## Success Criteria
No text-label style buttons remain; panel height drops; screen readers still announce each control by its label.

## Risks
- Accessibility regression if tooltips/aria dropped → mandatory `title`+`aria-label`.
- Icon legibility at small size → test at 100% and 200% zoom.

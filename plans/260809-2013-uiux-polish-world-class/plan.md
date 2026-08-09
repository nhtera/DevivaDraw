# Plan: Deviva-Draw World-Class UI/UX Polish

**Created:** 2026-08-09 · **Baseline:** commit 4c16205 (feature-complete, phases 01–15)
**Goal:** Match then beat Excalidraw/tldraw on look & feel. Not a rebuild — a taste + consistency upgrade.
**Research:** `plans/reports/research-260809-competitor-uiux-deep-dive.md`

## Design Read
Product tool (creative canvas), not a landing page. Audience = pro/prosumer diagrammers.
Language: **clean, icon-driven, light-consistent chrome + restrained spring motion.** Dials: variance 4 / motion 4 / density 4. Avoid AI tells (no purple glow, no em-dash, icons from one family, WCAG AA).

## The Core Insight
The "line and text drawing bugs" + "classic look" are mostly **one theme-consistency defect** plus **missing icons**. Fixing Phase 01 alone removes the broken feeling; Phases 02–03 deliver the modern look.

## Phases

| # | Phase | Priority | Status | Fixes / Delivers |
|---|-------|----------|--------|------------------|
| 01 | [Theme consistency & drawing bugs](phase-01-theme-consistency-and-drawing-bugs.md) | P0 | ✅ Done (bd95f40) | canvas bg + adapted defaults + text overlay + drag-to-draw lines |
| 02 | [Iconography & compact properties panel](phase-02-iconography-and-compact-panel.md) | P1 | ✅ Done (ab7d442) | SVG icon glyphs for fill/width/style/sloppiness/edges/align/arrowheads |
| 03 | [Chrome visual language refresh](phase-03-chrome-visual-language.md) | P1 | ✅ Done (c76dfb9) | soft active state, tinted shadow, radius scale, toolbar groups, SVG tool icons |
| 04 | [Signature interactions](phase-04-signature-interactions.md) | P2 | ✅ Done (a039184) | color popover (shades/hex/eyedropper) + contextual hints; theme toggle already in menu; selection action bar deferred (redundant w/ always-visible panel) |
| 05 | [Motion, a11y & cross-theme QA](phase-05-motion-a11y-qa.md) | P2 | ✅ Done (f6a686f) | injected stylesheet: hover/focus-visible/press + reduced-motion; AA contrast; e2e |

## Sequencing & Dependencies
- **01 first, non-negotiable** — it is the actual bug the user sees; everything else is cosmetic on top.
- 02 depends on 03's icon-family decision (do 03's token/icon foundation setup, then 02, then 03 restyle) — or run 02+03 together as one "visual system" push.
- 04 and 05 are independent; can parallelize after 03.

## Definition of Done (whole plan)
- Dark mode: canvas dark, strokes/text visible, text-edit box matches canvas. Light mode unchanged.
- Zero text-label style controls; all icon buttons with `title`/`aria-label` tooltips.
- Chrome reads as intentional next to Excalidraw/tldraw (side-by-side screenshot review).
- Motion honors `prefers-reduced-motion`; all chrome passes WCAG AA contrast in both themes.
- All existing gates green (engine/react/collab/e2e), plus new Playwright visual checks in both themes.

## Constraints (locked)
- No new heavy deps (no Tailwind/CSS-in-JS runtime) — inline styles + CSS vars stay, per existing `chrome-styles.ts` convention. Icons: extend the existing hand-authored `icon.tsx` set (one family, one strokeWidth).
- Keep files < 200 lines; kebab-case names.
- Both a **web** app and an embeddable **lib** must stay working — verify `<DevivaDraw/>` props unchanged.

# Phase 05 — Motion, Accessibility & Cross-Theme QA (P2)

**Status:** Not started · **Priority:** P2 (final pass)
**Context:** The layer that turns "clean" into "premium," plus the gate that prevents regressions.

## 5.1 Motion (restrained, motivated)
Every animation must justify itself (feedback / hierarchy / state transition) — no motion for show.
- Button/tool press: `scale(.96)` on `:active`; hover surface tint transitions ~120ms.
- Popover/menu/dialog enter: fade+slight-scale spring (~150–200ms), exit faster.
- Selection action bar + hints: fade/slide in.
- Panels: subtle transition when switching selection.
- Implementation: CSS transitions/`@keyframes` (no motion-lib dependency — matches no-runtime constraint). Animate only `transform`/`opacity`.

## 5.2 Reduced motion (mandatory)
All of 5.1 collapses to instant under `@media (prefers-reduced-motion: reduce)`.

## 5.3 Accessibility
- WCAG AA contrast for all chrome text/icons/active states in **both** themes (audit tokens; fix any that fail).
- Focus-visible rings on all interactive chrome (keyboard nav).
- Every icon button has `aria-label` (from Phase 02) + `aria-pressed` where toggled.
- Verify tab order through toolbar → panel → dialogs.

## 5.4 Cross-theme QA + visual regression
- Manual matrix: {light, dark, system} × {draw shape, draw line, add text, select, color pick, collab} → all legible, no theme seams.
- Add Playwright checks (extend `apps/web` e2e): assert canvas host bg == token per theme; assert drawn line/text visible (pixel or DOM probe); capture toolbar/panel screenshots for both themes.
- Re-run full gate: engine + react + collab-client + collab-server + web e2e.

## Related Code Files
`chrome-styles.ts` (transition helpers + reduced-motion), all chrome components (focus-visible), `apps/web` Playwright specs, `theme-tokens.ts` (contrast fixes).

## Todo
- [ ] Press/hover/popover motion (transform+opacity only)
- [ ] `prefers-reduced-motion` collapses all motion
- [ ] WCAG AA contrast verified both themes; failures fixed
- [ ] Focus-visible rings + aria complete
- [ ] Cross-theme manual matrix passes
- [ ] Playwright: canvas-bg + visibility assertions both themes
- [ ] Full gate suite green

## Success Criteria
Feels alive but calm; fully usable with reduced motion; passes AA in both themes; CI proves the F1/F2 bugs cannot silently return.

## Risks
- Motion jank on low-end/mobile → keep durations short, transform/opacity only.
- Contrast fixes may nudge brand colors → keep accent recognizable, adjust neutrals first.

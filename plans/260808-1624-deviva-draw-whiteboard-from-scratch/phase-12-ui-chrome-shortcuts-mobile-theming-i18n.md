# Phase 12 — UI Chrome, Shortcuts, Mobile/Touch, Theming & i18n

## Context Links
- `plans/reports/research-260808-full-feature-scope-excalidraw-parity.md` §11 (UI Chrome — "mobile/touch major effort, often underestimated")
- Depends on: `phase-10-selection-transforms-snapping-grid.md`, `phase-11-persistence-and-export.md` (UI wires to both)

## Overview
- **Priority:** 🔴→🟡 (toolbar/panels are MVP-usability; command palette/shape libraries are parity extras)
- **Status:** pending
- Build the full React UI layer: toolbar, properties panel, context menu, main menu, shortcuts dialog, command palette; complete the keyboard shortcut map; responsive mobile/touch layout; dark/light theming (canvas-aware, not just chrome); i18n framework with EN+VI.

## Key Insights
- This phase is where `packages/react` becomes a real component library, not just the two DOM-overlay components from phases 07/09 — every engine capability built in phases 02–11 needs a UI affordance here. Treat this as "wire existing engine functions to buttons," not new logic — resist the temptation to add engine features while building UI (scope discipline; if a UI need reveals a missing engine capability, that's a small targeted addition, not a redesign).
- Mobile/touch is explicitly flagged by the research as commonly underestimated — budget it as its own internal milestone within this phase (like phase 10's three-milestone split): (a) responsive layout breakpoints + bottom toolbar, (b) pinch-zoom/two-finger-pan gesture recognition on top of phase 04's pointer pipeline, (c) long-press context menu. Don't treat "responsive CSS" as equivalent to "mobile support" — the gesture layer is the hard part.
- Dark/light theme must invert canvas colors intelligently (e.g., a pure-black stroke on white background should not simply invert to pure-white-on-black if the user picked black deliberately for print/export purposes) — Excalidraw's approach (and the one to replicate conceptually, not copy code) is a canvas-background-only theme swap with a smart default-palette adjustment, while user-chosen explicit colors are preserved. Get this rule right or dark mode looks broken on any scene with custom colors.
- i18n: EN+VI minimum (locked requirement). Use a lightweight i18n approach (a small message-catalog + `t(key, params)` function) rather than pulling in a heavy i18n framework — this app's UI string surface is moderate (toolbar labels, menu items, dialogs), a full framework (e.g. i18next) is likely more than needed (YAGNI check: revisit only if plural/gender rules or RTL are needed — RTL is marked 🟢 extra, explicitly not V1). Vietnamese diacritic rendering was already validated in phase 07's text-editing IME work — reuse that confidence, don't re-litigate font rendering here.
- Command palette (🟡) is a searchable action list over the same action registry the toolbar/shortcuts/menus already call — build one `ActionRegistry` (id, label, shortcut, handler, icon) that toolbar buttons, menu items, shortcut bindings, and the command palette all read from, instead of four separate wiring paths (DRY — this is the natural single source of truth for "every action in the app").

## Requirements
- `ActionRegistry`: central action definitions (id, i18n label key, icon, shortcut, `run(scene, selection)` handler, `isEnabled(selection)` predicate).
- Toolbar: tool selection (all tools from phases 05, 06, 07, 08, 09), style quick-access.
- Properties panel: full style system from phase 05 (color pickers with palette + custom hex + recently-used, fill style, stroke width/style, opacity, roundness) + per-type extras (font for text, arrowheads for arrows).
- Context menu (right-click): selection-aware actions (delete, duplicate, group/ungroup, z-order, copy/paste, lock).
- Main menu: open/save/export (phase 11), theme toggle, language toggle, help/shortcuts dialog, reset canvas.
- Shortcuts dialog: renders the full `ShortcutRegistry` (phase 04, populated fully here) as a searchable reference.
- Command palette: fuzzy-searchable `ActionRegistry` list, keyboard-navigable, triggered by `Ctrl/Cmd+K`.
- Mobile/touch: responsive breakpoint layout, bottom toolbar, pinch-zoom, two-finger pan, long-press context menu.
- Dark/light theme: canvas-aware color inversion rule (see Key Insights) + full UI chrome theming.
- i18n: message catalog (EN, VI), `t()` function, language switcher, locale persisted alongside theme preference.
- Zen mode, view-only mode, stats panel: 🟢 extras — implement as small toggles gated behind the same `ActionRegistry`/appState pattern, lowest priority within this phase's todo list.

## Architecture
```
packages/react/src/
├── actions/action-registry.ts        central action definitions
├── i18n/
│   ├── catalog-en.ts
│   ├── catalog-vi.ts
│   └── use-translation.ts
├── theme/theme-provider.ts            dark/light state + canvas-color-inversion rule
├── components/
│   ├── toolbar.tsx
│   ├── properties-panel.tsx
│   ├── context-menu.tsx
│   ├── main-menu.tsx
│   ├── shortcuts-dialog.tsx
│   ├── command-palette.tsx
│   └── mobile/                       bottom-toolbar.tsx, touch-gesture-adapter.ts
└── deviva-draw-app.tsx                the composed <DevivaDraw/> shell (toolbar + panel + canvas + menus)
```
Each component file kept under 200 lines — several of these (toolbar, properties panel) will need sub-component extraction (e.g. `color-picker.tsx`, `style-section.tsx` as children) rather than one large file.

## Related Code Files
- Create: all files under Architecture, plus their natural sub-components (color-picker, style-section, etc., extracted as soon as a file approaches 200 lines)
- Modify: `packages/engine/src/input/shortcut-registry.ts` (phase 04 scaffold, fully populated here)
- Modify: `packages/react/src/components/text-editor-overlay.tsx` (phase 07), `use-paste-and-drop.ts` (phase 09) — wired into the composed app shell here

## Implementation Steps
1. Build `ActionRegistry` and populate it with every action from phases 05–11 (tool switches, style changes, z-order, group/ungroup, align/distribute, duplicate, delete, export, open/save, theme toggle).
2. Build `i18n` catalog + `useTranslation` hook; extract every UI string through it from the start (no hardcoded English strings added "temporarily" — cheaper to do it inline than retrofit).
3. Build `ThemeProvider`: light/dark state, canvas background + smart default-palette swap rule, persisted via phase 11's localStorage pattern (new key, not reusing the scene-autosave key).
4. Build toolbar, properties panel, context menu, main menu, shortcuts dialog — each reads/writes through `ActionRegistry`/`Scene`, no direct engine-internals reach-around.
5. Build command palette: fuzzy search over `ActionRegistry`, `Ctrl/Cmd+K` trigger, keyboard nav.
6. Mobile milestone (a): responsive CSS breakpoints, bottom toolbar layout variant.
7. Mobile milestone (b): pinch-zoom + two-finger-pan gesture recognition layered on phase 04's `PointerEventPipeline` (multi-touch gesture detection is additive to, not a replacement of, the existing single-pointer gesture model).
8. Mobile milestone (c): long-press → context menu (touch equivalent of right-click).
9. Compose `<DevivaDraw/>` app shell combining canvas (phase 03), toolbar, panels, menus, overlays (phase 07/09).
10. Manual QA: full keyboard shortcut map cross-checked against §11's "power users notice every gap" warning — build a literal checklist from the feature inventory and verify each shortcut exists.
11. Component tests (Vitest + React Testing Library) for `ActionRegistry` wiring and `i18n` catalog completeness (a test asserting every key used in components exists in both EN and VI catalogs — prevents silent missing-translation gaps).

## Todo List
- [ ] `ActionRegistry` implemented, all phase 05–11 actions wired
- [ ] i18n catalog (EN+VI) complete, no hardcoded strings, catalog-completeness test passing
- [ ] Theme provider implemented with canvas-aware color inversion rule
- [ ] Toolbar, properties panel, context menu, main menu, shortcuts dialog, command palette implemented
- [ ] Full keyboard shortcut map populated and manually verified against feature inventory
- [ ] Mobile: responsive layout + bottom toolbar
- [ ] Mobile: pinch-zoom + two-finger pan gesture recognition
- [ ] Mobile: long-press context menu
- [ ] `<DevivaDraw/>` composed app shell assembled

## Success Criteria
- Every engine capability from phases 02–11 has a discoverable UI affordance (toolbar, panel, menu, or shortcut).
- Command palette finds and executes any action by fuzzy search.
- Switching language EN↔VI updates all chrome text with no missing-key fallback gaps (verified by the catalog-completeness test).
- On a touch device (or Chrome DevTools touch emulation), pinch-zoom/pan/long-press all function.
- Dark mode toggle: default-palette elements invert sensibly, explicitly-colored elements are preserved as-drawn.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Mobile gesture recognition conflicts with browser-native pinch-zoom/scroll | High (well-known web canvas app pitfall) | High | Explicit `touch-action: none` on the canvas container + `preventDefault` on the gesture pipeline's touch handlers, tested on real iOS/Android devices, not just DevTools emulation, before phase sign-off |
| Command palette/action registry drifts out of sync as later phases (13+) add new actions | Medium | Low | `ActionRegistry` is the single source of truth by construction (Key Insights) — phase 13/14 additions register into it rather than bypassing it, called out as a convention for future phases |
| i18n catalog gaps ship silently | Medium | Medium | Catalog-completeness test (todo above) fails CI if a used key is missing from either locale |

## Security Considerations
- Context menu / command palette execute only registered, non-arbitrary actions (no dynamic `eval`-style action dispatch) — standard for an `ActionRegistry` keyed lookup, noted here as a deliberate design constraint.

## Next Steps
- Blocks: 16 (marketing app is this composed shell, branded).
- Soft-enables: 13 (share/collab UI affordances slot into main-menu/toolbar once those phases exist).
- Rollback: UI layer is additive on top of stable engine APIs — a broken UI component can be reverted independently without affecting engine state/tests.

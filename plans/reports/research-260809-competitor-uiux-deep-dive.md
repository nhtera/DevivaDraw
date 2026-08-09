# Research Report: Deviva-Draw vs Excalidraw & tldraw — UI/UX Deep Dive

_Conducted 2026-08-09. Live browser interaction with excalidraw.com + tldraw.com; live repro + code inspection of deviva-draw (localhost:5173 @ commit 4c16205)._

## Executive Summary

Deviva-draw already has feature parity. What makes it look "classic, not modern" is **not** the feature set — it is (1) a **theme-consistency defect** that renders the whole app broken in system-dark mode, and (2) a **text-label UI** where competitors use icons. Both are shallow, high-leverage fixes.

The "line and text drawing bugs" the user reported are **one root cause**, verified end-to-end: the live canvas never paints its themed background, so it stays browser-white even when the theme resolves to dark. In dark mode every default-colored stroke/text is inverted to a light color (`#1e1e1e` → `#e9ecef`) for a dark canvas that never arrives — light-on-white = invisible. Newly drawn lines and typed text vanish; the text-edit box shows as a black rectangle. Fix the canvas background and the whole cluster resolves at once.

Deviva-draw does not need to out-feature Excalidraw. To "beat them" it needs a **cleaner, more consistent, icon-driven chrome with real motion and a polished color picker** — a taste upgrade, not a rebuild.

## Verified Findings (deviva-draw)

### F1 — Canvas theme desync (P0 root cause) — CONFIRMED
- Theme resolved to **dark** (system pref): `--dd-canvas-background: #121317`, chrome dark, text light. But the on-screen canvas is **white**.
- `canvasHostBg` and `bodyBg` are both `rgba(0,0,0,0)` (transparent). The `<canvas>` is transparent → shows browser white behind dark chrome.
- Code: `packages/engine/src/render/render-scene-to-canvas.ts:53-54` — background fill is optional and *"omit for a transparent background (canvas default), the same as every live render."* The live render **never** passes it.
- The `canvasBackground` token's **only consumer** in the whole UI is the text overlay (`deviva-draw-shell.tsx:169`). It is never applied to the canvas host div or painted on the canvas.
- **Cascade:** dark theme → `canvas-color-inversion.ts` maps default strokes to light → light strokes on white canvas → **invisible lines**. Verified: drew a line, screen showed nothing; autosave held `{type:"line", strokeColor:"#1e1e1e"}` count 1. The element exists, it just cannot be seen.

### F2 — Text editor overlay invisible / black box — CONFIRMED
- Live-probed the textarea: `color: rgb(30,30,30)` on `background: rgb(18,19,23)` → near-black text on near-black backing = invisible.
- Backing uses the dark `canvasBackground` token; text uses the **raw un-inverted** element stroke `#1e1e1e` (no `adaptStrokeColorForTheme` applied). What you type never matches what the canvas will render.
- `width: 20px` — the textarea does not grow to content width (only height auto-grows) → the thin black vertical bar seen in the user's screenshot.

### F3 — "Classic" look: dark chrome + text-label controls — CONFIRMED
- Chrome is dark on a light canvas (F1); competitors keep chrome tone matched to the canvas.
- Every style control renders a **text label** (`style-section.tsx` renders `option.label`): "Hachure / Cross-hatch / Solid / Zigzag", "Thin / Bold / Extra bold", "Architect / Artist / Cartoonist", "Sharp / Round". Long labels **wrap** ("Cross-hatch", "Extra bold") → cramped, verbose, dated.
- Root reason: `components/icon.tsx` has **no style icons** — only layer/align/zoom/menu glyphs. Text labels were the fallback.

## Competitor Teardown (live)

### Excalidraw (excalidraw.com)
- **Chrome matches canvas**: light canvas → white floating toolbar pill, soft shadow, thin monochrome icons, lavender active state, small tool-number badges.
- **Properties panel (left)**: all controls are **compact icon buttons** — fill styles as hatch icons, stroke width as line-weight icons, stroke style as solid/dashed/dotted icons, sloppiness as three curve icons, edges as sharp/round corner icons.
- **Color picker popover**: color grid with **keyboard-letter shortcuts** (q/w/e/r/t…), Shades row, Hex input, **eyedropper**.
- Contextual top hints ("Enter to add text, Cmd+↵ to create a flowchart").

### tldraw (tldraw.com)
- **Bottom-centered toolbar** (thumb-reachable, mobile-first), white pill.
- **Contextual floating action bar** (undo/redo/delete/duplicate/more) appears above the toolbar only when something is selected.
- **Top-right compact style panel**, shows only relevant controls: filled-circle colors, size as **S/M/L/XL segmented**, and a **font picker that renders actual "Aa" in each font** (draw/sans/serif/mono).
- Everything rounded, soft, light-consistent with the canvas.

## Gap Analysis — what "beats them" requires

| Dimension | Excalidraw | tldraw | Deviva-draw now | Target |
|---|---|---|---|---|
| Theme consistency | ✅ | ✅ | ❌ broken in dark | ✅ canvas paints token; strokes/text visible |
| Style controls | icons | icons + font previews | ❌ text labels, wrap | icon buttons + tooltips |
| Color picker | popover+hex+shades+eyedropper+keys | circles+slider | flat swatches | popover: shades, hex, eyedropper |
| Contextual selection UI | inline | floating action bar | none | tldraw-style floating actions |
| Motion / micro-interactions | subtle | subtle spring | none | spring hover/press, reduced-motion |
| Theme toggle in UI | ✅ | ✅ | not surfaced | visible toggle + follow-system |

## Recommended Next Steps

Full phased plan: `plans/260809-2013-uiux-polish-world-class/plan.md`. Ordering (highest leverage first):

1. **Fix theme consistency** (F1+F2) — paint canvas background token on the canvas host; run text-overlay color through the same theme inversion; auto-size textarea width. Resolves the invisible line/text bugs.
2. **Iconography** — add the missing style icons, convert the properties panel to compact icon buttons with tooltips.
3. **Chrome visual language** — a real token scale (spacing/radius/shadow/type), restyle toolbar + panel to Excalidraw/tldraw grade.
4. **Signature interactions** — color-picker popover (shades/hex/eyedropper), contextual selection toolbar, surfaced theme toggle, contextual hints.
5. **Motion + a11y + cross-theme QA** — spring transitions honoring `prefers-reduced-motion`, WCAG AA contrast, Playwright visual checks in both themes.

## Unresolved Questions
1. Properties panel: keep it **right** (current) or move **left** (Excalidraw)? Recommendation: keep right, it is fine.
2. Toolbar: keep **top-center** or move **bottom-center** (tldraw, better for touch)? Affects mobile ergonomics.
3. Default sketchy font for text like tldraw's hand-drawn default, or keep clean sans? Brand call.
4. Is dark chrome on a light canvas ever intentional (deviva.app embed brand)? If so, the embed needs an explicit forced theme rather than following system.

# Research Report: Excalidraw-like Drawing Tool for deviva.app

**Date:** 2026-08-08 | **Researcher:** Claude | **Searches used:** 4/5

## Executive Summary

**Critical reframe: the premise of this project is wrong.** deviva.app does NOT use Excalidraw — it uses **tldraw 5.2.5** (`apps/web/package.json`). tldraw is the library with the license problem: since SDK 4.0, production use requires a license key; watermark-free commercial use costs **$6,000 USD/year per team**.

**Excalidraw itself is MIT-licensed.** The `@excalidraw/excalidraw` npm package can be embedded in commercial products for free — self-host, modify, rebrand, no fees. Only the hosted excalidraw.com *website* has separate ToS.

**Recommendation: do NOT build a clone from scratch.** "Fully functional like excalidraw.com" = ~6 years of development by hundreds of contributors (multi-canvas rendering engine, freehand ink, text editing, arrow bindings, undo/redo, export, i18n, a11y, mobile gestures). Rebuilding violates YAGNI/KISS catastrophically. Instead: **replace tldraw with `@excalidraw/excalidraw`** — the license problem disappears for ~2 days of work. If a separate `deviva-draw` project is still wanted, make it a thin wrapper monorepo (lib + web) around the MIT package, not a rewrite.

## Current State (verified in codebase)

| Fact | Evidence |
|---|---|
| Library in use | `tldraw: 5.2.5` — `apps/web/package.json` |
| Canvas surface | `components/design-canvas.tsx` (60 LOC) — default `<Tldraw>`, dark mode, `persistenceKey` |
| Integration depth | Shallow: store listener + 2s idle debounce → `readTldrawDiagram(editor)` → `CanvasDiagram` sent to AI interviewer |
| Extraction logic | `read-tldraw-diagram.ts` (61 LOC) + `extract-canvas-diagram.ts` (196 LOC) |
| Purpose | System-design stage of AI mock interviews — interviewer "reads" candidate's diagram |

Total tldraw-coupled code: **~380 LOC**. Migration surface is small.

## Key Findings

### 1. License Reality

- **tldraw ≥4.0:** free only in dev; production needs trial/commercial/hobby license key. Watermark ("Made with tldraw") on free tiers. Commercial (watermark-free): **$6k/yr**. deviva on tldraw 5.x is subject to this. ([tldraw license](https://tldraw.dev/community/license), [license update post](https://tldraw.substack.com/p/license-updates-for-the-tldraw-sdk), [community debate](https://biggo.com/news/202509190115_tldraw_SDK_4.0_Licensing_Debate))
- **Excalidraw:** MIT. Commercial embedding, self-hosting, modification, rebranding all permitted. Keep the copyright notice; don't use the "Excalidraw" name as your brand (trademark ≠ copyright). ([GitHub discussion #6665](https://github.com/excalidraw/excalidraw/discussions/6665), [npm package](https://www.npmjs.com/package/@excalidraw/excalidraw))
- excalidraw.com's realtime collab server (`excalidraw-room`) is also MIT if multiplayer needed later.

### 2. Build-from-Scratch Cost (rejected)

Excalidraw architecture: two-canvas system (cached static + interactive), viewport filtering, Scene/AppState coordination, rough.js sketchy rendering, perfect-freehand ink, element binding graph. Hobby clones on GitHub implement ~10% of features (shapes, move, resize, undo). Realistic estimate for "fully functional" parity: **6–18 engineer-months minimum**, forever chasing upstream. Zero business value vs. free MIT package. ([rendering architecture](https://deepwiki.com/zsviczian/excalidraw/6.1-rendering-architecture), [clone examples](https://github.com/topics/excalidraw-clone))

### 3. Integration API (what replaces current tldraw code)

- Next.js: `dynamic(() => import(...), { ssr: false })` — same lazy-load pattern deviva already uses. ([Next.js integration](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/integration), [discussion #7472](https://github.com/excalidraw/excalidraw/discussions/7472))
- `onChange(elements, appState, files)` → replaces tldraw `store.listen` (keep the 2s idle debounce; filter by comparing element `versionNonce`s to ignore pan/zoom — onChange only fires meaningfully on scene changes, appState changes distinguishable).
- `excalidrawAPI.getSceneElements()` → replaces `readTldrawDiagram`. Elements are flat JSON: `{type: "rectangle"|"ellipse"|"diamond"|"arrow"|"line"|"freedraw"|"text", x, y, width, height, text?, startBinding?, endBinding?}` — arrow bindings carry `elementId`, so the interviewer's diagram-graph extraction maps 1:1.
- `theme="dark"` prop → replaces `updateUserPreferences({colorScheme})`.
- **Gap:** no `persistenceKey` equivalent — hand-roll with `onChange` + `serializeAsJSON` → localStorage, restore via `initialData`. ~30 LOC.

## Comparative Analysis

| Option | Effort | License cost | Verdict |
|---|---|---|---|
| A. Swap tldraw → `@excalidraw/excalidraw` in deviva directly | ~1–2 days | $0 | ✅ **Recommended** |
| B. `deviva-draw` monorepo: lib wraps excalidraw + standalone web app | ~1 week | $0 | ✅ If separate project/branding truly wanted |
| C. Pay tldraw license | 0 | $6k/yr | ⚠️ Only if tldraw UX strongly preferred |
| D. Build clone from scratch | 6–18 months | $0 + opportunity cost | 🚫 Reject — YAGNI violation |

## Implementation Recommendation (Option B shape, if separate project proceeds)

```
deviva-draw/                      # pnpm monorepo (mirror deviva conventions)
├── packages/draw-core/           # lib: <DevivaDraw> wrapping @excalidraw/excalidraw
│   ├── deviva-draw-canvas.tsx    #   theme, persistence, custom UI slots
│   ├── read-diagram.ts           #   elements → CanvasDiagram (port of extract-canvas-diagram.ts)
│   └── persistence.ts            #   localStorage save/restore
├── apps/web/                     # standalone draw site (Vite or Next 16)
└── LICENSE-THIRD-PARTY           # Excalidraw MIT notice (required)
```

Steps: (1) scaffold monorepo; (2) build `draw-core` wrapper + diagram extraction against excalidraw element schema; (3) standalone web app; (4) swap into deviva `design-canvas.tsx`, delete tldraw dep; (5) verify AI interviewer still reads diagrams correctly (the real regression risk — element schema differs from tldraw's).

### Common Pitfalls
- Importing excalidraw during SSR → crash; must be client-only with `ssr: false`.
- `onChange` fires on selection/appState too — debounce + compare serialized elements to avoid spamming the interviewer.
- Forgetting `import "@excalidraw/excalidraw/index.css"` (v0.18+).
- Branding the product "Excalidraw" — trademark issue; "Deviva Draw" is fine.

## Resources
- [Excalidraw dev docs — integration](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/integration)
- [@excalidraw/excalidraw on npm](https://www.npmjs.com/package/@excalidraw/excalidraw)
- [Commercial use discussion](https://github.com/excalidraw/excalidraw/discussions/6665)
- [tldraw license terms](https://tldraw.dev/community/license) · [tldraw 3.x license](https://tldraw.dev/legal/tldraw-sdk-3-x-license)
- [Component props & imperative API](https://deepwiki.com/excalidraw/excalidraw/10.2-component-props-and-api)

## Unresolved Questions
1. Is realtime multiplayer collab needed? (Changes scope: add `excalidraw-room` self-host.)
2. Is the separate `deviva-draw` project actually required, or was it motivated only by the license fear (now moot)? Option A is 5x cheaper.
3. tldraw 5.2.5 currently in production at deviva.app — is there an active license/watermark compliance exposure needing urgent removal?
4. Does deviva need excalidraw UI customization (hide tools, custom toolbar) for the interview context? Affects wrapper API design.

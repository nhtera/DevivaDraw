# Deviva Draw — Full Feature Scope for Excalidraw Parity

**Date:** 2026-08-08 | **Goal:** standalone branded whiteboard (marketing product, e.g. draw.deviva.app) + embeddable lib for deviva.app

## Build Routes (pick one)

| Route | What it is | Effort | Ownership |
|---|---|---|---|
| **A. Wrap npm package** | `@excalidraw/excalidraw` + custom branding via `UIOptions`, custom menus, own landing page | ~1–2 wk | Low control over internals |
| **B. Fork the repo** ✅ | Fork excalidraw/excalidraw (MIT), rebrand fully, strip their backend, own collab server | ~2–4 wk | Full control, upstream merges possible |
| **C. From scratch** | Reimplement everything below | 12–24 engineer-months | Total, but you maintain a rendering engine forever |

MIT compliance for A/B: keep LICENSE + copyright notice in repo; remove "Excalidraw" name/logo from branding (trademark). Rebranding as "Deviva Draw" is explicitly permitted.

---

## Complete Feature Inventory ("fully functional like excalidraw.com")

Priority: 🔴 MVP (unusable without) · 🟡 Parity (users notice absence) · 🟢 excalidraw.com extras

### 1. Canvas Engine 🔴
- [ ] Infinite canvas; pan (space-drag, wheel, trackpad, hand tool); zoom (ctrl+wheel, pinch, zoom-to-fit/selection, 10%–3000%)
- [ ] Dual-canvas rendering: cached static layer + interactive layer (selection, cursors); redraw only on change
- [ ] Viewport culling (skip off-screen elements); devicePixelRatio / retina handling
- [ ] Grid mode + snap-to-grid; object snapping with alignment guides
- [ ] Zen mode, view-only mode, stats panel (🟢)

### 2. Tools & Shapes 🔴
- [ ] Selection, rectangle, ellipse, diamond, arrow, line (multi-point/polygon close), freedraw, text, image, eraser, hand
- [ ] Frame tool (group/export regions) 🟡; laser pointer 🟢
- [ ] Sketchy rendering via rough.js: per-element random seed (stable across redraws), sloppiness 3 levels, sharp/round edges
- [ ] Style system: stroke color, background color, fill style (hachure/cross-hatch/solid/zigzag), stroke width ×3, stroke style (solid/dashed/dotted), opacity, roundness
- [ ] Color picker: palette + custom hex + recently used; style eyedropper 🟡; keep current styles for next shape

### 3. Element Manipulation 🔴
- [ ] Select: click, shift-click add, drag rubber-band, select-all, deep-select in group (double-click)
- [ ] Move (mouse + arrow keys + shift for axis lock), resize 8 handles (shift = aspect lock, alt = from center), rotate handle (shift = 15° steps), flip H/V
- [ ] Multi-select transform as one unit; group/ungroup (nested)
- [ ] Z-order: bring/send forward/backward/to front/to back
- [ ] Align 6 ways + distribute H/V 🟡
- [ ] Duplicate (alt-drag, ctrl+D), copy/cut/paste (internal + system clipboard incl. images), delete
- [ ] Lock/unlock elements 🟡; link URL on element 🟡

### 4. Arrows & Bindings 🟡 (hardest single subsystem)
- [ ] Arrow binds to shapes at endpoints; auto re-routes/clips at shape border when shapes move/resize
- [ ] Arrowheads per end: none/arrow/bar/dot/triangle; straight, curved (multi-point), and elbow arrows
- [ ] Text labels bound to arrows (stay centered on reroute)

### 5. Text 🔴
- [ ] Standalone text elements; WYSIWYG overlay editing (textarea positioned over canvas, matching zoom/rotation)
- [ ] Text bound inside containers (rect/ellipse/diamond/arrow): container auto-grows, vertical align, wraps on container resize
- [ ] Fonts: hand-drawn (Excalifont-equivalent — **must license/substitute your own font**), normal, code; sizes S/M/L/XL; align L/C/R
- [ ] Font loading + measurement (canvas text metrics; wrapping algorithm)

### 6. Freehand 🔴
- [ ] Pressure-sensitive ink via perfect-freehand (MIT); smoothing; simulated pressure for mouse

### 7. Images 🟡
- [ ] Insert via toolbar/paste/drag-drop; stored as binary "files" map (dataURL/blob), referenced by fileId
- [ ] Resize; SVG paste support; image export inclusion; crop 🟢

### 8. History & State 🔴
- [ ] Undo/redo stack (grouped increments — one drag = one undo step)
- [ ] Element versioning: `version` + `versionNonce` per element (needed for merge/sync + idempotent updates)
- [ ] Fractional z-indices 🟡 (stable ordering under collab)

### 9. Persistence & Export 🔴
- [ ] `.excalidraw`-style JSON format: open/save, schema version + migrations
- [ ] localStorage autosave + restore; multiple scenes/workspaces 🟢
- [ ] Export PNG (1×/2×/3×, transparent bg option, dark mode option, selection-only, embed scene in PNG 🟡)
- [ ] Export SVG (font embedding/subsetting 🟡, embed scene 🟡); copy-as-image to clipboard
- [ ] Shareable read-only links 🟢: scene compressed + **E2E encrypted, key in URL fragment**, blob stored on your backend (R2/S3)

### 10. Live Collaboration 🟢 (excalidraw.com flagship)
- [ ] WebSocket room server (fork `excalidraw-room`, MIT — Cloudflare Durable Objects is a natural fit for your stack)
- [ ] E2E encryption (room key in URL fragment, server sees ciphertext only)
- [ ] Presence: named cursors, selections, follow-mode, idle detection
- [ ] Conflict resolution: last-writer-wins per element via version/versionNonce; fractional indices for ordering

### 11. UI Chrome 🔴→🟡
- [ ] Toolbar, properties panel, context menu, main menu, help/shortcuts dialog, command palette 🟡
- [ ] **Keyboard shortcuts — full map** (tool keys 1–9/letters, style shortcuts, transforms; power users notice every gap)
- [ ] Mobile/touch: responsive layout, bottom toolbar, pinch zoom, two-finger pan, long-press context menu — **major effort, often underestimated**
- [ ] Dark/light theme (canvas colors invert intelligently, not just UI)
- [ ] i18n framework 🟡 (excalidraw ships ~50 languages; you need VI + EN minimum) ; RTL 🟢; a11y basics 🟡
- [ ] Shape libraries 🟢: personal library panel, import `.excalidrawlib`, browse/publish public libraries

### 12. excalidraw.com Extras 🟢
- [ ] Mermaid → diagram conversion (`@excalidraw/mermaid-to-excalidraw`, MIT)
- [ ] Text-to-diagram AI (your own LLM backend — natural Deviva marketing tie-in)
- [ ] Web embeds (YouTube/iframe elements); canvas search; presentation/frame navigation
- [ ] PWA: offline, installable, File System Access API, drag-drop `.excalidraw` files

### 13. Product/Infra (for marketing site)
- [ ] Landing page, SEO, OG images; analytics; error tracking
- [ ] Deploy (Cloudflare Pages/Workers fits existing deviva infra); blob storage for share links (R2)
- [ ] `packages/draw-core` lib export for deviva.app interview canvas (diagram-extraction API from previous report)

---

## Effort Reality Check (Route C, from scratch)

| Milestone | Scope | Solo effort |
|---|---|---|
| MVP | §1,2,3,5,6,8 core + PNG export + localStorage | 6–10 wk |
| Parity | + bindings, containers, snapping, mobile/touch, full shortcuts, SVG/share, i18n | +4–8 mo |
| Collab | §10 | +2–3 mo |
| **Total** | "fully functional like excalidraw.com" | **12–24 mo** + permanent maintenance |

Route B (fork) delivers the entire checklist above in ~2–4 weeks because every box is already checked — work is: rebrand (name/logo/fonts/colors), strip their analytics + share backend, wire your own R2-backed share links + collab room, landing page, extract lib package.

## Recommendation
**Route B (fork + rebrand).** For a marketing product, time-to-live and feature completeness are the value; a from-scratch engine is invisible to users. Fork gives 100% parity day one, MIT-clean, and you can still claim "our whiteboard" (with an honest OSS-credits page — which itself markets well to developers).

## Unresolved Questions
1. From-scratch route: is the motivation pride-of-ownership/marketing story ("built in-house")? If yes, confirm — 12–24 mo cost must be explicit before planning.
2. Hand-drawn font: Excalifont is OFL — verify redistribution terms when rebranding, or commission a Deviva font.
3. Share-link + collab backend: Cloudflare (Workers/DO/R2) assumed to match deviva infra — confirm.
4. Scope of v1 marketing launch: solo whiteboard only, or collab required at launch?

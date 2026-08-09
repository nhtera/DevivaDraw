# Research Report: Competitor Interaction-Model UX (post-creation, double-click, tool lock)

_Conducted 2026-08-09. Live interaction with excalidraw.com; user-supplied Excalidraw + tldraw screenshots; code audit of deviva-draw._

## Executive Summary

Deviva-draw's *visual* chrome now matches the competitors, but its **interaction model diverges on the post-creation flow** — the single most-felt difference in day-to-day use. In Excalidraw and tldraw, finishing a shape **hands control back to the Select tool and selects the just-created element** (handles shown), so the next action (move / restyle / delete / double-click-to-label) is immediate. Deviva keeps the drawing tool active and selects nothing, forcing a manual tool switch before you can touch what you just drew.

This one gap cascades: because Deviva's "double-click a shape to add text" is armed **only in the Select tool**, and drawing never returns you there, the double-click-to-label affordance is effectively unreachable right after drawing — which is exactly the "double-click rectangle to insert text" the user expected.

Fixing three coupled behaviors closes the gap: **(1) post-create select + switch-to-Select, (2) a tool-lock toggle** so repeated drawing is still one gesture, and **(3) double-click empty canvas → new text**.

## Verified Competitor Patterns

| # | Pattern | Excalidraw | tldraw | Deviva now |
|---|---------|:---:|:---:|:---:|
| 1 | After drawing → switch to Select tool | ✅ | ✅ | ❌ stays on tool |
| 2 | After drawing → new element is selected (handles) | ✅ | ✅ | ❌ nothing selected |
| 3 | Tool lock ("keep tool active") toggle | ✅ padlock | ✅ setting | ❌ absent |
| 4 | Double-click empty canvas → new text | ✅ (verified live) | ✅ | ❌ no-op |
| 5 | Double-click shape → bound text (create if none) | ✅ | ✅ | ⚠️ works, but only in Select tool → unreachable post-draw |
| 6 | Double-click arrow/line → label | ✅ | ✅ | ✅ |
| 7 | Selection-aware hint ("Double-click to toggle the arrowhead") | ✅ | — | ❌ hint is tool-only |
| 8 | Drag = 2-point line/arrow; click-click = multipoint | ✅ | ✅ | ✅ (fixed earlier) |
| 9 | Shift-constrain (square/circle/straight), Alt = from center | ✅ | ✅ | ✅ |
| 10 | Marquee select, resize/rotate handles, context menu | ✅ | ✅ | ✅ |
| 11 | Copy/paste/duplicate, undo/redo, arrow-nudge, delete | ✅ | ✅ | ✅ |
| 12 | Pan (space/hand), zoom (wheel/pinch), zoom-to-fit | ✅ | ✅ | ✅ |

**Takeaway:** Deviva is feature-complete on selection, transforms, keyboard, and nav. The divergence is concentrated in the **creation → next-action handoff** (rows 1–5, 7).

## The Coupling (why one fix unlocks several asks)

```
draw shape ──▶ Deviva: tool stays "rectangle", selection empty
                        │
                        ▼ (to add text you must)
              manually press "1"/click Select ──▶ double-click shape ──▶ text
```
vs
```
draw shape ──▶ Excalidraw: tool = Select, shape selected
                        │
                        ▼ (immediately)
              double-click shape ──▶ text   ·   drag ──▶ move   ·   Del ──▶ delete
```

`getOrCreateBoundText` already **creates** bound text on demand (verified `bound-text.ts:69`), so "double-click rectangle to insert text" needs no new text engine — it only needs you to *be in the Select tool*, which post-create-switch provides.

## Recommended Implementation (this change set)

1. **Post-create select + switch** — give every creation tool (rectangle/ellipse/diamond via `DragShapeTool`, `LineTool`, `ArrowTool`, `TextTool`) an `onCreated(id)` callback wired in `build-tools.ts` that `selectionState.selectOnly([id])` + `toolStateMachine.setTool(select)`.
2. **Tool lock** — a toolbar toggle (leftmost, Excalidraw-style padlock); when locked, `onCreated` keeps the tool and skips the auto-select so repeated drawing stays one gesture per shape.
3. **Double-click empty canvas → text** — in `double-click-edit.ts`, when no container/arrow is hit, create a standalone `TextElement` at the point and open its edit session (reuse `createTextElement` + `editSession.start`).

## Deferred / already-good (not in this change set)
- Selection-aware hints (row 7) — nice polish; the tool-hint component can be extended to read selection later.
- Alt-drag-to-duplicate — confirm-then-add if missing; low priority (Cmd+D exists).

## Unresolved Questions
1. Tool-lock default: **off** (matches both competitors). Confirmed as the plan default.
2. Should the text tool also select the committed text (not just switch)? Proposed: yes, on commit, for consistency with shapes — but low-risk to defer if it complicates the edit/commit flow.

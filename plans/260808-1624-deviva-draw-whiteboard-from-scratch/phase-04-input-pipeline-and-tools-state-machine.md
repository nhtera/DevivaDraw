# Phase 04 — Input Pipeline & Tools State Machine

## Context Links
- `plans/reports/research-260808-full-feature-scope-excalidraw-parity.md` §1 (pan/zoom), §2 (tools list), §11 (keyboard shortcuts — full map required)
- Depends on: `phase-02-core-element-model-scene-store-history.md`, `phase-03-canvas-renderer-dual-layer-viewport.md`

## Overview
- **Priority:** 🔴 blocking — every concrete tool (05–09) is a state in this machine
- **Status:** pending
- Build the pointer/keyboard event pipeline and the tool state machine (selection tool, hand/pan tool, and a generic "creation tool" contract that concrete shape tools plug into starting phase 05). Implements pan (space-drag, wheel, trackpad, pinch stub) and zoom (ctrl+wheel, zoom-to-fit) against the camera from phase 03.

## Key Insights
- Model tools as an explicit finite state machine (`idle → drawing → idle`, `idle → panning → idle`, etc.) rather than ad-hoc boolean flags — Excalidraw-class apps have ~15 tools with overlapping modifier-key behaviors (shift=lock-axis, alt=from-center, ctrl=snap-off); a flag-based approach combinatorially explodes and is the #1 source of "hobby clone" bugs per the research report's clone-quality note.
- Pointer events (not separate mouse/touch handlers) unify mouse/pen/touch from day one — cheaper than bolting touch on later (mobile is phase 12, but the event model must be touch-ready now to avoid a rewrite).
- This phase owns *only* the generic pipeline + pan/zoom + selection-tool skeleton (click empty canvas = no-op, click nothing = deselect). Concrete "draw a rectangle" behavior is phase 05's job, plugged in via a `ToolHandler` interface this phase defines.
- Keyboard shortcut registry is scaffolded here (a `ShortcutRegistry` singleton mapping key combos → actions) but populated fully in phase 12 — this phase only registers tool-switch keys (1–9/letters) and pan/zoom shortcuts, since those are this phase's own features.

## Requirements
- `PointerEventPipeline`: normalizes `pointerdown/move/up` (+ `wheel`) into scene-space coordinates via phase 03's `screenToScene`; tracks gesture lifecycle (down → moves → up) as a single object passed to the active tool handler.
- `ToolHandler` interface: `onGestureStart(point, modifiers)`, `onGestureMove(point, modifiers)`, `onGestureEnd(point, modifiers)`, `onKeyDown(key, modifiers)`. Concrete tools (phase 05+) implement this.
- `ToolStateMachine`: holds `activeTool`, dispatches pointer/keyboard events to the active `ToolHandler`, exposes `setTool(toolName)`.
- Pan: space+drag, middle-mouse-drag, hand tool (`H` key), two-finger trackpad scroll (wheel event with no ctrl = pan, matches browser trackpad convention).
- Zoom: ctrl/cmd+wheel, `Ctrl +`/`Ctrl -`, zoom-to-fit (`Shift+1`), zoom-to-selection (stub — real selection lands phase 10), range clamp 10%–3000%.
- `ShortcutRegistry` scaffold: key-combo → action string map, conflict detection (two shortcuts on same combo = build-time console warning, not silent).

## Architecture
```
packages/engine/src/input/
├── pointer-event-pipeline.ts
├── tool-handler.ts            (interface + no-op base)
├── tool-state-machine.ts
├── pan-zoom-tool.ts            (hand tool + wheel/pinch pan+zoom)
├── selection-tool-skeleton.ts  (click-to-deselect only; real logic phase 10)
└── shortcut-registry.ts
```
Data flow: DOM pointer/wheel/key events (attached by `packages/react` binding, stubbed via dev harness this phase) → `PointerEventPipeline` converts to scene coords via camera → `ToolStateMachine` routes to active `ToolHandler` → handler mutates `Scene` (phase 02) and/or `Camera` (phase 03) → renderer re-renders via existing subscription.

## Related Code Files
- Create: `packages/engine/src/input/pointer-event-pipeline.ts`, `.test.ts`
- Create: `packages/engine/src/input/tool-handler.ts`
- Create: `packages/engine/src/input/tool-state-machine.ts`, `.test.ts`
- Create: `packages/engine/src/input/pan-zoom-tool.ts`, `.test.ts`
- Create: `packages/engine/src/input/selection-tool-skeleton.ts`
- Create: `packages/engine/src/input/shortcut-registry.ts`, `.test.ts`
- Modify: `apps/web/src/dev-canvas-harness.tsx` (wire real pointer/keyboard events instead of phase 03's scripted demo)

## Implementation Steps
1. Define `ToolHandler` interface + `ToolStateMachine` (tool registry keyed by string name, `setTool`/`getActiveTool`).
2. Implement `PointerEventPipeline`: attach to a DOM element, normalize pointer events (pointer type, button, modifier keys), convert via camera, emit a typed gesture event to the active handler.
3. Implement `pan-zoom-tool.ts`: space-drag pan, middle-mouse pan, wheel-pan, ctrl+wheel zoom (zoom centered on cursor position — the non-obvious correct-feel detail), zoom-to-fit.
4. Implement `selection-tool-skeleton.ts`: click on empty canvas clears any (future) selection state — full hit-testing deferred to phase 10, this just proves the tool-switch contract.
5. Implement `ShortcutRegistry` with conflict-detection warning; register pan/zoom + tool-switch keys only.
6. Unit test: simulated gesture sequences (down→move→move→up) route correctly to the active handler; tool switching mid-gesture is rejected/queued (define and test the chosen behavior explicitly — don't leave it undefined).
7. Wire into `apps/web` dev harness: real mouse/keyboard drives pan/zoom against phase 03's rendering.

## Todo List
- [ ] `ToolHandler` interface + `ToolStateMachine` implemented and unit tested
- [ ] `PointerEventPipeline` normalizes pointer events to scene coords, unit tested
- [ ] Pan (space-drag, middle-mouse, wheel) implemented and manually verified
- [ ] Zoom (ctrl+wheel cursor-centered, zoom-to-fit, 10%–3000% clamp) implemented and manually verified
- [ ] Shortcut registry scaffolded with conflict detection, pan/zoom/tool-switch keys registered
- [ ] Dev harness responds to real input end-to-end

## Success Criteria
- Unit tests cover gesture routing and pan/zoom math (zoom-centered-on-cursor has a numeric test, not just visual).
- Manual: harness pans/zooms identically to Excalidraw's *feel* (cursor-centered zoom, space-drag pan) — subjective but explicitly checked against a reference before sign-off.
- No modifier-key combinatorial bugs in a manual pass through shift/alt/ctrl during pan+zoom (documented as a manual QA checklist, not automatable yet without real shapes).

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tool state machine design too rigid for a modifier-heavy tool added later (e.g. elbow arrow in phase 08) | Medium | Medium | `ToolHandler` interface deliberately minimal (4 methods); modifier-key logic lives inside each handler, not the FSM core — extensible by construction |
| Touch/pointer unification missed a Safari/iOS quirk | Medium | Low (mobile polish is phase 12) | Defer full touch QA to phase 12; this phase only needs pointer-event API compatibility, not touch UX polish |

## Security Considerations
- None (local input handling only).

## Next Steps
- Blocks: 05, 06, 07, 08, 09 (all implement `ToolHandler`), 10 (extends selection-tool-skeleton into full selection), 12 (populates shortcut registry fully).
- Rollback: input layer is additive — revert commit, no persisted state affected.

# System Architecture

Scope: the `packages/engine` core design. Framework-agnostic by construction —
`packages/react` is a thin adapter layer on top, `packages/collab-client` layers
real-time sync on the same element model, and no engine internals assume React or
a DOM. The invariants below are what make the collab and share-link layers
possible.

## Element model: frozen + version/versionNonce invariant

Every element (`elements/base-element.ts` + per-type factories) is treated
as an immutable snapshot. All mutation goes through `scene/scene-mutations.ts`'s
`touch(element, changes)`:

- Returns a **new** object — never mutates in place.
- Bumps `version` (monotonic int), `versionNonce` (random), `updated` (timestamp).
- Freezes the result (`Object.freeze`, one level deep incl. `groupIds`/`boundElements`/`roundness`) — a caller writing `element.x = 5` throws instead of silently corrupting the store.

This is the **collab foundation laid from day one**: a future merge compares
two copies of the same element by `version` (ties broken by `versionNonce`)
rather than trusting wall-clock time across machines. `Scene.updateElement`
and `Scene.addElement` are the only paths that call `touch()`; `Scene.restoreElement`
deliberately skips it (deserializing a saved doc must not look like a fresh edit).

## Scene store: update-hook middleware

`scene/scene.ts`'s `Scene` is a plain Map + pub-sub — no state library. It
stays domain-agnostic (knows nothing about bindings or bound text) via
`registerUpdateHook(hook)`: middleware that runs synchronously inside
`updateElement`, after the mutation lands, before that call's own `notify()`.

Two consumers wire in via this hook today:
- `bindings/binding-scene-sync.ts` — rerouting bound arrow endpoints when their shape moves, clearing bindings when a bound shape is deleted.
- `text/bound-text-container-sync.ts` — keeping a bound text element in sync with its container (position/wrap width) on container resize/move.

Contract: a hook that mutates the scene from inside itself triggers its own
independent `updateElement` → hook pass → `notify()`, not nested recursion
into the caller's pass. A throwing hook is caught, logged, and never blocks
`notify()` or other hooks — enforced per-hook try/catch in `runUpdateHooks`.
`Scene.notify()` itself guards re-entrancy: a listener-triggered mutation
during dispatch is queued and coalesced into one extra pass, not nested.

## Render pipeline: dual-layer + per-element caches

`render/canvas-stage.ts`'s `CanvasStage` composes two canvases:
- **`StaticLayer`** — all scene elements, redrawn only when the scene actually changes (or camera moves).
- **`InteractiveLayer`** — selection outlines, resize handles, in-progress drag previews, snap guides; redrawn every interaction frame without touching the (expensive) static layer.

Per-element render output is cached keyed on `{element.version, camera}`
(`render/rough-drawable-cache.ts`, `render/freedraw-outline-cache.ts`,
`render/arrow-drawable-cache.ts`, `images/image-decode-cache.ts` keyed on
`fileId` instead): camera fields are part of the key — not just
`element.version` — because element geometry is baked into screen-space
coordinates before hitting rough.js, so panning/zooming invalidates every
cached drawable even though no element itself changed. Each cache exposes
`prune(liveIds)` to drop entries for soft-deleted elements that will never
be drawn again (called on each real redraw, not on every mutation).

## Injectable DOM abstractions

The engine runs its full test suite in Node (Vitest, no real `<canvas>`/DOM) by
depending on narrow injected interfaces instead of concrete browser APIs:

| Abstraction | Real impl | Test impl |
|---|---|---|
| `TextMeasurer` (`text/text-measurement.ts`) | `createCanvasTextMeasurer(ctx)` | `createFixedWidthTextMeasurer(charWidthPx)` — deterministic wrap-point assertions |
| `ImageDecodeFn` (`images/image-decode-cache.ts`) | `createBrowserImageDecoder()` (`HTMLImageElement`) | fake `Promise`-returning decoder |
| Clipboard predicates (`packages/react/src/hooks/clipboard-image-detection.ts`) | real `ClipboardEvent`/`DataTransfer` | plain-object fakes matching the narrowed interface |

Same pattern applies to `StorageLike` (autosave, `persistence/local-storage-autosave.ts`)
and pointer/keyboard event shapes (`input/pointer-event-pipeline.ts`'s
`PointerLikeEvent`/`KeyLikeEvent`) — the engine depends on the minimal
shape it actually reads, never the concrete DOM type, so a plain object
literal satisfies it in tests.

## Input pipeline: tool state machine + gesture lifecycle

`input/tool-state-machine.ts` dispatches pointer/keyboard events to the
active `ToolHandler` (`input/tool-handler.ts`): `onGestureStart` →
`onGestureMove`* → `onGestureEnd` **or** `onGestureCancel`. Every concrete
tool (`tools/*.ts`) implements this contract; modifier-key combos and
drag thresholds live inside each handler, never in the FSM core.

`onGestureCancel` has no trustworthy final point (Escape mid-drag,
`pointercancel`, focus loss) — implementations must discard, not commit,
in-progress state. `input/pointer-event-pipeline.ts` guarantees any open
`HistoryStack` batch is cancelled (not committed) on abort, so a tool
handler never has to call `history.cancelBatch()` itself in that path.

Screen-space interaction thresholds (double-click proximity, "close near
start" for line/polygon closing) are defined in **screen pixels**, then
divided by the current zoom to get the scene-space distance — a fixed
scene-unit threshold would feel wildly more/less forgiving depending on
zoom level. See `tools/line-tool.ts`, `tools/arrow-tool-zoom-thresholds.test.ts`.

## Arrow binding: how an arrow stays attached to a shape

An arrow does not store *where* it is attached. It stores how to recompute
that, and the shape stores that it is being pointed at:

```ts
// on the arrow
startBinding: { elementId, focus, gap } | null
endBinding:   { elementId, focus, gap } | null
// on the shape
boundElements: [{ id: arrowId, type: "arrow" }, …]
```

Position is derived, never persisted, so an endpoint can never go stale
relative to a shape that moved, resized or rotated. `focus` is where along
the outline the endpoint sits — `0` is straight at the arrow's other end,
±1 is a full half-extent to either side — and `gap` is the clearance
between the outline and the tip. `bindings/recompute-binding.ts` turns the
pair back into a point on every change; `bindings/binding-scene-sync.ts`
registers the `Scene` update hook that does it.

**Both directions must always agree.** Every write goes through
`bindings/binding-model.ts`, which keeps the arrow's field and the shape's
back-ref in lockstep — nothing else may touch either. Note that
`boundElements` de-duplicates by `(id, type)`, so an arrow attached to the
same shape at *both* ends shares one entry; it survives until both ends
have let go.

Geometry is dispatched by outline kind, not by element type:

| Kind | Types | Intersection |
|---|---|---|
| `rect` | rectangle, note, x-box, check-box, cloud, heart, cylinder | slab test |
| `ellipse` | ellipse, double-circle | parametric |
| `polygon` | diamond, triangle, hexagon, star, parallelogram, trapezoid, block-arrow | nearest positive ray-edge crossing |

The grouping deliberately matches `selection/hit-test.ts`'s own dispatch:
bind geometry that disagreed with hit geometry would give you shapes you
can click but not attach to. `elements/polygon-shape-geometry.ts` is the
single source of vertex truth for both. `bindings/shape-outline-geometry.ts`
owns the dispatch and the local-frame transform that undoes rotation and
mirroring.

Flow from pointer to committed binding:

```
pointer move  → bindings/binding-highlight.ts   [which shape would bind — read-only]
              → render/interactive-binding-highlight.ts  [the halo]
drag          → bindings/preview-bound-endpoint.ts  [where it would land]
release       → bindings/binding-model.ts       [the only writer]
```

`preview-bound-endpoint.ts` is read by arrow creation, the creation
preview and the endpoint drag alike, so what a preview shows and what a
release commits cannot drift apart.

**Hovering writes to `Scene` not at all, and a drag writes only geometry.**
The binding *fields* are left untouched until release, then committed once.
Under live collaboration every touched element is rebroadcast to every
peer, so a binding write per pointer move would multiply out across
(bound arrows) x (peers) — the same amplification
`binding-scene-sync.ts`'s `ENDPOINT_UNCHANGED_EPSILON` guards against.
Live geometry writes during a drag are unavoidable and already the norm
for every move gesture.

Two thresholds, both in `bindings/binding-thresholds.ts`: the gap scales
with the target's stroke width, and the bind proximity widens as you zoom
out but is clamped at twice its 100% value. Elbow connectors additionally
bind from anywhere *inside* a shape (`fullShape`), which straight and
curved arrows do not — drawing through something is ordinary.

## Persistence format: SceneDocumentV1

`persistence/scene-schema.ts` defines the versioned wire envelope shared by
localStorage autosave, saved `.devivadraw` files, and (by design) future
encrypted share payloads and collab snapshots:

```ts
interface SceneDocumentV1 {
  type: "devivadraw/scene";   // fixed discriminator, never bumped
  schemaVersion: 1;           // bumped only alongside a migrations.ts entry
  elements: AnyElement[];
  files: Record<string, SerializedStoredFile>;
  appState?: SerializedAppState; // camera only — UI state lives in the UI layer
}
```

`type` and `schemaVersion` are independent discriminators: `type` rejects
unrelated JSON outright; `schemaVersion` drives `persistence/migrations.ts`
so an old saved document never becomes unreadable after the app evolves.
`Scene.fromJSON()` is a `static` factory (not an instance method) — a
malformed load can never partially clobber a scene already on screen; it
returns a `DeserializeSceneResult`, never throws.

## Diagram: mutation → render flow

```
tool handler (onGestureEnd)
  → Scene.updateElement(id, changes)
      → touch()                     [version++, versionNonce, freeze]
      → runUpdateHooks(updated)     [binding reroute, bound-text sync]
      → notify()                    [pub-sub, re-entrancy guarded]
          → StaticLayer listener → per-element cache miss (version changed)
              → rough.js / perfect-freehand / canvas text/image draw
              → cache.set(element, camera, drawable)
```

## See also

- [Codebase Summary](./codebase-summary.md)
- [Code Standards](./code-standards.md)

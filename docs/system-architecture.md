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
startBinding: { elementId, focus, gap, fixedPoint? } | null
endBinding:   { elementId, focus, gap, fixedPoint? } | null
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

`focus` is measured relative to the direction of the arrow's *other* end,
which makes it the wrong tool for an endpoint that is supposed to stay
somewhere specific: the same stored value resolves elsewhere on the
outline as soon as either end moves. So an endpoint snapped to a
connection anchor stores a **`fixedPoint`** instead — `[0, 0]` the shape's
top-left, `[1, 1]` its bottom-right, so `[1, 0.5]` is the middle of the
right edge. Present, it overrides `focus` entirely and survives the shape
moving, resizing and rotating. `focus` is still written beside it, holding
the value that reproduces the same anchor at bind time, as the fallback
for a reader that predates the field.

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
              → render/interactive-binding-highlight.ts  [the halo + anchor dots]
drag          → bindings/preview-bound-endpoint.ts  [where it would land]
release       → bindings/binding-model.ts       [the only writer]
```

`preview-bound-endpoint.ts` is read by arrow creation, the creation
preview and the endpoint drag alike, so what a preview shows and what a
release commits cannot drift apart.

Every highlighted shape also marks four **connection anchors** — the
midpoints of its bounding box's edges, rotated with it
(`bindings/shape-connection-points.ts`). An endpoint released within
`CONNECTION_POINT_SNAP_PX` of one binds to it exactly rather than to the
pointer, and is pinned there by the `fixedPoint` above — it holds through
every later move, resize and rotation of either the shape or the arrow.
Excalidraw pins its elbow connectors the same way; its straight arrows
keep orbiting on `focus`, and measured against it ours held to 0.0px where
its own drifted 20.7px in the same scenario.

The `focus` stored alongside comes from `focusForConnectionPoint`, which
solves rather than approximates: `recomputeBindingPoint` re-intersects the
outline along the ray from the centre through its nudged aim point, so the
solve picks the `focus` putting that aim on the centre→anchor ray. Since
`focus` only slides the endpoint *perpendicular* to the reference
direction, an anchor at right angles to it cannot be expressed at all —
the solve returns `null` and the fallback value describes the drop point
instead. The snap itself is unaffected; only the value a `fixedPoint`-less
reader would use degrades.

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
out but is clamped at twice its 100% value. That band is only the
*outside* reach — a shape's whole interior binds too, for every arrow
type. Verified against excalidraw.com directly: an endpoint released at a
box's dead centre attaches there and then follows the box. Drawing
*through* a shape therefore attaches on the way past; Ctrl
(`isBindingSuppressed`) is the way out.

## Persistence format: SceneDocumentV1 and the multi-page envelope

`persistence/scene-schema.ts` defines the versioned wire envelope for a single
scene — the stable unit collab element sync, embedded export payloads, and test
seeds all speak:

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

Multi-page documents (`persistence/multi-page-document.ts`) compose that
scene format rather than replacing it: a `"devivadraw/document"` envelope
holds an ordered list of named pages, each page's content a complete
`SceneDocumentV1`. Autosave, saved files, and share links carry the whole
document; every reader also accepts a bare scene document as a one-page
document, so pre-pages saves load with no migration. The react layer's
`PageStore` owns the live page list (one engine `Scene` per page — a `Scene`
is independent of any mounted runtime, which is also what lets collab apply
remote edits to a page that isn't on screen). In collaboration, element
deltas carry their `pageId` inside the encrypted payload and the page list
syncs as an LWW manifest riding on snapshots — the relay never changed.

## Room roles: why the permission lives in the relay

A live room's read-only link is enforced by `apps/collab-server`, not by the
browser. The reasoning is the same one that puts the encryption key in the URL
fragment: a guarantee has to hold against the person holding the client. A
client-side "you are a viewer" flag is defeated by opening devtools and sending
an `element-delta` by hand, so the check sits at the one place every frame must
pass through.

`POST /room` mints two tokens for a room — `{role}.{HMAC(secret, roomId|role)}`.
A client can present one and cannot forge one, and the Worker verifies by
recomputing rather than by storing anything, so a room stays a pure Durable
Object with no side table. The role prefix travels in the clear so the client can
render itself read-only; editing it only makes the MAC fail. The token rides the
query string precisely because the fragment is the half a server never sees: the
room key must stay hidden from the relay, and the token must reach it.

Enforcement is still content-blind. `RoomConnectionRegistry` decides from the
message's `type` alone — `element-delta` and `snapshot` are refused from a
viewer, `presence`, `snapshot-request` and `comment-delta` are relayed — so the
relay learns nothing about a frame it rejects that it did not already know about
one it accepts. A viewer who can comment but not edit is the point: guest
commenting with no account, on a room whose contents the server cannot read. The
browser client does not yet reach that half — it gives a viewer the existing
read-only chrome, which hides the comment tool with every other tool — so today
the capability is exercised by non-browser clients and by the integration test.
Splitting "may comment" out of the single view-only flag is the follow-up.

A connection presenting no token at all is an editor, which is what every room
link created before roles existed looks like.

## Two relays, one protocol

There are two implementations of the room relay, and they are two *deployments*
of one protocol rather than two protocols:

| Implementation | Where | Runs on |
|---|---|---|
| Worker relay | `apps/collab-server/src/room-connection-registry.ts` | Cloudflare Workers + Durable Objects |
| LAN relay | `apps/desktop/src-tauri/src/lan_relay/registry.rs` | the desktop app, on the host's own machine |

The second exists so a room can have no internet in it at all — a workshop, a
classroom, an air-gapped team. It is affordable to ship because the relay was
always content-blind: the hostable part is a table of routing decisions, not a
service.

Two implementations of one protocol is also the obvious way to end up with two
subtly different protocols, so the decisions are specified once, in
[Collab Relay Protocol](./collab-relay-protocol.md), as numbered rules `R1`…`R7`
(type whitelist, rate limit, size cap, broadcast-except-sender, snapshot fast
path, snapshot slow path, role gate). Both files cite it, and both test suites
name their cases after it — so a drift surfaces as a failing numbered case
instead of as a room that behaves differently depending on who hosts it. Adding
behaviour to one relay without a rule in the spec is a review failure.

The structural guarantee survives the move: the LAN relay contains no cipher and
no scene-key material either, so the laptop hosting a board cannot read it. The
one deliberate difference is durability — the Worker persists its snapshot to R2,
while the LAN relay keeps it in memory and never writes scene bytes to disk,
because the host's own document is the durable copy.

A LAN room is joined over plain `ws://`, which is safe for the same reason the
whole design is: the transport carries no plaintext to protect. The consequence
is that a page served over HTTPS cannot open that socket (mixed content), so LAN
peers join from the desktop app — stated in the hosting UI rather than left to be
found as a silent failure.

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
- [Collab Relay Protocol](./collab-relay-protocol.md)

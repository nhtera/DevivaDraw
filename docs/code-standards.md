# Code Standards

Conventions actually enforced in this codebase (verified against
`tsconfig.base.json`, `eslint.config.mjs`, and current source) — not
aspirational.

## TypeScript

`tsconfig.base.json`: `strict: true`, `noUncheckedIndexedAccess`,
`noImplicitOverride`, `isolatedModules`, `verbatimModuleSyntax`, target
`ES2023`. Packages are source-only (`exports: { ".": "./src/index.ts" }`)
— consumers compile TS directly, no build/dist step to keep in sync.

## File size & naming

- `eslint.config.mjs`: `max-lines` rule, `max: 200` (blank lines/comments excluded), severity **warn**, plus `unicorn/filename-case: kebabCase` (error).
- One file over ~200 lines almost always means it's doing two jobs — split by concern, not by arbitrary line count. Example: `apps/web/src/dev-canvas-harness*.ts(x)` is one feature split into `-actions`, `-runtime`, `-shortcuts`, `-double-click`, `-persistence`, `-tool-names`, `-types` files.
- Known exception: `packages/engine/src/index.ts` (barrel re-export file, ~324 lines) — pure `export`/`export type` statements, no logic; splitting a barrel doesn't reduce complexity, so it's left as a warn, not force-split.
- Filenames: kebab-case, descriptive enough to `grep`/`Glob` for without opening the file (e.g. `arrow-tool-zoom-thresholds.test.ts`, not `zoom.test.ts`).

## Comments: self-contained, no plan references

Comments explain **why**, never cite plan artifacts (phase numbers, finding
codes, audit labels). A phase number in a plan file gets renumbered or
deleted; the reasoning behind an invariant does not. Good example in this
codebase (`scene/scene-mutations.ts`):

```ts
/**
 * Every code path that changes a persisted element field ... must run
 * through touch() so version/versionNonce/updated never drift out of
 * lockstep. A future collaboration layer diffs two copies of the same
 * element by comparing version ... rather than trusting wall-clock time.
 */
```

— explains the invariant and *why* it exists, not "per phase 02" or
"see F7". Commit messages and pull-request descriptions are where such
process references belong; source comments never reference them.

## Tool pattern: `ToolHandler` gesture lifecycle

Every interactive tool (`packages/engine/src/tools/*.ts`) implements
`input/tool-handler.ts`'s `ToolHandler`:

```
onGestureStart(point, modifiers, pressure?, pointerType?)
onGestureMove(point, modifiers, pressure?, pointerType?)
onGestureEnd(point, modifiers, pressure?, pointerType?)   // normal completion
onGestureCancel(modifiers)                                 // Escape / pointercancel / focus loss
onKeyDown(key, modifiers)
```

Rules when implementing a new tool:
- `onGestureCancel` has no trustworthy final point — discard in-progress state, never commit it.
- Don't call `history.cancelBatch()` from `onGestureCancel` — `input/pointer-event-pipeline.ts` already guarantees any open batch is cancelled on abort.
- Extend `NoOpToolHandler` when a tool only cares about a subset of the lifecycle (e.g. a click-only tool ignoring `onGestureMove`).
- See `tools/freedraw-tool-abort.test.ts`, `tools/line-tool-abort.test.ts`, `input/pointer-event-pipeline-abort.test.ts` for the abort-path test pattern to follow.

## Screen-px-divided-by-zoom threshold pattern

Any interaction distance/proximity threshold (double-click detection,
"close enough to snap/close a polygon", handle hit-test radius) is defined
as a **screen-pixel constant**, then divided by current zoom to convert to
scene units at the point of use:

```ts
const doubleClickProximity = DOUBLE_CLICK_PROXIMITY_PX / zoom;
```

A fixed scene-unit threshold feels wildly more/less forgiving depending on
zoom level (trivial to hit zoomed in, nearly impossible zoomed out) — always
convert screen px → scene units per-call using the live zoom, never bake a
scene-unit constant. See `tools/line-tool.ts`, `selection/resize-handles.ts`.

## Per-element render cache pattern

A cache over expensive per-element render output follows this shape (see
`render/rough-drawable-cache.ts`, `render/freedraw-outline-cache.ts`,
`render/arrow-drawable-cache.ts`):

- Key: `element.id`. Validity check: cached entry's `version` must equal `element.version` **and** cached camera fields must equal current camera — geometry is baked to screen-space before the expensive step, so panning/zooming invalidates every entry even though no element changed.
- `get(element, camera): T | undefined` — `undefined` means miss; a cached `null` result (e.g. a degenerate element with nothing to draw) is a valid hit, distinct from a miss.
- `set(element, camera, value)`.
- `prune(liveIds)` — drops entries for ids no longer live; call once per actual redraw, not per mutation, since `Scene` soft-deletes and never purges.

New per-element caches should follow this exact shape rather than inventing
a new one — `images/image-decode-cache.ts` follows the same shape keyed on
`fileId` instead of element id (files are content-addressed, shared across duplicate elements).

## Injectable-dependency pattern (DOM-free core)

When engine code needs a browser capability, depend on the narrowest
interface that captures what's actually read/called, inject the real
browser implementation at the call site, and inject a deterministic fake
in tests — never reach for a mocking library to fake out the engine's own
logic under test. Established examples: `TextMeasurer`
(`text/text-measurement.ts`), `ImageDecodeFn` (`images/image-decode-cache.ts`),
`StorageLike` (`persistence/local-storage-autosave.ts`), clipboard event
predicates (`packages/react/src/hooks/clipboard-image-detection.ts`).

## Testing

- Vitest for `packages/engine` (Node env, no real `<canvas>`), `packages/react` (hooks/components), `packages/collab-client` (transport/crypto/presence), and `apps/collab-server` (Worker/Durable Object). Playwright for `apps/web` e2e.
- Tests exercise real code paths through the injectable-dependency pattern above, not mocks of the behavior under test. `vi.fn()` spies appear only to assert a callback fired (e.g. an update-hook or `onSettled` was invoked) — never to replace scene/render/tool logic itself.
- No fake data / cheats / temporary solutions to pass a suite — a failing test gets the underlying code fixed, not the assertion loosened.
- Run the whole suite with `pnpm test` from the repo root; no change merges with a failing suite.

## Linting

`eslint.config.mjs`: `@eslint/js` recommended + `typescript-eslint`
recommended + `unicorn/filename-case`. Lint is not a strict style gate —
per user's global development rules, prioritize compilability and
readability; `max-lines` is `warn`, not a hard failure.

## See also

- [Codebase Summary](./codebase-summary.md)
- [System Architecture](./system-architecture.md)

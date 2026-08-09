# @deviva-draw/react

React bindings for [Deviva Draw](../../README.md): the `<DevivaDraw/>` component (canvas, tools, UI
chrome, theming, i18n, persistence, export, sharing, live collaboration), plus the lower-level
hooks/building blocks a host that wants its own chrome can use directly.

## Install

```bash
npm install @deviva-draw/react @deviva-draw/engine react react-dom
```

`@deviva-draw/collab-client` is pulled in automatically as a dependency (used by the live
collaboration hooks) — no separate install needed unless you want to use it directly.

## Local development against a sibling checkout

Inside this monorepo, packages depend on each other via `workspace:*`. Consuming from a **separate**
repository (e.g. a Next.js app that isn't part of this pnpm workspace) that has a sibling checkout of
this repo on disk can point pnpm's `link:` protocol at every Deviva Draw package actually reachable
from `@deviva-draw/react`'s import graph:

```json
{
  "dependencies": {
    "@deviva-draw/react": "link:../relative/path/to/deviva-draw/packages/react",
    "@deviva-draw/engine": "link:../relative/path/to/deviva-draw/packages/engine",
    "@deviva-draw/collab-client": "link:../relative/path/to/deviva-draw/packages/collab-client"
  }
}
```

`link:` (not `file:`) matters here: `file:` makes pnpm try to resolve each target's own
`package.json` dependencies (including its `workspace:*` references to sibling Deviva Draw packages)
against the *consuming* repo's workspace, which fails — those packages aren't members of it. `link:`
just symlinks the target directory as-is and skips that resolution step, relying on Deviva Draw's own
`pnpm install` (run once, in *this* repo) having already wired `packages/react/node_modules/@deviva-draw/engine`
etc. correctly. Re-run `pnpm install` here whenever this repo's own dependency tree changes.

This is a **local sibling-checkout workflow for development**, not the production consumption
story — it requires both repos checked out side by side on the same machine. For production, use
the npm-published package instead (see Install above), which resolves to a pre-built `dist/`.

## Basic usage

```tsx
import { DevivaDraw } from "@deviva-draw/react";

function App() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <DevivaDraw theme="dark" persistenceKey="my-app-scene" />
    </div>
  );
}
```

`<DevivaDraw/>` fills its parent — size the parent, not the component.

## Reading what the user drew (diagram extraction)

`onChange` fires (debounced) after every user-authored scene change — pan/zoom/selection never
trigger it, since those live outside the `Scene` this fires from. `toCanvasShapeInput` turns the
element array into the generic shape/binding vocabulary a host's own diagram-extraction pipeline
already expects (the same shape a tldraw- or Excalidraw-backed integration would feed it), without
this package needing to import that pipeline's own types:

```tsx
import { useCallback } from "react";
import { DevivaDraw, toCanvasShapeInput } from "@deviva-draw/react";
import type { AnyElement } from "@deviva-draw/engine";

function DesignCanvas({ onDiagram }: { onDiagram: (shapes: unknown, bindings: unknown) => void }) {
  const handleChange = useCallback((elements: AnyElement[]) => {
    const { shapes, bindings } = toCanvasShapeInput(elements);
    onDiagram(shapes, bindings); // feed these into your own extractDiagram(shapes, bindings)
  }, [onDiagram]);

  return <DevivaDraw theme="dark" onChange={handleChange} />;
}
```

## Persistence

- **Library-managed** (default when `initialData` is omitted): autosaves to `window.localStorage`,
  debounced. Pass `persistenceKey` to scope the save slot — required whenever more than one
  `<DevivaDraw/>` instance can be mounted per browser (e.g. one per user session) so instances don't
  overwrite each other's saved scene.
- **Host-managed**: pass `initialData` (a previously-saved `SceneDocument`, e.g. from your own
  storage) and the component never touches `localStorage` at all — read the current scene back via
  `onChange` or `ref.current?.getSceneElements()` and persist it yourself.

## Next.js (App Router)

The canvas touches `window`/`localStorage`/`<canvas>` directly and must never run during SSR. Load it
as a client-only dynamic import, and transpile the workspace packages (they ship TypeScript source,
not compiled JS) via `next.config`:

```ts
// next.config.ts
const nextConfig: NextConfig = {
  transpilePackages: ["@deviva-draw/react", "@deviva-draw/engine", "@deviva-draw/collab-client"],
};
```

```tsx
// design-canvas.tsx
"use client";
import dynamic from "next/dynamic";

const DevivaDraw = dynamic(() => import("@deviva-draw/react").then((m) => m.DevivaDraw), { ssr: false });

export default function DesignCanvas() {
  return <DevivaDraw theme="dark" persistenceKey="design-canvas" />;
}
```

## Vite

No special configuration needed — Vite transpiles workspace TypeScript source by default:

```tsx
import { DevivaDraw } from "@deviva-draw/react";

export default function App() {
  return <DevivaDraw theme="dark" />;
}
```

## Imperative handle

```tsx
import { useRef } from "react";
import { DevivaDraw } from "@deviva-draw/react";
import type { DevivaDrawHandle } from "@deviva-draw/react";

function App() {
  const ref = useRef<DevivaDrawHandle>(null);
  // ref.current?.getSceneElements() / .exportToPng() / .exportToSvg() / .undo() / .redo() / ...
  return <DevivaDraw ref={ref} />;
}
```

## License

MIT

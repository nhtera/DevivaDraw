# Project Roadmap

Status of Deviva Draw at a glance, plus what's on the horizon. This doc tracks
milestone-level status — update it when a milestone completes or scope shifts.

## Locked decisions

These are settled; revisit only with explicit maintainer sign-off:

- **Clean-room.** Zero Excalidraw/tldraw code. Small, single-purpose MIT/CC0
  libraries are OK (roughjs, perfect-freehand, fractional-indexing).
- **Scope.** Full whiteboard including live collaboration.
- **Two deliverables.** A standalone web app, and a React library
  (`@deviva-draw/react`) embeddable in other apps — including [Deviva](https://deviva.app/),
  whose design canvas it powers.
- **Collab foundation from day one.** Every element mutation bumps
  `version`/`versionNonce` via `touch()`, so the collab layer can merge by
  comparing versions rather than trusting wall-clock time. This has been true
  since the core element model landed and is never retrofitted.

## Status

| Area | Status | Outcome |
|---|---|---|
| **Solo whiteboard** | ✅ done | Shapes, freehand, text, arrows/bindings, images, select/transform/align, snapping, grid, undo/redo, save/export (PNG/SVG). |
| **UI & polish** | ✅ done | Full toolbar + overflow menu, style panel, command palette, shortcuts, light/dark/system theming, i18n (EN/VI), zen & view-only modes, mobile. |
| **Extended tool set** | ✅ done | Triangle/hexagon/star, cloud/heart, x-box/check-box, block arrows, sticky notes, frames, tables (editable text grids), highlighter, lasso select. |
| **Share links** | ✅ done | End-to-end-encrypted, read-only snapshots stored as R2 blobs; key stays in the URL fragment. |
| **Live collaboration** | ✅ done | Real-time multiplayer + presence cursors over Cloudflare Durable Objects, follow-a-peer's-camera, and relay-enforced editor/viewer links — a viewer's edits are dropped by the server, not merely hidden by the client. |
| **Comment threads** | ✅ done | Anchored, resolvable threads with per-message records; sync over the encrypted room, round-trip through files/autosave/share links, and stay out of exports and undo. |
| **Multi-page documents** | ✅ done | Pages panel, per-page cameras, page-list manifest synced with the same LWW discipline as elements. |
| **Layers** | ✅ done | Ordered layer list per page with visibility/lock gating across render, hit-test, export, and search. |
| **Presentation mode** | ✅ done | Frames walked as slides: fullscreen, laser pointer, view-only lockdown, keyboard navigation, per-frame presenter notes, and ephemeral audience reactions / raised hands over presence. |
| **Deck export** | ✅ done | Every frame out as a `.pptx` (in-house ZIP + OOXML writer, no Office dependency) or a multi-page PDF, in slide order. |
| **Desktop app** | ✅ done | Tauri v2 shell with real file open/save and full offline operation. |
| **AI agents (MCP)** | ✅ done | MCP server + worker exposing the scene to agents, including joining a live room. |
| **React library** | ✅ done | `<DevivaDraw/>` component, hooks, and scene-read API for embedding. |

## What's next

Candidate follow-ups (not yet scheduled):

- **Commenting as its own permission.** The relay already accepts a viewer's
  `comment-delta` while dropping its edits, but the browser gives a viewer the
  existing read-only chrome, which hides the comment tool along with everything
  else — so guest commenting is reachable over the wire (the MCP peer can do it)
  and not yet from the app. Closing it means splitting "may comment" out of the
  single view-only flag rather than another special case on top of it.

- **npm publish.** Packages are prepared for publishing under the `@deviva-draw`
  scope; see the [Deployment Guide](./deployment-guide.md).
- **Hand-drawn font.** The engine ships OS font stacks today; a licensed or
  commissioned hand-drawn font drops into `text/font-loading.ts` sources with no
  call-site changes.
- **More frame semantics.** Frames group and move their contents; clipping and
  nesting are future work.
- **Additional framework adapters.** A Vue/vanilla adapter alongside the React
  one is possible but out of current scope.

## Cross-cutting rules (every change)

- Element mutations go through `touch()` — never mutate an element in place.
- Files stay small (~200 lines), kebab-case, with self-contained comments (no
  references to internal planning artifacts). See [Code Standards](./code-standards.md).
- New bounding-box element types must be registered in
  `selection/resize-dispatch.ts` or they won't resize.
- No change merges with a failing test suite.

## See also

- [Codebase Summary](./codebase-summary.md)
- [System Architecture](./system-architecture.md)
- [Code Standards](./code-standards.md)
- [Deployment Guide](./deployment-guide.md)

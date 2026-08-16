# Changelog

All notable changes to Deviva Draw are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.7.0] — 2026-08-16

### Added
- **MCP live sessions — the agent draws on your open canvas.** Start a live session in the web
  app, paste the room link to Claude (or any MCP client running `npx @deviva-draw/mcp`), and the
  agent joins as a named collaborator: its shapes and diagrams appear on the canvas you're looking
  at in real time, your edits flow back to it, and it shows up in the presence rail. Works with
  multi-page boards (page adds/renames from the browser reach the agent), needs no extension,
  plugin, or account, and keeps the room's end-to-end encryption — the relay still sees only
  ciphertext, and the agent never repeats the room key anywhere. Three new stdio tools:
  `connect_to_live_session`, `disconnect_live_session`, `live_session_status`.
- `@deviva-draw/collab-client` now ships `PageStore` (moved from the react package) and the
  canonical `createPageStoreCollabAdapter`, so every peer kind — browser tab or headless agent —
  runs identical multi-page sync semantics.

## [0.6.0] — 2026-08-16

### Added
- **MCP server for AI agents** (`@deviva-draw/mcp`). `claude mcp add deviva-draw -- npx -y
  @deviva-draw/mcp` gives Claude (or any MCP client) a headless Deviva canvas: batch element
  create/update/delete with auto-wrapped shape labels, semantic `create_diagram` (nodes + edges)
  and mermaid-flowchart import with automatic layout, content search, `.devivadraw` file open/save
  (multi-page aware), and SVG/PNG export that embeds the scene so exported files re-open fully
  editable in the app. `take_screenshot` returns the rendered PNG to the agent so it can visually
  check its own work. PNG rides an optional native canvas (`@napi-rs/canvas`); installs without it
  degrade cleanly to SVG-only. File access can be confined with `--root`; nothing leaves the
  machine. See `docs/mcp.md`.
- **Tables.** A real table element, at last: pick it from the tool overflow, click or drag to
  place a grid, and the first cell opens for typing immediately. Tab walks cell to cell —
  Tab past the last cell grows the table by a row — double-click edits any cell, rows grow to
  fit their text, and dragging a line between two columns resizes just that column. Add or
  remove rows and columns from the properties panel, which also sets the table's font. Tables
  are drawn in the same hand-sketched style as everything else, follow every canvas rule
  (select, move, rotate, duplicate, layers, frames, arrows connect to them, Cmd+F searches
  their text), and export faithfully to PNG and SVG. Documents with tables need this version
  or newer to open.

### Fixed
- **Double-clicking a locked shape no longer opens its text editor.** Locked meant locked for
  moving and resizing, but a double-click could still edit labels and text — now every editor
  respects the lock, element-level or from a locked layer.
- **A drawing error can no longer freeze the whole board.** If one element fails to draw (for
  example, malformed data from a future version arriving over a live collaboration), it is
  skipped for that frame instead of stopping the canvas permanently.

## [0.5.0] — 2026-08-16

### Added
- **Layers.** Every page now has a layers panel: create, rename, and reorder named
  layers, hide or lock a whole layer at once, and move any selection onto the layer you
  click. Hidden layers vanish from the canvas, from clicks and marquees, from find, and
  from exports — including the scene payload embedded in an exported PNG or SVG, so an
  export never smuggles hidden content in its metadata. Locked layers behave exactly
  like individually locked elements everywhere. New elements land on the active layer,
  drawing order is layer-by-layer, and z-order actions stay within an element's layer.
  A document saved before layers existed opens exactly as it always did.
- **Layers sync in collaboration.** Adding, renaming, hiding, locking, reordering, or
  deleting a layer propagates live to every peer, deletions never resurrect from a
  concurrent edit, and it all rides the existing end-to-end encrypted relay — the
  server never learns layers exist. Old clients simply ignore the new data.
- **Revocable share links.** Every share link now comes with a kill switch: the share
  dialog lists the links this browser has created, and one click permanently deletes a
  link's data from the server. The proof of ownership is a secret only your browser
  holds — the server stores just its fingerprint, so nobody else (including the server)
  can revoke or read your link.
- **Share links can expire.** Choose never, 7 days, or 30 days when creating a link;
  an expired link is gone from the server the moment anyone touches it.
- **View-only share links mean it.** A view-only link now disables every mutating
  action — shortcuts, menus, and panels included — and offers an explicit "Edit a copy"
  path that forks the scene into the visitor's own workspace instead.
- **Documents reopen where you left them.** Autosaves, saved files, and share links
  all remember the viewport — every page comes back at the exact camera position it was
  saved at instead of a zoom-to-fit guess.
- **A tidier menu.** The growing list of view toggles — grid, snapping, zen mode, and
  friends — now lives in a Preferences submenu with keyboard-shortcut hints, keeping
  the main menu short. The submenu stays open while you flip several toggles in a row.
- **Sharper panel icons.** The layers panel's visibility and lock markers are now
  crisp monochrome line icons that match the rest of the chrome in both themes.

### Fixed
- **Opening the share dialog no longer creates a link.** The dialog now opens idle
  with an explicit "Create link" button, so glancing at it never uploads anything.
- **Revoking a link is unambiguous.** Each history row shows the link's creation date
  and time, revoking shows a busy state, a revoked current link says so instead of
  pretending to be live, and hitting the server's rate limit says "wait a minute"
  instead of failing cryptically.

## [0.4.0] — 2026-08-15

### Added
- **Multi-page documents.** One file can now hold many boards: a quiet bottom-left
  switcher names the current page and opens the full list — click to switch,
  double-click to rename, ✕ to delete, + to add. Each page keeps its own camera, the
  whole document autosaves and reloads as one, share links carry every page, and an old
  single-page save opens as page one with nothing lost. Long page lists scroll inside
  the panel instead of growing past the window.
- **Multi-page collaboration.** Pages sync live between collaborators — adding,
  renaming, deleting, and drawing on any page propagates, presence cursors are scoped
  to the page each person is on, and two people starting cold merge their page lists
  instead of one overwriting the other. All of it rides the existing end-to-end
  encrypted relay: the server never learns pages exist.
- **Text to diagram.** Describe a flow in plain words in the diagram dialog and get
  back real, editable shapes — powered by your own Anthropic API key, stored only in
  this browser and sent nowhere else.
- **Image cropping.** Double-click an image to open a crop editor: the full original
  ghosts behind the current window, eight handles (or dragging inside the frame)
  reshape it, Enter commits, Escape puts everything back. The visible pixels never move
  on canvas, and exports honor the crop.
- **Keyboard flowcharts.** With a shape selected, Alt+Arrow spawns a connected copy in
  that direction — arrow attached at the facing edges — and selects it, so a whole
  flowchart grows without touching the mouse.
- **An editable stats panel.** The stats readout now takes input: type exact X/Y,
  width/height, or rotation for the selected element and it moves precisely there.
- **Export extras.** Export in dark mode, export only the selection, and re-open a
  Deviva-exported PNG or SVG by dropping it back onto the canvas — the file carries its
  scene and returns as editable shapes, not a flattened picture.
- **The cursor tells you what a click will do.** Hovering anything grabbable shows the
  move cursor, the resize handles show direction-correct arrows (even on rotated
  shapes), the rotate handle offers a grab, the hand tool grabs, drawing tools show a
  crosshair, and holding Space previews the pan grab.
- **Cut, copy styles, and font-size shortcuts.** Cmd+X cuts, styles copy/paste between
  shapes, and Cmd+Shift+< / > steps the selected text through the four font sizes.
- **Links you can actually click.** An element with a link shows a small badge at its
  corner that opens in a new tab — no more digging through a dialog to follow it.

### Fixed
- **Resizing the window no longer flickers the canvas.** The board repaints in the same
  instant its backing store resizes, so not a single blank frame is ever shown.
- **A corrupted autosave is salvaged, not wiped.** Whatever still parses is restored,
  and the damaged original is kept in a recovery slot instead of being overwritten.
- **Scrollbars across the chrome are thin, rounded, and stay out of the way** — panels
  scroll like the rest of the app's quiet chrome instead of showing fat system bars.

## [0.3.7] — 2026-08-14

### Added
- **Arrows connect to library items.** An imported library icon — a database cylinder, a
  server, a cloud — is really a group of freehand strokes and lines, and until now arrows
  simply refused to attach to it: no highlight, no snap, nothing. Aim an arrow at a
  library item now and it lights up, offers its connection dots, and the arrow attaches
  and follows the icon wherever it is moved — something stock Excalidraw cannot do with
  these items either. Images and standalone text are connectable too. A lone freehand
  scribble deliberately stays unconnectable, so annotating around a diagram never
  creates accidental attachments — grouping strokes is what marks them as "a thing to
  connect to".

## [0.3.6] — 2026-08-14

### Added
- **The connection dot you are aiming at lights up.** Bring an arrow endpoint near a
  shape — while drawing a new arrow or dragging an existing one's end — and the anchor it
  would snap to gains a blue ring with the dot filled in, the way Excalidraw marks it.
  The ring's size is the snap zone itself: release anywhere inside it and the endpoint
  lands exactly on the dot. The other three anchors stay grey, so "this shape" (the
  halo), "these spots" (the dots) and "this exact one" (the ring) each read at a glance.
- **Connecting arrows works by finger, not just by mouse.** On touch screens the grab
  zone of an arrow's endpoint handles, the distance at which a shape offers itself for
  connection, and the anchor snap zone are all twice as large — a fingertip covers far
  more of the screen than a cursor does. Mouse and pen keep the tighter targets, so
  precise work on desktop is unaffected.

### Fixed
- **Drawing can no longer silently stop working.** If a drawing gesture's release
  happened where the canvas could not see it (the browser refuses pointer capture and
  the pointer ends over the toolbar, or outside the window), every later stroke was
  swallowed with no error until something happened to reset the canvas — the
  intermittent "I draw but nothing appears" bug. A missed release is now caught at the
  window, so the gesture always ends and the next stroke always starts.
- **Touch: one stray finger no longer breaks the canvas for the rest of the session.**
  A finger lifted off-canvas (easy to do mid-pinch) left the gesture tracker convinced
  it was still down; from then on every one-finger drag wildly panned and zoomed the
  canvas, and pinch-zoom stopped responding. The tracker now sees releases wherever
  they happen and resets when the window loses focus.
- **Touch: resting a second finger while drawing no longer drops a stray shape.**
  Landing a palm or second finger mid-stroke cancelled the stroke correctly, but the
  extra finger's own tap then planted a default shape under it. Extra fingers are now
  consumed by the pan/pinch recognizer before the drawing pipeline can see them.

## [0.3.5] — 2026-08-14

### Added
- **The menu shows which preferences are switched on.** The main menu's toggle rows —
  snap to objects, zen mode, view-only mode, the minimap and the stats panel — now carry
  a checkmark while they are active, the way Excalidraw's preferences submenu does, so
  the current state is visible before clicking rather than discoverable only by toggling
  and watching what happens.
- **Shapes show you where an arrow can connect.** Move over a shape with the arrow tool
  and four grey dots appear — the middle of each side — alongside the highlight. Release
  an endpoint on one and it snaps exactly to it, and it *stays* on it: move the shape,
  resize it, rotate it or drag the arrow's far end, and the connection holds where you
  put it. So a row of boxes can be wired up with their arrows all meeting the same point
  on each side, and stay that way as the diagram is rearranged. Release an endpoint
  anywhere else and it keeps the old behaviour of sliding around the outline to face the
  arrow's other end.
- **Arrows are edited by their endpoints, not by a box around them.** Selecting a plain
  arrow now shows a small circle on each end instead of a rectangular frame with resize
  handles, plus a dot at its middle — drag that to add a bend. Drag an end onto another
  shape to reconnect it, or into empty space to detach it. Hold Ctrl (Cmd on macOS) while
  dragging to place an end near a shape without connecting to it. An arrow that already
  has a bend keeps its frame as well as its point handles, so it can still be scaled and
  rotated as a whole; so does an arrow selected together with other elements.
- **The endpoint snaps to the shape while you draw, not after you let go.** Drawing an
  arrow toward a shape now shows the endpoint already clipped to its edge, so what you see
  mid-drag is exactly what you get on release.
- **Shapes light up when an arrow can connect to them.** Pick the arrow tool and move
  over the canvas: any shape you could attach to gets a soft blue halo tracing its
  outline, and while you drag an arrow both ends light up so a connection between two
  shapes reads as one before you release. Previously there was no indication at all that
  arrows connected to shapes — you found out after letting go.
- **Arrows bind to every closed shape.** Binding used to work only for rectangles,
  ellipses and diamonds. Sticky notes, triangles, hexagons, stars, parallelograms,
  trapezoids, block arrows, double circles, clouds, hearts, x-boxes, check-boxes and
  cylinders are all bind targets now, and the endpoint clips to the shape's real
  outline rather than its bounding box — visible on a star or a triangle, where the two
  are far apart. Rotated and flipped shapes are handled properly, so an arrow attaches
  to the outline a shape is actually drawn with rather than an unflipped copy of it.

### Fixed
- **Dragging a shape with an arrow attached is smooth again.** With "Snap to objects"
  on, dragging a connected shape made it stick in place and then jump forward in steps,
  over and over, with the alignment guide flickering — nothing like the one-for-one drag
  the preference promises. The shape's own arrow was the culprit: it follows the shape as
  it moves, and because the set of things to align with was re-read on every frame, the
  shape kept snapping back to where its own arrow had been one frame earlier. Alignment
  targets are now fixed at the moment a drag begins — as Excalidraw's are — and a shape's
  own connectors are never alignment targets at all. Measured on a one-pixel-per-step
  drag of a connected shape, every step now moves exactly one pixel.
- **A refused pointer capture can no longer freeze the canvas.** Starting a gesture asks
  the browser to capture the pointer, and the browser may refuse — a pen lifted between
  queued events, or input injected by automation tooling. That refusal escaped mid-setup
  and left the input pipeline convinced a gesture was still running, so every later
  click, drag and draw on the canvas was ignored until the page was reloaded. The
  capture is best-effort now; a gesture without it merely loses tracking outside the
  window's edge.
- **Drawing an arrow onto a sticky note no longer breaks the arrow tool.** Dropping an
  arrow endpoint on a note threw mid-gesture, and because the throw landed before the
  tool closed its history batch, the arrow was lost and the next undo behaved
  unpredictably. Two different questions had been sharing one answer: the check for
  "can this element hold a text label" — which notes pass — was also being used to
  decide "does this element have an outline an arrow can attach to", which notes had no
  formula for. Notes now have that geometry and bind like anything else, and a failure
  in the binding step can no longer cost you the arrow you just drew.
- **A bound endpoint clears the target's stroke instead of overlapping it.** The gap
  between an arrow's tip and the shape it points at was a flat 4 units regardless of how
  thick the shape's outline was, so an arrow looked correctly detached from a hairline
  shape and visibly overlapping a heavy one. It now accounts for the stroke. Existing
  drawings keep the gap they were saved with and do not shift.
- **An arrow attached to a shape at both ends no longer loses one of them.** When an arrow
  had both its ends on the same shape, detaching or moving one end quietly broke the
  shape's record of the other — so that end stopped following the shape when it moved. The
  record is now kept until both ends have let go.
- **Arrows no longer attach to locked shapes.** A locked shape never showed the "you can connect
  here" highlight, but an endpoint dropped on one attached anyway — an invisible connection that
  only revealed itself once the shape was unlocked and moved, dragging arrows nobody had joined to
  it. It is now skipped by the connection logic as well as by the highlight.
- **Arrows can now attach to the whole of a rotated shape.** The check for "is this
  endpoint near a shape" measured against the shape's unrotated box, so on a rotated one
  most of its length was ruled out before the real test ran — a rotated bar could only be
  connected to near its middle. It now measures the rotated footprint.
- **Binding is no longer over-eager when zoomed out.** The proximity that decides whether
  a dropped endpoint attaches was a fixed screen distance, which at 25% zoom reached four
  times as far across the canvas as it did at 100% — far enough that endpoints attached
  to shapes nobody was aiming at. It is now capped at twice its 100% reach, however far
  out you zoom.

### Changed
- **Dragging follows the pointer again: "Snap to objects" is now a preference, off by default.**
  Align-to-other-elements snapping used to be permanently on, and it does not ease in — a shape
  entering an alignment band jumped the whole way at once, then sat still while the pointer crossed
  the band's full width, then lurched out the far side. Measured on a one-pixel-per-step drag past a
  single neighbour, the shape moved `1 1 1 1 1 1 9 0 0 … 0 9 1 1 1`. With enough elements on the
  canvas you are inside one of those bands most of the time, which reads as the drag lagging and
  jumping rather than as alignment. It is now switched on from the main menu or with `Alt+S`, and
  remembered across reloads — the same default and the same shortcut Excalidraw uses. Grid snapping
  is unaffected; it has always had its own switch.
- **With snapping on, it only aligns to what is on screen.** Every element in the drawing counted as
  something to line up with, including ones scrolled far out of view — so a shape would jump onto a
  column belonging to nothing you could see, with a guide line running off the edge of the canvas.
  On a drawing larger than one screen that happened constantly and looked like the drag blinking at
  random. Verified against Excalidraw, which ignores off-screen elements the same way. The snap
  correction itself was already identical to Excalidraw's; only the set of things it considered was
  wrong.
- **Aiming anywhere at a shape now connects to it.** Releasing an arrow endpoint inside a
  shape attaches it, not only near the edge — checked against Excalidraw, where an endpoint
  dropped at a box's dead centre attaches and then follows the box. Drawing an arrow
  straight *through* a shape does attach on the way past as a result; hold Ctrl (Cmd on
  macOS) to place an end without connecting. The shape lights up as you approach, so you
  can see which is about to happen before you let go.
- **`@deviva-draw/engine` — `DEFAULT_BINDING_GAP` has been removed** (breaking, for
  direct API consumers only). The binding gap now depends on the target's stroke width,
  so a single constant can no longer express it. Use `bindingGapFor(target)` instead.
  `BindableShapeType` has widened from three members to sixteen, and `BorderRect` gained
  optional `scale` and `direction` fields; both are still exported from the package root.
  `findBindableShapeNear`, `resolveBindingHighlight` and `resolveBindingHighlights` have
  dropped their trailing `fullShape` argument — a shape's interior always counts now, so
  there is nothing left to switch on. `MidpointHandle` gained a `hovered` field, and
  `SelectionOverlay`'s `bbox` variant gained `arrow` (the lone selected arrow whose point
  handles the overlay should also draw, or `null`).
- **`@deviva-draw/engine` — object snapping is opt-in for embedding hosts too** (breaking, for
  direct API consumers only). `SelectionToolDeps` gained an optional `getObjectSnapEnabled()`, and
  align-to-other-elements snapping no longer happens unless it returns `true` — a host that wants
  the previous always-on behaviour has to supply it. It also gained an optional
  `getVisibleSceneRect()`, which limits snap targets to the elements currently on screen; omit it and
  the whole scene counts, as before. `registerPreferenceShortcuts` is a new export, already included
  in `registerFullShortcutMap`.
- **`@deviva-draw/engine` — `ArrowBinding` gained an optional `fixedPoint`** (additive; breaking
  only for code that builds a `BoundEndpointPreview` itself). It pins an endpoint to a shape-relative
  position — `[1, 0.5]` is the middle of the right edge — and overrides `focus` when present.
  `previewBoundEndpoint` now reports it, and `BoundEndpointPreview.fixedPoint` is required, so
  anything destructuring that result before handing it to `bindArrowEndpoint` should forward the new
  field. `nearestConnectionAnchor`, `fixedPointToScene`, `fixedPointBindingPosition`,
  `CONNECTION_FIXED_POINTS` and the `FixedPoint` type are new exports; `nearestConnectionPoint` is
  unchanged.

## [0.3.4] — 2026-08-13

Publishes all three packages: `@deviva-draw/engine` (0.3.2),
`@deviva-draw/collab-client` (0.2.1), and `@deviva-draw/react` (0.3.4).

### Fixed
- **`@deviva-draw/react` 0.3.2 and 0.3.3 could not be built by a consumer.** Both
  releases shipped a flip action that imports `computeFlipChanges` from the engine, but
  the engine's own version was never raised past 0.3.1 — the version published before
  flip existed. Every consumer install therefore resolved an engine without that export,
  and any bundler that resolves imports statically failed the build outright. The engine
  is republished at 0.3.2 carrying the flip code the react package has been calling all
  along. `collab-client` is republished at 0.2.1 for the same reason on a smaller scale:
  it still pinned engine 0.3.0, so an app could end up with two copies of the engine
  side by side. Releases that change a package now have to raise the version of every
  workspace package whose published build is behind the code being shipped.

## [0.3.3] — 2026-08-13

Publishes `@deviva-draw/react` only; `@deviva-draw/engine` (0.3.1) and
`@deviva-draw/collab-client` (0.2.0) are unchanged.

### Fixed
- **The canvas-background colour picker opens above the menu, and stays open.** Two
  faults in one control. The popover carried a lower stacking order than the main menu,
  so it opened *behind* it and the menu's own rows showed through where the swatches
  should have been. And because the popover is portalled out of the menu, the menu's
  dismiss-on-outside-click read a click on a swatch as a click away — closing the menu
  and unmounting the picker before the colour could be applied. The overlapping tiers
  are now named in one place rather than as per-component numbers, and portalled
  popovers are marked so a dismiss handler can recognise one it opened itself.

## [0.3.2] — 2026-08-13

Publishes `@deviva-draw/react` only; `@deviva-draw/engine` (0.3.1) and
`@deviva-draw/collab-client` (0.2.0) are unchanged.

### Fixed
- **The right-click menu no longer runs off the bottom of the screen.** Two faults
  compounded. The menu was measured while its open animation was still on the first
  frame — that keyframe starts scaled down, so it measured smaller than it settles at
  and got seated slightly too low. And on a viewport shorter than the full action list
  there is no position that fits at all, so the menu was pinned to the top edge with
  its last entries hanging off the bottom, unreachable. The menu is now measured at its
  true size and capped to the viewport, scrolling when the list is longer than the
  screen. Which platforms saw this depended on font metrics.
- **The properties panel no longer scrolls sideways.** The row of align buttons was a
  few pixels wider than the panel's content box, and the opacity slider added a UA
  margin on top of its `width: 100%` — and a scroll container computes `overflow-x`
  alongside its `overflow-y`, so either one alone put a horizontal scrollbar under the
  whole panel. The layer-action rows now share one column grid that shrinks to fit a
  narrow container, and the shape and text panels share a single opacity row.

## [0.3.1] — 2026-08-12

### Fixed
- **Labelled shapes are grabbable from the inside.** An unfilled shape only hit-tested
  within a few pixels of its outline, so clicking inside a rectangle carrying a text
  label missed it and started a marquee instead of selecting it. A bound label now makes
  the whole interior a hit target, matching Excalidraw. Shapes wired up with bound
  arrows (but no label) stay stroke-only.
- **Imported Excalidraw group nesting.** The two formats order `groupIds` from opposite
  ends, so an imported library shape expanded to its innermost subgroup: clicking a
  published icon grabbed one cluster of strokes and dragged it out of the shape it
  belonged to.
- **Duplicated groups no longer share ids with the original**, so moving a copy stopped
  dragging the elements it was copied from.
- **Autosave is flushed after opening a file**, so a reload straight after an import no
  longer restores the previous scene.

### Changed
- The properties panel is docked under the top bar on the **left** edge, and the library
  has a **permanent toggle button** of its own at the top right — both matching Excalidraw's
  placement. Opening the library no longer displaces the properties panel.

## [0.3.0] — 2026-08-12

### Added
- **Mermaid import — full Excalidraw parity.** Native, editable conversion for
  **state** and **sequence** diagrams (on top of the existing flowchart / class / ER),
  an **image fallback** for unsupported types (pie, gantt, gitGraph, …) via a lazily
  loaded `mermaid` chunk, and a **live preview + inline errors** in the import dialog.
  The engine stays 100% dependency-free — `mermaid` is a React-only lazy import.
- **Mobile properties UX.** On phones (and short/landscape viewports) the style panel
  no longer covers the canvas: a compact bar (live stroke/background swatches + a
  **Style** toggle) docks above the tool row and opens the full controls in an
  on-demand, scrollable bottom sheet — Excalidraw-style. The layout breakpoint is now
  height-aware so landscape phones get the mobile chrome instead of the taller desktop panel.

### Fixed
- Color-picker popover is portaled to `<body>` so a scroll container can no longer clip it.
- Mobile style sheet centers via auto margins, so its entrance animation no longer shifts it.
- Hamburger menu renders as a centered SVG glyph instead of the off-center Unicode `☰`.

[0.3.7]: https://github.com/nhtera/DevivaDraw/releases/tag/v0.3.7
[0.3.6]: https://github.com/nhtera/DevivaDraw/releases/tag/v0.3.6
[0.3.5]: https://github.com/nhtera/DevivaDraw/releases/tag/v0.3.5
[0.3.4]: https://github.com/nhtera/DevivaDraw/releases/tag/v0.3.4
[0.3.3]: https://github.com/nhtera/DevivaDraw/releases/tag/v0.3.3
[0.3.2]: https://github.com/nhtera/DevivaDraw/releases/tag/v0.3.2
[0.3.1]: https://github.com/nhtera/DevivaDraw/releases/tag/v0.3.1
[0.3.0]: https://github.com/nhtera/DevivaDraw/releases/tag/v0.3.0

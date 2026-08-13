# Changelog

All notable changes to Deviva Draw are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Arrows are edited by their endpoints, not by a box around them.** Selecting an arrow
  now shows a small circle on each end instead of a rectangular frame with eight resize
  handles. Drag an end onto another shape to reconnect it, or into empty space to detach
  it. Hover near the middle of a segment and a dot appears — drag that to add a bend.
  Hold Ctrl (Cmd on macOS) while dragging to place an end near a shape without connecting
  to it. Selecting an arrow together with other elements still shows the usual frame, and
  the group still resizes as one.
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
- **`@deviva-draw/engine` — `DEFAULT_BINDING_GAP` has been removed** (breaking, for
  direct API consumers only). The binding gap now depends on the target's stroke width,
  so a single constant can no longer express it. Use `bindingGapFor(target)` instead.
  `BindableShapeType` has widened from three members to sixteen, and `BorderRect` gained
  optional `scale` and `direction` fields; both are still exported from the package root.

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

[0.3.4]: https://github.com/nhtera/DevivaDraw/releases/tag/v0.3.4
[0.3.3]: https://github.com/nhtera/DevivaDraw/releases/tag/v0.3.3
[0.3.2]: https://github.com/nhtera/DevivaDraw/releases/tag/v0.3.2
[0.3.1]: https://github.com/nhtera/DevivaDraw/releases/tag/v0.3.1
[0.3.0]: https://github.com/nhtera/DevivaDraw/releases/tag/v0.3.0

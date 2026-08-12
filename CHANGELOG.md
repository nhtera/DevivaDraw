# Changelog

All notable changes to Deviva Draw are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

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

[0.3.2]: https://github.com/nhtera/DevivaDraw/releases/tag/v0.3.2
[0.3.1]: https://github.com/nhtera/DevivaDraw/releases/tag/v0.3.1
[0.3.0]: https://github.com/nhtera/DevivaDraw/releases/tag/v0.3.0

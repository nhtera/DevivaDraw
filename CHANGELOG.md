# Changelog

All notable changes to Deviva Draw are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

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

[0.3.0]: https://github.com/nhtera/DevivaDraw/releases/tag/v0.3.0

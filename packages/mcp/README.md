# @deviva-draw/mcp

MCP server for [Deviva Draw](https://github.com/nhtera/DevivaDraw) — lets AI agents (Claude
Code/Desktop, Cursor, any MCP client) create, edit, query, and export whiteboard scenes with no
browser involved. Everything runs headlessly on the same engine the
[draw.deviva.app](https://draw.deviva.app) canvas uses, so what an agent builds re-opens as a
fully editable scene in the app.

## Quick start

```bash
# Claude Code
claude mcp add deviva-draw -- npx -y @deviva-draw/mcp

# confine file access (open/save/export) to one directory — recommended
claude mcp add deviva-draw -- npx -y @deviva-draw/mcp --root ~/diagrams
```

Then ask the agent to draw:

> Create a flowchart of a login process, check it looks right, and export it as login.svg

## What agents can do

- **Build scenes** — shapes (rectangle/ellipse/diamond/sticky note/frame), lines, arrows, text,
  freehand ink; batch create/update/delete with auto-wrapped labels bound inside shapes.
- **Generate diagrams** — `create_diagram` (semantic nodes + edges) or
  `create_diagram_from_mermaid`, both with automatic layered layout and arrows that stay bound to
  their shapes.
- **Self-verify** — `take_screenshot` returns a PNG image block, so the agent can look at its own
  work and fix overlaps before finishing.
- **Search, not dump** — `describe_scene`, `list_elements`, and `search_scene_content` keep results
  token-cheap; full scene JSON only on explicit request.
- **Export & round-trip** — SVG and PNG exports embed the scene data, so exported files re-open
  editable in the web app; `.devivadraw` files (including multi-page documents) open and save
  losslessly.

## PNG support (optional native canvas)

PNG export and screenshots use [`@napi-rs/canvas`](https://www.npmjs.com/package/@napi-rs/canvas),
an **optionalDependency** with prebuilt binaries for the common platforms. If it can't install (or
you set `DEVIVA_MCP_NO_CANVAS=1`), the server runs in SVG-only mode: every other tool works, and
the PNG tools explain the situation instead of crashing. Text measurement also uses the native
canvas when present (browser-exact wrapping) and a calibrated approximation otherwise.

## Security stance

- stdio only talks to files at paths the agent explicitly passes — no directory walking.
- `--root <dir>` (or `DEVIVA_MCP_ROOT`) rejects any path outside that directory.
- Image decoding accepts `data:` URIs only; the server never fetches remote URLs.
- Nothing leaves your machine.

Full setup (Claude Desktop, Cursor), the complete tool reference, and examples:
[`docs/mcp.md`](https://github.com/nhtera/DevivaDraw/blob/main/docs/mcp.md).

## License

MIT. Bundled hand-drawn font: Excalifont (SIL OFL 1.1).

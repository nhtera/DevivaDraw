# MCP server (`@deviva-draw/mcp`)

Deviva Draw's [Model Context Protocol](https://modelcontextprotocol.io) server: AI agents create,
edit, query, and export whiteboard scenes headlessly, on the exact engine the web app uses.
Exports embed the scene data, so anything an agent draws re-opens fully editable at
[draw.deviva.app](https://draw.deviva.app).

## Setup

The server runs over stdio; one agent session owns one live scene.

**Claude Code**

```bash
claude mcp add deviva-draw -- npx -y @deviva-draw/mcp --root ~/diagrams
```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "deviva-draw": {
      "command": "npx",
      "args": ["-y", "@deviva-draw/mcp", "--root", "/Users/you/diagrams"]
    }
  }
}
```

**Cursor** — Settings → MCP → Add server, command `npx -y @deviva-draw/mcp` (args as above).

**From this repo** (development):

```bash
claude mcp add deviva-draw -- pnpm --dir <repo>/packages/mcp --silent start --root ~/diagrams
```

`--root <dir>` (or env `DEVIVA_MCP_ROOT`) is optional but recommended: every file path a tool
accepts (open/save/export) must then resolve inside that directory.

## Tool reference

Every mutating tool returns compact `{id, type, x, y, width, height, label?}` summaries — full
scene JSON only from `get_scene_content`. All inputs are schema-validated; bad payloads return
actionable errors, never crashes.

### Scene lifecycle

| Tool | What it does | Example arguments |
|---|---|---|
| `new_scene` | Start a fresh empty scene (nothing written until save). | `{"background": "#ffffff"}` |
| `open_scene` | Open a `.devivadraw` file (single-scene or multi-page; active page becomes the working scene). | `{"path": "flow.devivadraw"}` |
| `save_scene` | Save to the bound file, or a new path. Multi-page documents are written back whole. | `{"path": "flow.devivadraw"}` |
| `describe_scene` | Cheap overview: counts by type, bounds, background, page/file info. | `{}` |
| `get_scene_content` | The one full scene-JSON dump. Prefer search/list. | `{}` |

### Elements

| Tool | What it does | Example arguments |
|---|---|---|
| `create_elements` | Create ≤100 elements; shapes take a `label` bound inside them. | `{"elements": [{"type": "rectangle", "x": 0, "y": 0, "label": "API"}]}` |
| `update_elements` | Batch-update geometry, style, `text`, `label`, `points` (whole batch validated first). | `{"updates": [{"id": "…", "strokeColor": "#e03131", "label": "API v2"}]}` |
| `delete_elements` | Delete by id (a labeled shape takes its label with it). | `{"ids": ["…"]}` |
| `list_elements` | Paginated summaries in draw order, optional type filter. | `{"type": "rectangle", "limit": 20}` |
| `search_scene_content` | Find by text (labels, text, table cells); label hits report their shape. | `{"query": "login"}` |

### Diagrams

| Tool | What it does | Example arguments |
|---|---|---|
| `create_diagram` | Semantic flowchart: nodes + edges → laid-out shapes with bound arrows. | `{"nodes": [{"id": "a", "label": "Start"}, {"id": "b", "label": "End"}], "edges": [{"from": "a", "to": "b"}], "direction": "DOWN"}` |
| `create_diagram_from_mermaid` | Convert mermaid flowchart source into editable elements. | `{"mermaid": "flowchart TD\n  a[Start] --> b[End]"}` |

### Export & verification

| Tool | What it does | Example arguments |
|---|---|---|
| `export_svg` | SVG identical to the canvas; embeds editable scene data by default. Inline result, or a file via `path`. | `{"path": "out.svg", "background": "#ffffff"}` |
| `export_png` | PNG file at 1–3× scale with embedded scene data (needs the optional native canvas). | `{"path": "out.png", "scale": 2}` |
| `take_screenshot` | Returns the rendered PNG as an image block so the agent can inspect its own work. | `{"selectionIds": ["…"]}` |
| `read_scene_format` | Static cheat-sheet: coordinates, element model, styling, usage patterns. | `{}` |

### Live sessions (draw on the user's open canvas)

Local stdio server only. Start a live session in the browser at
[draw.deviva.app](https://draw.deviva.app), copy the room link, and hand it to the agent — its
edits then appear on your open canvas in real time, your edits flow back, and the agent shows up
in the presence rail as a named collaborator.

| Tool | What it does | Example arguments |
|---|---|---|
| `connect_to_live_session` | Join the user's live room as a headless peer (connect early — the current scene merges into the room like a second browser peer). | `{"url": "https://draw.deviva.app/room/…#key=…"}` |
| `disconnect_live_session` | Leave the room; the scene keeps its merged content. | `{}` |
| `live_session_status` | Connection status, room id, and current collaborators. | `{}` |

The link's `#key=…` fragment is the room's end-to-end encryption key: the agent holds it in memory
only and never repeats it in results, errors, or logs. Self-hosted relay: set
`DEVIVA_MCP_COLLAB_URL`. While connected, `new_scene`/`open_scene` are refused so the room's
scene can't be swapped out from under it.

Multi-page boards sync fully: pages added or renamed in the browser show up in
`live_session_status`, and the agent's tools always operate on the room's active page.

## SVG-only mode

PNG rendering rides `@napi-rs/canvas`, an **optionalDependency**. When it isn't installed (rare
platforms, `--no-optional`, or `DEVIVA_MCP_NO_CANVAS=1`), the server keeps working: PNG tools
return a clear "SVG-only on this install" error, text measurement falls back to a calibrated
approximation, and everything else is unaffected.

## Security

- **stdio = local-only.** Scene data never leaves the machine; the only network I/O is the
  opt-in live session, which connects to the E2E-encrypted relay only when you paste a room link.
- File access is restricted to explicit agent-passed paths, optionally confined by `--root`.
- Image decode accepts `data:` URIs only — the server never fetches remote URLs.

## Remote endpoint (no install)

A stateless Streamable-HTTP endpoint runs on Cloudflare Workers — no account, no install, and no
server-side scene storage (nothing you draw is ever persisted or logged remotely):

```bash
claude mcp add --transport http deviva-draw-remote https://mcp-draw.deviva.app/mcp
```

Differences from the local server:

- **Stateless.** Each `tools/call` optionally takes the previous call's returned `scene` JSON and
  hands the updated scene back in the response's `scene` field; omitting it starts empty. Nothing
  is shared between calls.
- **No session/file tools** (`new_scene`/`open_scene`/`save_scene` — omitting `scene` already
  starts fresh) and **no PNG/screenshots** (Workers have no canvas)
  — `export_svg` returns the SVG inline. Tool descriptions point back at `npx @deviva-draw/mcp`
  for those.
- **Abuse caps**: per-IP rate limiting and a ~2MB request body cap.

Prefer the local server for real work; the remote endpoint is zero-setup discoverability.

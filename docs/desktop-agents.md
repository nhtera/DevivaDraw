# Agents and the Desktop App

The desktop app's agent story is **file-based**: your coding agent edits the open `.devivadraw`
file through the [`@deviva-draw/mcp`](https://www.npmjs.com/package/@deviva-draw/mcp) server, and
the app live-reloads the document within ~2 seconds of every save — no plugins, no localhost API,
works fully offline.

## Prerequisites

- Deviva Draw desktop app (this repo's `apps/desktop`, or a released installer).
- Node.js 20+ for the MCP server.
- An MCP-capable agent (Claude Code, Cursor, etc.).
- **Offline agents:** `npx` needs the package cached — run `npm i -g @deviva-draw/mcp` once while
  online, then reference the global binary (`deviva-draw-mcp`) instead of `npx`.

## Setup (Claude Code example)

```sh
claude mcp add deviva-draw -- npx -y @deviva-draw/mcp --root ~/Drawings
```

`--root` confines every file path the agent can touch to that directory — point it at wherever you
keep your `.devivadraw` files. Any MCP client works with the same command
(`npx -y @deviva-draw/mcp --root <dir>` over stdio).

## The workflow

1. Open (or save) a document in the desktop app — e.g. `~/Drawings/roadmap.devivadraw`.
2. Ask the agent to edit that file:
   > Open ~/Drawings/roadmap.devivadraw with deviva-draw, add a "Q3" frame with three notes, save.
   The agent uses `open_scene` → element tools → `save_scene`.
3. The app notices the on-disk change and reloads the document in place — same camera position, no
   flash. Your turn again.

## Reload semantics (what the app will and won't do)

- **You have no unsaved edits** → external changes reload automatically (≤2s).
- **You have unsaved edits** → the app NEVER merges or clobbers. A conflict bar appears:
  *Reload from disk* (take the agent's version) or *Keep mine (Save As…)* (your version to a new
  file). Until you choose, both versions are intact.
- **The app's own saves never self-reload** (content-hash suppression).
- **File deleted/renamed on disk** → the document stays open and the next Save asks before
  re-creating the old path.
- **Unreadable write** (agent crashed mid-thought, partial JSON) → the app keeps the current
  document and says so; the next complete save reloads normally.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Agent says the path is outside the allowed root | The file lives outside `--root` — move it in, or widen the root. |
| Changes don't appear in the app | Is the SAME file open (check the title bar)? The app only watches the open document. |
| `npx` fails offline | Install globally while online: `npm i -g @deviva-draw/mcp`. |
| Conflict bar appears constantly | You're editing while the agent saves — coordinate turns, or work on separate files. |
| Agent reads stale content | Save in the app first — the file on disk is the contract; unsaved edits exist only in the app. |

# Contributing to Deviva Draw

Thanks for your interest in improving Deviva Draw! This guide covers how to set
up the repo, the conventions we follow, and how to get a change merged.

## Prerequisites

- **Node 22+**
- **pnpm** (the version is pinned via the root `packageManager` field — enable
  it with `corepack enable` if you don't have pnpm installed)

## Getting started

```bash
git clone https://github.com/nhtera/DevivaDraw.git
cd DevivaDraw
pnpm install
pnpm dev            # web app on :5173, collab worker on :8788
```

Then open http://localhost:5173. Packages are served from TypeScript source via
Vite, so most edits are live with hot-reload — no build step required.

Before pushing, make sure the full gate is green:

```bash
pnpm test           # unit tests (engine, react, collab-client, worker) + web e2e
pnpm lint
pnpm typecheck
```

## Project structure

| Path | What lives here |
|---|---|
| `packages/engine` | Framework-agnostic drawing core (elements, scene, history, render, tools, selection, bindings, text, images, persistence, export). |
| `packages/react` | React bindings — `<DevivaDraw/>`, hooks, UI chrome. |
| `packages/collab-client` | Real-time sync client (WebSocket, E2E crypto, presence). |
| `apps/web` | Standalone web app + Playwright e2e. |
| `apps/collab-server` | Cloudflare Worker (Durable Objects rooms, R2 blobs). |
| `docs/` | Architecture, code standards, roadmap, deployment. |

Start with [docs/codebase-summary.md](docs/codebase-summary.md) and
[docs/system-architecture.md](docs/system-architecture.md) to orient yourself.

## Coding conventions

Full detail is in [docs/code-standards.md](docs/code-standards.md). The essentials:

- **TypeScript strict.** No `any` escapes for convenience; the engine is DOM-free
  and depends on narrow injectable interfaces (see the injectable-dependency
  pattern in the code standards) so it can be unit-tested in Node.
- **Small, focused files.** Keep files around 200 lines or under; split by
  concern, not by arbitrary line count.
- **kebab-case, descriptive filenames** — you should be able to `grep`/`Glob` for
  a file without opening it (e.g. `arrow-tool-zoom-thresholds.test.ts`).
- **Comments explain _why_, and are self-contained.** Don't reference internal
  planning artifacts (phase numbers, finding codes) in code — that context rots.
- **The clean-room rule is absolute.** Deviva Draw contains no code copied from
  Excalidraw, tldraw, or any other whiteboard. Don't paste code from those
  projects. Small, single-purpose MIT/CC0 libraries are fine (see
  [LICENSE-THIRD-PARTY](LICENSE-THIRD-PARTY)).

## Tests

- Vitest for `packages/*` and `apps/collab-server`; Playwright for `apps/web`.
- Tests exercise real code paths through injectable fakes, not mocks of the
  behavior under test.
- Add tests for new behavior and bug fixes. Don't loosen an assertion or add fake
  data just to make a suite pass — fix the underlying code.
- No change merges with a failing suite.

> Adding a new bounding-box element type? It **must** be registered in
> `selection/resize-dispatch.ts`, or its handles won't resize. There's a
> regression test guarding this.

## Commits & pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, optionally scoped
  (e.g. `feat(tools): add lasso select`).
- Keep each PR focused on one logical change. Describe what changed and why, and
  link any related issue.
- Make sure `pnpm test`, `pnpm lint`, and `pnpm typecheck` all pass locally.
- Never commit secrets (`.env` files, API keys, credentials).

## Reporting bugs & requesting features

Open an issue at https://github.com/nhtera/DevivaDraw/issues. For bugs, include
steps to reproduce, what you expected, what happened, and your browser/OS. For
security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public
issue.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).

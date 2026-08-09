# @deviva-draw/collab-client

Realtime sync client for [Deviva Draw](https://github.com/deviva/deviva-draw): WebSocket
transport, end-to-end encryption, presence broadcasting, and last-writer-wins conflict resolution
over [`@deviva-draw/engine`](https://www.npmjs.com/package/@deviva-draw/engine) element versions.
Pairs with a Durable Objects (or any compatible WebSocket) relay server — see the
[repository](https://github.com/deviva/deviva-draw)'s `apps/collab-server` for the reference
backend.

## Install

```bash
npm install @deviva-draw/collab-client @deviva-draw/engine
```

## Minimal example

```ts
import { CollabSession } from "@deviva-draw/collab-client";
import { Scene } from "@deviva-draw/engine";

const scene = new Scene();
const session = new CollabSession({ scene, userName: "Alice", userColor: "#f97316" });

// Start a new room and get a shareable URL (embeds the E2E encryption key)...
const roomUrl = await session.startSession("https://your-collab-server.example.com", location.origin);

// ...or join an existing one from a URL a peer shared:
// await session.joinSession("https://your-collab-server.example.com", roomUrl);
```

`@deviva-draw/react`'s `useCollabSession` hook wraps this client with React state management —
prefer that in a React app; use this package directly for a framework-agnostic integration.

## License

MIT

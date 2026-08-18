# Collab Relay Protocol

Scope: the decisions a Deviva Draw room relay makes about a WebSocket frame. There are **two**
implementations of this protocol and there must never be a third source of truth:

| Implementation | Where | Runs on |
| --- | --- | --- |
| Worker relay | `apps/collab-server/src/room-connection-registry.ts` | Cloudflare Workers + Durable Objects |
| LAN relay | `apps/desktop/src-tauri/src/lan_relay/registry.rs` | the desktop app, on the host's own machine |

The two exist for different deployments, not for different behaviour. A user who hosts a room on
their laptop must get the same room they would get from the hosted relay — same convergence, same
role enforcement, same abuse limits. This document is the shared specification; both files cite it in
their module doc, and both test suites name their cases `R1`…`R7` after the rules below, so a drift
between the two shows up as a *failing numbered case* rather than as a mystery six months later.

**Anything added to one relay without a rule here is a review failure.** Add the rule first.

## The one invariant above all others

A relay is **content-blind**. It routes `{type, iv, ciphertext}` envelopes whose `iv`/`ciphertext` it
copies verbatim and never inspects. The room's decryption key travels in the URL *fragment* between
humans and reaches no relay, by either implementation, ever. Neither implementation may contain a
decryption path in the message path — no `SubtleCrypto` in the Worker registry, no cipher crate in the
Rust registry.

Role tokens (`R7`) are the single deliberate exception to "no key material in the relay", and they are
quarantined outside the message path — `room-role-token.ts` / `lan_relay/tokens.rs`, consulted once at
connection-upgrade time. That secret signs a *write permission*; it has nothing to do with scene
content and cannot be used to read any.

## Message types

Five types are routable. The relay knows nothing about them beyond the string:

| Type | Payload | Routing |
| --- | --- | --- |
| `element-delta` | opaque envelope | broadcast except sender |
| `comment-delta` | opaque envelope | broadcast except sender |
| `presence` | opaque envelope | broadcast except sender |
| `snapshot` | opaque envelope | broadcast except sender, **and** cached (`R5`) |
| `snapshot-request` | bare signal, no payload | answered from cache, else asked of peers (`R5`/`R6`) |

Two types are emitted *by* the relay and never accepted from a connection: `peer-joined` and
`peer-left`, each `{type, peerId}`.

`peerId` is assigned by the relay, never client-supplied. Every broadcast frame is re-stamped with the
sender's `peerId` before it goes out.

## The rules

### R1 — Type whitelist

A frame whose parsed `type` is not one of the five routable types is **dropped silently**; the
connection stays open. Same for a frame that is not valid JSON, or is not a JSON object, or whose
`type` is not a string.

Dropped rather than closed on purpose: a single malformed frame is far cheaper to ignore than a
disconnect-and-reconnect cycle, and one buggy peer must never cost the room its other members.

### R2 — Per-connection rate limit

Each connection gets a fixed-window budget (`maxRequests` per `windowMs`, keyed by `peerId`).
Exceeding it **closes** the connection with code `1013` ("Try Again Later").

Closed, not dropped, unlike `R1`: a flood is not a stray frame, and a client that keeps its socket
while being silently ignored has no signal to back off with.

This is abuse deterrence, not a security boundary — the end-to-end encryption is that boundary.

### R3 — Frame size cap

A frame longer than `MAX_MESSAGE_LENGTH` (1 MiB) **closes** the connection with code `1009` ("Message
Too Big").

Measured as the raw frame's length in bytes. Every field this protocol sends (`type`, base64url
`iv`/`ciphertext`) is ASCII, so a UTF-16 code-unit count and a byte count agree — which is why the
Worker implementation is allowed to use `raw.length` without encoding first.

The cap is *strictly over*: a frame exactly at `MAX_MESSAGE_LENGTH` is accepted.

The limit is deliberately tighter than the 15 MB share-link payload cap: a `snapshot` here is
JSON-wrapped ciphertext on a long-lived socket, not a one-shot upload, and a session that large should
be sending incremental deltas anyway.

### R4 — Broadcast except sender

An accepted frame goes to every *other* connection in the room and never back to its sender. The
client's own echo guard is a secondary defence; this is the primary one.

### R5 — Snapshot cache, fast path

The relay retains the most recent `snapshot` frame it has seen (already `peerId`-stamped). A
`snapshot-request` is answered by **unicasting** that cached frame to the requester alone — no other
connection sees the request.

The cache is in-memory. The Worker relay additionally persists it (to Cloudflare R2) through a
hook outside the registry; the LAN relay does not persist at all, because the host's own document is
the durable copy and a relay must never write scene bytes to disk.

### R6 — Snapshot slow path

If no snapshot has ever been seen this room's lifetime, `snapshot-request` is instead **broadcast to
every other connection**, and whichever peer answers does so as an ordinary `snapshot` frame, which
then takes the `R5` path for the next requester.

A room with no other connections therefore leaves the request unanswered — correct: the requester is
the first peer, and their own document is the room.

### R7 — Role gate

Every connection carries a role decided at upgrade time from a signed token, never from anything the
connection says about itself:

| Role | May send |
| --- | --- |
| `editor` | all five types |
| `viewer` | `comment-delta`, `presence`, `snapshot-request` |

A viewer's `element-delta` or `snapshot` — the two that change what the room's document says — is
**dropped silently**, `R1`-style, and the connection stays open. An out-of-date or buggy viewer client
must keep the read-only session it is entitled to rather than be put into a reconnect loop, and a
hostile one learns nothing from the drop either way.

A connection presenting **no** token is an `editor` **on the Worker relay**. Every room link minted
before roles existed is tokenless, and those links must keep working exactly as they did.

The **LAN relay requires a token** and is deliberately stricter here. It has no legacy to preserve — a
LAN room is minted when hosting starts and dies when it stops, so no tokenless link to one can exist —
and the rule would otherwise let any device on the network open a room on somebody's laptop just by
inventing a room id. Requiring a token means a stranger who does not hold the invite link cannot make
the host process allocate anything at all. This is the one place the two implementations differ inside
a rule rather than around it, and it is a strictly tighter answer to the same question.

A connection presenting a token that does not verify is **rejected at upgrade** (HTTP 403) — it is not
downgraded to viewer. A token that fails to verify is a token that proves nothing, and guessing an
intent for it is worse than refusing it.

Rejection order matters: `R2` (rate limit) and `R3` (size) are evaluated before parsing, then `R1`
(whitelist), then `R7` (role). A viewer's oversized frame closes the connection under `R3`; it does
not reach the role gate.

## Token scheme

`{role}.{base64url(HMAC-SHA256(secret, "{roomId}|{role}"))}`

- Both `roomId` and `role` are inside the MAC, so a viewer token cannot be replayed against another
  room and a viewer cannot promote themselves by rewriting the prefix.
- The prefix is in the clear so a client can render read-only chrome without holding the secret. It is
  a *claim* on the client and a *verified fact* on the relay.
- Comparison is timing-safe.
- The secret differs per deployment: the Worker reads `ROOM_TOKEN_SECRET` from its environment; the
  LAN host generates a random one per hosting session and holds it only in memory, since a LAN room
  does not outlive the process that hosts it.
- A relay with **no** secret configured refuses to mint rooms (HTTP 500) rather than issuing tokens
  that trivially "verify". Read-only sharing that looks like it works but does not is worse than a
  visible refusal.

## Endpoints

| Method | Path | Worker relay | LAN relay |
| --- | --- | --- | --- |
| `POST` | `/room` | mints `{roomId, editorToken, viewerToken}` (201); no record is written | **not served** (404) |
| `GET` | `/room/{roomId}?t={token}` | WebSocket upgrade | WebSocket upgrade; also answers a plain `GET` with a page explaining that LAN rooms are joined from the desktop app |

Upgrade responses: `426` without an upgrade header (Worker), `400` on a malformed room id, `403` on a
token that does not verify — or, on the LAN relay, on no token at all. The LAN relay additionally
answers `503` once it is carrying its maximum number of connections.

The LAN relay does not serve `POST /room` because the desktop host mints its room in-process when
hosting starts, so the route would have no caller — and an unauthenticated "allocate me a room"
endpoint on somebody's personal machine is a liability with nothing on the other side of the trade.

`roomId` must match `^[\w-]{8,128}$` — a room URL is the only way to discover a room, so a short or
sequential id would make enumeration trivial.

## Where the two implementations legitimately differ

Only in what is *outside* the decision table:

| Concern | Worker relay | LAN relay |
| --- | --- | --- |
| Connection lifetime | Durable Object hibernation, attachment-serialised peer state | a live `tokio` task per connection |
| Snapshot durability | persisted to R2, seeded back on cold start | in-memory only, gone when hosting stops |
| Token secret | deployment secret, stable across restarts | per-session random, in memory |
| Reachability | public origin over `wss://` | private LAN address over `ws://` (see below) |
| Rate-limit buckets | a keyed map with sweeping and eviction, since keys are client-influenced | held on the connection itself, since the relay assigns the key and the bucket dies with the socket |
| Slow readers | the platform owns the send path | each peer has a bounded outbound queue; a peer that stops reading is disconnected rather than allowed to grow it (see below) |
| Tokenless connections | admitted as `editor`, for links older than roles | refused — see `R7` |
| Room minting | `POST /room` | in-process when hosting starts; the route is not served |
| Capacity | platform-governed | a fixed ceiling on simultaneous connections, since a laptop has no autoscaler behind it |

Writing to a socket is asynchronous while relaying a decision is not, so the LAN relay queues each
peer's outbound frames. That queue is bounded: a peer that stops reading while the room keeps drawing
would otherwise grow it without limit on the *host's own machine*, which a guest should never be able
to do. Overflow disconnects that peer rather than dropping frames for it — a dropped delta diverges
its board permanently and silently, whereas a reconnect asks for a fresh snapshot (`R5`) and
converges.

Plain `ws://` is acceptable for the LAN relay for the same reason the whole design works: the
transport carries no plaintext to protect. A LAN attacker who obtains the URL gets exactly what any
invited peer gets — identical to the hosted model, where the key is likewise only ever as private as
the link.

The consequence is that a page served over HTTPS cannot open a `ws://` LAN socket (mixed content), so
LAN peers join from the desktop app. This is stated in the hosting UI rather than left to be
discovered as a silent failure.

## See also

- `docs/system-architecture.md` — "Room roles: why the permission lives in the relay"
- `docs/deployment-guide.md` — provisioning `ROOM_TOKEN_SECRET` for the hosted relay
- `apps/desktop/README.md` — hosting a room on your own network

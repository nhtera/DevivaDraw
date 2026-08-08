# Phase 13 — Share Links (E2E Encrypted, R2)

## Context Links
- `plans/reports/research-260808-full-feature-scope-excalidraw-parity.md` §9 (shareable read-only links, E2E encrypted, key in URL fragment)
- Depends on: `phase-11-persistence-and-export.md` (reuses `serialize-scene.ts`'s JSON as the encryption payload)

## Overview
- **Priority:** 🟢 (excalidraw.com extra, but explicitly in V1 scope per locked user decision)
- **Status:** pending
- Implement read-only shareable links: scene JSON compressed + E2E encrypted client-side, encryption key carried in the URL fragment (never sent to the server), ciphertext blob stored in Cloudflare R2 via a Worker endpoint. This phase also stands up `apps/collab-server` as a real deployable (previously an empty skeleton from phase 01), since it owns the R2-backed blob endpoint that phase 14's collab room will later share.

## Key Insights
- **URL fragment (`#`) is the entire security model**: everything after `#` in a URL is never sent to any server by the browser (it's client-side only) — the encryption key lives there, so `apps/collab-server` only ever sees and stores ciphertext, and even Deviva's own infrastructure cannot read shared scene content. This must be verified with an explicit test (assert the key never appears in any network request), not just assumed from URL semantics.
- Crypto: use the browser's native `SubtleCrypto` (Web Crypto API, no external crypto library needed — YAGNI, the platform already provides AES-GCM) — generate a random AES-GCM key client-side, encrypt the (gzip-compressed) scene JSON, upload ciphertext + IV to the Worker, construct the share URL as `https://draw.deviva.app/s/{blobId}#key={base64Key}`.
- Compression before encryption (not after — encrypted bytes are incompressible): use the browser's native `CompressionStream('gzip')` (no dependency needed) on the JSON before passing to `SubtleCrypto.encrypt`.
- The Worker endpoint is intentionally dumb: `PUT /blobs/{id}` (store ciphertext in R2, id is server-generated or client-provided UUID), `GET /blobs/{id}` (return ciphertext) — no scene logic, no auth beyond basic abuse-rate-limiting, because the server literally cannot inspect what it's storing. This is the correct trust boundary and should not be second-guessed into "let's just also store it unencrypted for search" — that would break the entire E2E premise the feature is named for.
- Read-only: the shared link opens the app in a view-only mode (reusing phase 12's view-only toggle) — no live-editing of a shared link in this phase (that's what phase 14's collab is for); a shared link is a snapshot, not a room.
- Blob expiry/lifecycle: decide a retention policy (e.g., unreferenced blobs older than N days pruned) — flagged as a product decision needing confirmation, not silently assumed; default to "no auto-expiry in V1" (simplest, matches YAGNI) unless the user specifies otherwise, with a code comment noting where a TTL would hook in (R2 lifecycle rules) if added later.

## Requirements
- `apps/collab-server`: real Worker with R2 bucket binding, `PUT/GET /blobs/{id}` endpoints, basic rate-limiting (Cloudflare's built-in per-IP or a simple in-memory counter — no separate infra needed).
- Client-side: `share-link/encrypt-scene.ts` (compress + AES-GCM encrypt), `share-link/decrypt-scene.ts` (fetch ciphertext + decrypt via fragment key), `share-link/build-share-url.ts`.
- UI: "Share" action in the main menu (phase 12's `ActionRegistry`) generating and copying the link; a read-only viewer route in `apps/web` for `/s/:blobId`.
- Explicit test proving the key never leaves the client (network request inspection in a Playwright e2e test).

## Architecture
```
apps/collab-server/src/
├── blob-routes.ts             PUT/GET /blobs/{id}, R2 binding
└── rate-limit.ts                basic per-IP throttle
packages/engine/src/share-link/
├── encrypt-scene.ts             compress + AES-GCM encrypt
├── decrypt-scene.ts             fetch + decrypt
└── build-share-url.ts            URL construction with fragment key
```
`packages/engine` owns the crypto/compression logic (framework-agnostic, testable without a browser DOM beyond Web Crypto/Compression Streams which are available in modern test runners); `apps/collab-server` owns the dumb storage endpoint; `packages/react`'s main-menu (phase 12) wires the UI trigger.

## Related Code Files
- Create: `apps/collab-server/src/blob-routes.ts`, `rate-limit.ts` (+ tests)
- Modify: `apps/collab-server/wrangler.jsonc` (add R2 bucket binding, e.g. `deviva-draw-blobs`)
- Create: `packages/engine/src/share-link/encrypt-scene.ts`, `decrypt-scene.ts`, `build-share-url.ts` (+ `.test.ts` each)
- Create: `apps/web/src/routes/shared-scene-viewer.tsx` (read-only route)
- Modify: `packages/react/src/actions/action-registry.ts` (add "Share" action)

## Implementation Steps
1. Add R2 bucket binding to `apps/collab-server/wrangler.jsonc`; create the bucket in Cloudflare (manual/CLI step, documented in phase's Next Steps for the user to execute — cannot be automated from code alone).
2. Implement `blob-routes.ts`: `PUT /blobs/{id}` writes ciphertext bytes to R2 (with a reasonable max-size guard, mirroring phase 09's image size-limit pattern), `GET /blobs/{id}` reads and returns them; both endpoints are content-agnostic (store/return bytes, no parsing).
3. Implement `rate-limit.ts`: simple per-IP token bucket (in-memory per Worker isolate is acceptable for V1 abuse-deterrence; a Durable-Object-backed limiter is overkill pre-collab — note this can be revisited once phase 14's DO infrastructure exists, since a rate-limit DO would then be nearly free to add).
4. Implement `encrypt-scene.ts`: `CompressionStream('gzip')` → `SubtleCrypto.generateKey(AES-GCM)` → `SubtleCrypto.encrypt` → returns `{ciphertext, iv, keyBase64}`.
5. Implement `decrypt-scene.ts`: reverse path, given `{ciphertext, iv, keyBase64}` → decompressed scene JSON.
6. Implement `build-share-url.ts`: `https://draw.deviva.app/s/{blobId}#key={keyBase64}&iv={ivBase64}`.
7. Wire "Share" action: encrypt current scene → `PUT` to collab-server → build URL → copy to clipboard, with a UI confirmation (phase 12's toast/notification pattern, add if not already established).
8. Implement `shared-scene-viewer.tsx` route in `apps/web`: parses `blobId` from path + `key`/`iv` from fragment, fetches ciphertext, decrypts, renders the app shell in phase 12's view-only mode.
9. Playwright e2e test: create a share link, inspect all outgoing network requests during the share flow, assert the encryption key/fragment never appears in any request URL, header, or body sent to the server.

## Todo List
- [ ] `apps/collab-server` R2-backed blob endpoints implemented with size guard + rate limiting
- [ ] Client-side encrypt/decrypt/build-URL implemented and unit tested
- [ ] "Share" action wired in main menu
- [ ] Read-only shared-scene viewer route implemented
- [ ] E2E test proving key never leaves the client (network inspection)
- [ ] Blob retention policy decision documented in code (no auto-expiry in V1, TTL hook point noted)

## Success Criteria
- Generate a share link, open it in an incognito window (no login/session) — scene renders read-only, identical to the source.
- Network inspection (manual DevTools + automated Playwright test) confirms zero plaintext-key transmission.
- Corrupted/wrong key on the fragment fails to decrypt gracefully (clear error state, not a crash) — explicit test case.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Accidental server-side logging of full URLs (including fragment) via a proxy/CDN layer in front of the Worker | Low | High (would leak keys despite client-side design being correct) | Confirm Cloudflare's default access logs do not capture URL fragments (they structurally cannot — fragments never reach the server in HTTP) and document this explicitly so the invariant isn't accidentally broken by adding server-side fragment-parsing middleware later |
| R2 storage costs grow unbounded with no expiry | Medium | Low (cost, not correctness) | Documented as a deliberate V1 simplification; R2 lifecycle rule is a config-only follow-up, no code change needed when a retention policy is decided |
| Rate limiter (in-memory per isolate) is trivially bypassed by an attacker hitting multiple isolates | Medium | Low | Acceptable for V1 abuse-deterrence (not a security boundary — encryption is); flagged as a candidate for a real Durable-Object-backed limiter once phase 14 exists |

## Security Considerations
- This entire phase *is* a security feature — see Key Insights for the core E2E model. Additional considerations: blob IDs should be non-guessable (UUID v4 or equivalent, not sequential) so knowing the URL is required to even attempt fetching (defense in depth beyond the encryption itself).
- Rate-limit both `PUT` (abuse: filling R2 with junk) and `GET` (abuse: brute-forcing blob IDs, though non-sequential IDs make this impractical).

## Next Steps
- Blocks: nothing downstream strictly, but phase 14's collab server shares `apps/collab-server`'s deployment/infra patterns (R2 binding conventions, rate-limiting approach) — implement this phase first so 14 reuses proven patterns rather than inventing them under collab's added complexity.
- Manual step required before this phase can deploy: create the R2 bucket and confirm the Cloudflare account/zone setup (see `plan.md` unresolved question #2).
- Rollback: `apps/collab-server` blob endpoints can be disabled independently (feature-flag the "Share" action in `ActionRegistry`) without affecting the rest of the app.

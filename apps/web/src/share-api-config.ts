/**
 * The collab-server's base URL, shared by both the editable `<DevivaDraw/>` shell (for the "Share"
 * main-menu action) and the read-only `/s/{blobId}` viewer route — a single source so the two never
 * drift apart. Overridable via `VITE_SHARE_API_BASE_URL` for a deployed build; defaults to the local
 * `wrangler dev` port (see `apps/collab-server/wrangler.jsonc`) for local development.
 */
export const SHARE_API_BASE_URL = import.meta.env.VITE_SHARE_API_BASE_URL ?? "http://localhost:8788";

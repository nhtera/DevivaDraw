/**
 * `PageStore` moved to `@deviva-draw/collab-client` — it is the canonical state behind the collab
 * pages adapter, shared by the browser shell and the headless MCP live-session bridge. This
 * re-export keeps every existing `packages/react` import path (and the public API) stable.
 */
export { PageStore } from "@deviva-draw/collab-client";
export type { PageListEntry, PageStoreListener } from "@deviva-draw/collab-client";

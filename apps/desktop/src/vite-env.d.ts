/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The collab-server's base URL — see `share-api-config.ts`. Defaults to the production origin when unset. */
  readonly VITE_SHARE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

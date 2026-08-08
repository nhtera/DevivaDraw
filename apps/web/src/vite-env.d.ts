/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The collab-server's base URL — see `routes/shared-scene-viewer.tsx` and `app.tsx`. Defaults to the local `wrangler dev` port when unset. */
  readonly VITE_SHARE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

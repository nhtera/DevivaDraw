/**
 * The collab-server's base URL for the Share main-menu action. The desktop app defaults to the
 * production origin (a packaged app has no local `wrangler dev` to lean on); override with
 * `VITE_SHARE_API_BASE_URL` when developing against a local collab-server.
 */
export const SHARE_API_BASE_URL = import.meta.env.VITE_SHARE_API_BASE_URL ?? "https://collab-draw.deviva.app";

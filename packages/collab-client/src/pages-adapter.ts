/**
 * The seam between a multi-page host document and a `CollabSession`. The session never owns pages —
 * it reads/writes them through this adapter (the react layer implements it over its `PageStore`), so
 * this package stays framework-free and a single-scene host keeps working with no adapter at all.
 *
 * Page *metadata* (which pages exist, names, order) syncs as one LWW "manifest": every local page
 * operation bumps `version` + re-rolls `versionNonce`, and a remote manifest replaces the local one
 * only when it wins the same version/nonce comparison elements use (`lww-merge.ts`) — an atomic
 * whole-list decision, so all peers converge on one page list without a central arbiter. The
 * manifest rides on `snapshot` messages (never its own wire type — the relay's message whitelist
 * stays untouched); a page operation triggers a prompt snapshot, so renames don't wait for the
 * periodic timer. Element *content* stays per-element LWW, routed by the `pageId` each delta carries.
 */
import type { LayersManifest, Scene } from "@deviva-draw/engine";

export interface PagesManifestEntry {
  id: string;
  name: string;
}

export interface PagesManifest {
  version: number;
  versionNonce: number;
  pages: PagesManifestEntry[];
}

export interface CollabPagesAdapter {
  getManifest(): PagesManifest;
  /**
   * LWW-applies a remote manifest (see the module doc for the comparison); returns `true` when the
   * remote won and the local page list was reconciled to it. Implementations must reject an empty
   * `pages` list — a document always has at least one page, and a hostile peer must not be able to
   * empty it.
   */
  applyRemoteManifest(manifest: PagesManifest): boolean;
  /** Scene for a known page, `null` for an unknown/deleted id. */
  getScene(pageId: string): Scene | null;
  /**
   * Scene for a remote `pageId`, creating an empty page when the id is new — how a page born on
   * another peer materializes here before its manifest arrives. Returns `null` for a *deleted*
   * (tombstoned) page, so a delta that raced a deletion cannot resurrect it.
   */
  ensureScene(pageId: string): Scene | null;
  /** Every current page id, in order — the outbound scan walks these. */
  listPageIds(): string[];
  /**
   * The page's layers manifest for outbound snapshots, or `null` to omit it (unknown page, or a
   * never-mutated version-0 list — a peer that never touched layers has nothing to say and must
   * never outrank one that did).
   */
  getLayersManifest(pageId: string): LayersManifest | null;
  /** LWW-applies a remote page's layers manifest (already shape-validated by `isPlausibleLayersManifest`) — the engine's wholesale-adoption rule decides the winner. Unknown page ids no-op. */
  applyRemoteLayersManifest(pageId: string, manifest: LayersManifest): void;
  /** Fires on page add/remove/rename/replace — NOT on element edits or on which page is locally active (active page is a local concern and never syncs). */
  subscribe(listener: () => void): () => void;
}

/** The manifest LWW rule, shared by adapter implementations: `true` when `remote` beats `local`. Same shape as the per-element rule (`lww-merge.ts`): higher version wins outright, an equal version falls to the deterministic lexicographic nonce comparison. */
export function remoteManifestWins(local: { version: number; versionNonce: number }, remote: { version: number; versionNonce: number }): boolean {
  if (remote.version !== local.version) return remote.version > local.version;
  return String(remote.versionNonce) > String(local.versionNonce);
}

/** Structural validation for an inbound manifest — untrusted wire data, same policy as `isPlausibleRemoteElement`. */
export function isPlausibleManifest(value: unknown): value is PagesManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Record<string, unknown>;
  if (typeof manifest.version !== "number" || !Number.isFinite(manifest.version)) return false;
  if (typeof manifest.versionNonce !== "number" || !Number.isFinite(manifest.versionNonce)) return false;
  if (!Array.isArray(manifest.pages) || manifest.pages.length === 0) return false;
  return manifest.pages.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const page = entry as Record<string, unknown>;
    return typeof page.id === "string" && page.id.length > 0 && typeof page.name === "string";
  });
}

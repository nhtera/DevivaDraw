/**
 * The document's page list — the single source of truth for which pages exist, their names/order,
 * which one is active, and each page's parked camera. Framework-free class with a change signal
 * (the same "no state library" pattern as the engine's `Scene`/`SelectionState`). It lives in this
 * package (not the react one) because it IS the canonical `CollabPagesAdapter` state: the browser
 * shell and the headless MCP live-session bridge both run this exact class, so multi-page LWW
 * manifest semantics (versions, tombstones, union merge) exist in one place. The react package
 * re-exports it; `use-deviva-runtime` subscribes and rebuilds the runtime around the new active
 * `Scene` whenever the active page changes, so page switching, file open, and "new scene" all flow
 * through this one store instead of three separate swap paths.
 *
 * Inactive pages keep their live `Scene` instances — an engine `Scene` is independent of any mounted
 * runtime, which is also what lets a collab session apply remote edits to a page that isn't on screen.
 */
import { generatePageId, Scene, serializeMultiPageDocument } from "@deviva-draw/engine";
import type { Camera, MultiPageDocumentV1, ScenePage } from "@deviva-draw/engine";
import type { PagesManifest } from "./pages-adapter";

export interface PageListEntry {
  id: string;
  name: string;
}

export type PageStoreListener = () => void;

interface PageEntry {
  id: string;
  name: string;
  scene: Scene;
  /** Camera parked when the user last left this page — `null` until first visited-and-left. */
  camera: Camera | null;
}

/** `pages` must be non-empty (a document always has at least one page — `removePage` enforces the same). */
export class PageStore {
  private pages: PageEntry[];
  private activeId: string;
  private readonly listeners = new Set<PageStoreListener>();
  // Page-list LWW state for collab (see `@deviva-draw/collab-client`'s `pages-adapter.ts`): every
  // local page operation bumps the version and re-rolls the nonce; a remote manifest replaces the
  // list only when it wins the same comparison elements use. Deleted page ids are tombstoned so an
  // in-flight remote delta can't resurrect a page a peer just watched disappear.
  private manifestVersion = 1;
  private manifestNonce = rollNonce();
  private readonly tombstonedPageIds = new Set<string>();

  constructor(pages: readonly ScenePage[], activePageId: string | null) {
    if (pages.length === 0) throw new Error("PageStore requires at least one page");
    // Seed parked cameras from the deserialized document (when it carried them) so the first visit
    // to any page — including the very first paint — lands on the viewport the writer saved.
    this.pages = pages.map((page) => ({ id: page.id, name: page.name, scene: page.scene, camera: page.camera ?? null }));
    this.activeId = activePageId !== null && this.pages.some((page) => page.id === activePageId) ? activePageId : this.pages[0]!.id;
  }

  /** A brand-new single-page document around an (optionally provided) scene. */
  static fresh(scene: Scene = new Scene()): PageStore {
    return new PageStore([{ id: generatePageId(), name: "Page 1", scene }], null);
  }

  subscribe(listener: PageStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getPages(): PageListEntry[] {
    return this.pages.map((page) => ({ id: page.id, name: page.name }));
  }

  getActivePageId(): string {
    return this.activeId;
  }

  getActiveScene(): Scene {
    return this.entry(this.activeId)!.scene;
  }

  getSceneById(id: string): Scene | null {
    return this.entry(id)?.scene ?? null;
  }

  setActivePage(id: string): void {
    if (id === this.activeId || !this.entry(id)) return;
    this.activeId = id;
    this.notify();
  }

  /** Creates an empty page after the current last one and switches to it. Returns the new id. */
  addPage(name?: string): string {
    const id = generatePageId();
    this.pages.push({ id, name: name ?? `Page ${this.pages.length + 1}`, scene: new Scene(), camera: null });
    this.activeId = id;
    this.bumpManifest();
    this.notify();
    return id;
  }

  renamePage(id: string, name: string): void {
    const page = this.entry(id);
    const trimmed = name.trim();
    if (!page || trimmed === "" || page.name === trimmed) return;
    page.name = trimmed;
    this.bumpManifest();
    this.notify();
  }

  /** Deletes a page — refused for the last remaining one. Deleting the active page activates its neighbor. */
  removePage(id: string): boolean {
    if (this.pages.length <= 1) return false;
    const index = this.pages.findIndex((page) => page.id === id);
    if (index === -1) return false;
    this.pages.splice(index, 1);
    this.tombstonedPageIds.add(id);
    if (this.activeId === id) this.activeId = this.pages[Math.min(index, this.pages.length - 1)]!.id;
    this.bumpManifest();
    this.notify();
    return true;
  }

  /** Parks the camera the user is leaving a page at — read back on the next visit. */
  saveCameraFor(id: string, camera: Camera): void {
    const page = this.entry(id);
    if (page) page.camera = camera;
  }

  cameraFor(id: string): Camera | null {
    return this.entry(id)?.camera ?? null;
  }

  /** Replaces the whole document (file open, "new scene", share-link load). Seeds parked cameras from the incoming pages — same reason as the constructor. */
  replaceAll(pages: readonly ScenePage[], activePageId: string | null): void {
    if (pages.length === 0) return;
    this.pages = pages.map((page) => ({ id: page.id, name: page.name, scene: page.scene, camera: page.camera ?? null }));
    this.activeId = activePageId !== null && this.pages.some((page) => page.id === activePageId) ? activePageId : this.pages[0]!.id;
    this.bumpManifest();
    this.notify();
  }

  /**
   * The serialized document — `includeDeleted: true` for autosave (undo across reload), `false` for
   * exports/files. `activeCamera` is the live viewport of the page currently on screen: the store
   * only holds cameras *parked* on leaving a page, so without it the active page would serialize
   * with a stale (or missing) viewport. Parked here first so the write sees a consistent set.
   */
  toDocument(includeDeleted: boolean, activeCamera?: Camera): MultiPageDocumentV1 {
    if (activeCamera) this.saveCameraFor(this.activeId, activeCamera);
    return serializeMultiPageDocument(
      this.pages.map((page) => ({ id: page.id, name: page.name, scene: page.scene, camera: page.camera })),
      { activePageId: this.activeId, includeDeleted },
    );
  }

  /** The LWW page-list manifest collab publishes — see the field doc above. */
  getManifest(): PagesManifest {
    return { version: this.manifestVersion, versionNonce: this.manifestNonce, pages: this.getPages() };
  }

  /**
   * Scene for a remote page id, creating an empty page when the id is new — how a page born on a
   * peer materializes locally before its manifest arrives. Deliberately no manifest bump: the
   * *creating* peer's manifest already announces this page, and bumping here would start a nonce war
   * between receivers. Returns `null` for a tombstoned (deleted) page.
   */
  ensureRemotePage(pageId: string): Scene | null {
    if (this.tombstonedPageIds.has(pageId)) return null;
    const existing = this.entry(pageId);
    if (existing) return existing.scene;
    const scene = new Scene();
    this.pages.push({ id: pageId, name: `Page ${this.pages.length + 1}`, scene, camera: null });
    this.notify();
    return scene;
  }

  /**
   * Applies a remote page-list manifest. A strictly *newer* version is adopted wholesale (pages
   * added/renamed/reordered/removed, tombstones updated) — that's how deletes and renames propagate.
   * An *equal* version is resolved by commutative UNION: every remote page this side doesn't know
   * (and hasn't tombstoned) is appended, nothing is removed, and a shared page's name falls to a
   * deterministic string comparison — so two peers that each started their own v1 document converge
   * on "both boards, side by side" instead of one silently clobbering the other, mirroring what
   * joining a room has always meant for elements. A strictly older version is refused outright.
   * Returns `true` when anything local changed.
   */
  applyRemoteManifest(remote: PagesManifest): boolean {
    if (remote.pages.length === 0) return false; // a document always has a page; a hostile peer must not empty it
    if (remote.version < this.manifestVersion) return false;

    if (remote.version > this.manifestVersion) {
      const nextPages = remote.pages.map((entry) => {
        this.tombstonedPageIds.delete(entry.id); // the winning manifest says it exists
        const existing = this.entry(entry.id);
        return existing ? { ...existing, name: entry.name } : { id: entry.id, name: entry.name, scene: new Scene(), camera: null };
      });
      for (const page of this.pages) {
        if (!remote.pages.some((entry) => entry.id === page.id)) this.tombstonedPageIds.add(page.id);
      }
      this.pages = nextPages;
      if (!this.pages.some((page) => page.id === this.activeId)) this.activeId = this.pages[0]!.id;
      this.manifestVersion = remote.version;
      this.manifestNonce = remote.versionNonce;
      this.notify();
      return true;
    }

    let changed = false;
    for (const entry of remote.pages) {
      const existing = this.entry(entry.id);
      if (existing) {
        if (existing.name !== entry.name && entry.name > existing.name) {
          existing.name = entry.name;
          changed = true;
        }
      } else if (!this.tombstonedPageIds.has(entry.id)) {
        this.pages.push({ id: entry.id, name: entry.name, scene: new Scene(), camera: null });
        changed = true;
      }
    }
    if (changed) this.notify();
    return changed;
  }

  private bumpManifest(): void {
    this.manifestVersion += 1;
    this.manifestNonce = rollNonce();
  }

  private entry(id: string): PageEntry | undefined {
    return this.pages.find((page) => page.id === id);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** Collision-resistant enough for LWW tiebreaks — same "unlikely, not secure" bar as element nonces. */
function rollNonce(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/**
 * The document's page list — the single source of truth for which pages exist, their names/order,
 * which one is active, and each page's parked camera. Framework-free class with a change signal
 * (the same "no state library" pattern as the engine's `Scene`/`SelectionState`): `use-deviva-runtime`
 * subscribes and rebuilds the runtime around the new active `Scene` whenever the active page changes,
 * so page switching, file open, and "new scene" all flow through this one store instead of three
 * separate swap paths.
 *
 * Inactive pages keep their live `Scene` instances — an engine `Scene` is independent of any mounted
 * runtime, which is also what lets a collab session apply remote edits to a page that isn't on screen.
 */
import { generatePageId, Scene, serializeMultiPageDocument } from "@deviva-draw/engine";
import type { Camera, MultiPageDocumentV1, ScenePage } from "@deviva-draw/engine";

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

  constructor(pages: readonly ScenePage[], activePageId: string | null) {
    if (pages.length === 0) throw new Error("PageStore requires at least one page");
    this.pages = pages.map((page) => ({ id: page.id, name: page.name, scene: page.scene, camera: null }));
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
    this.notify();
    return id;
  }

  renamePage(id: string, name: string): void {
    const page = this.entry(id);
    const trimmed = name.trim();
    if (!page || trimmed === "" || page.name === trimmed) return;
    page.name = trimmed;
    this.notify();
  }

  /** Deletes a page — refused for the last remaining one. Deleting the active page activates its neighbor. */
  removePage(id: string): boolean {
    if (this.pages.length <= 1) return false;
    const index = this.pages.findIndex((page) => page.id === id);
    if (index === -1) return false;
    this.pages.splice(index, 1);
    if (this.activeId === id) this.activeId = this.pages[Math.min(index, this.pages.length - 1)]!.id;
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

  /** Replaces the whole document (file open, "new scene", share-link load). */
  replaceAll(pages: readonly ScenePage[], activePageId: string | null): void {
    if (pages.length === 0) return;
    this.pages = pages.map((page) => ({ id: page.id, name: page.name, scene: page.scene, camera: null }));
    this.activeId = activePageId !== null && this.pages.some((page) => page.id === activePageId) ? activePageId : this.pages[0]!.id;
    this.notify();
  }

  /** The serialized document — `includeDeleted: true` for autosave (undo across reload), `false` for exports/files. */
  toDocument(includeDeleted: boolean): MultiPageDocumentV1 {
    return serializeMultiPageDocument(
      this.pages.map((page) => ({ id: page.id, name: page.name, scene: page.scene })),
      { activePageId: this.activeId, includeDeleted },
    );
  }

  private entry(id: string): PageEntry | undefined {
    return this.pages.find((page) => page.id === id);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

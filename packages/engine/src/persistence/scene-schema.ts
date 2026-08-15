/**
 * Versioned JSON shape a `Scene` serializes to/from — the wire format for localStorage autosave, a
 * saved `.devivadraw` file, and, by design, the same envelope encrypted share payloads and realtime
 * collab snapshots can reuse rather than inventing their own scene representation. `schemaVersion`
 * exists from this very first version (not bolted on later): every future change to the element model
 * or this envelope is a migration keyed off it (see `migrations.ts`), so an already-saved document
 * never becomes unreadable just because the app evolved after it was written. `type` is a second,
 * independent discriminator (a fixed string, never bumped) so a completely unrelated JSON file — or a
 * `.devivadraw` file from some other, future format entirely — is rejected immediately by
 * `scene-validation.ts` instead of being misread as a corrupt scene of some schema version.
 */
import type { AnyElement } from "../elements/element-types";

/** Fixed envelope discriminator — see the module doc. Never changes across schema versions. */
export const SCENE_DOCUMENT_TYPE = "devivadraw/scene";

/** The schema version this build reads/writes by default. Bump only alongside a new entry in `migrations.ts`'s registry. */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Plain-data mirror of `images/files-map.ts`'s `StoredFile` — kept as its own type (rather than
 * reusing `StoredFile` directly) so this schema module has zero import dependency on the files-map
 * implementation; the two shapes are identical today by construction, not by type alias.
 */
export interface SerializedStoredFile {
  mimeType: string;
  dataURL: string;
  createdAt: number;
}

/**
 * Minimal, deliberately small "where the user was looking" snapshot — camera position only. Kept
 * optional and tiny on purpose (YAGNI): the full app-level UI state (active tool, style-picker
 * selections, grid on/off, ...) belongs to the UI chrome layer, not the engine's persistence format:
 * this schema only owns what the *scene document itself* needs to round-trip meaningfully.
 */
export interface SerializedAppState {
  scrollX?: number;
  scrollY?: number;
  zoom?: number;
  /** Document-level canvas background color (see `Scene.getBackground`); absent ⇒ the theme default. */
  background?: string;
}

/** Plain-data mirror of `scene/scene-layers.ts`'s `SceneLayer` — same zero-import-dependency reasoning as `SerializedStoredFile`. */
export interface SerializedLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

export interface SceneDocumentV1 {
  type: typeof SCENE_DOCUMENT_TYPE;
  schemaVersion: 1;
  /** Live scene z-order (see `Scene.getElements()`) — export strips soft-deleted elements, autosave keeps them; see `serialize-scene.ts`. */
  elements: AnyElement[];
  /** Keyed by `fileId` (content hash) — only files still referenced by `elements` are written; see `serialize-scene.ts`. */
  files: Record<string, SerializedStoredFile>;
  appState?: SerializedAppState;
  /**
   * Ordered bottom→top layer list — ADDITIVE and written only when non-trivial (anything beyond
   * one default layer), so pre-layers builds and untouched scenes keep their exact historical
   * shape. Absent ⇒ one default layer owning every element. Old builds drop this field on resave
   * (their validators rebuild the envelope) while preserving per-element `layerId`s — the reader
   * degrades that to "everything on the default layer", never to lost elements.
   */
  layers?: SerializedLayer[];
  /** The layer new elements land on — a soft default seeded on load, never authoritative for collab peers. */
  activeLayerId?: string;
}

/**
 * The union of every schema version this build can still *read* (after migration, always narrowed to
 * `SceneDocumentV1` today — see `migrations.ts`). A future version 2 would extend this union; nothing
 * outside `persistence/`/`export/` should assume a document is always exactly v1 forever.
 */
export type SceneDocument = SceneDocumentV1;

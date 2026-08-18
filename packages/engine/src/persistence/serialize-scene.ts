/**
 * The `Scene` <-> JSON boundary: `serializeScene` turns a live `Scene` into the versioned document
 * shape (`scene-schema.ts`); `deserializeScene` does the reverse for data arriving from outside the
 * app (localStorage, a dropped `.devivadraw` file, an embedded PNG/SVG payload) — the only place
 * untrusted JSON is allowed to become a live `Scene`. `Scene.toJSON`/`Scene.fromJSON` (`scene/scene.ts`)
 * are thin wrappers around these two functions; the validation/migration/restore logic lives here so
 * it stays independently testable without going through `Scene`'s public surface for every edge case.
 */
import type { ArrowElement } from "../elements/arrow-element";
import type { TextElement } from "../elements/text-element";
import { Scene } from "../scene/scene";
import { isBindableContainer } from "../text/bound-text";
import { applyMigrations, UnsupportedSchemaVersionError } from "./migrations";
import type { SceneDocumentV1, SerializedAppState } from "./scene-schema";
import { CURRENT_SCHEMA_VERSION, SCENE_DOCUMENT_TYPE } from "./scene-schema";
import { validateSceneDocument, validateSceneDocumentLenient } from "./scene-validation";

export interface SerializeSceneOptions {
  /**
   * `true` keeps soft-deleted (`isDeleted`) elements in the output — the autosave path
   * (`local-storage-autosave.ts`) needs this so undo can still restore a delete across a page reload.
   * `false` (the default, used by every export path) strips them: an exported file/image represents
   * the scene a viewer actually sees, and tombstones are pure internal bookkeeping no export consumer
   * should ever see.
   */
  includeDeleted?: boolean;
  appState?: SerializedAppState;
  /**
   * Drops hidden-layer elements from the output. A CALL-SITE decision for export-embedded payloads
   * only (a PNG's re-open chunk / an SVG's metadata block must never carry content the pixels
   * exclude — hiding controls what's shown AND what an export file contains); save/autosave/share
   * paths must never set this — those are the full-fidelity document formats.
   */
  excludeHidden?: boolean;
  /**
   * Leaves these files' bytes out of `files`, keeping the elements' `fileId` references intact — for
   * a host that persists the payloads separately (see `file-store.ts` for why: base64 image bytes are
   * what exhausts a small synchronous store, and they don't have to live there).
   *
   * A SET rather than a flag, deliberately: a file may only be left out once it is *known* to be
   * stored elsewhere. Excluding one whose separate write hasn't landed yet would mean neither copy
   * exists, which is how a "storage optimization" turns into data loss. Autosave paths pass the ids
   * they have confirmation for; every export/save/share path passes nothing, because a document that
   * leaves this app has to be self-contained to be worth anything. The `files` key itself always
   * stays present — validation requires it, and every reader expects the shape.
   */
  excludeFileIds?: ReadonlySet<string>;
}

/**
 * Live `Scene` -> the versioned JSON document shape — see the module doc and
 * `SerializeSceneOptions.includeDeleted`'s doc for the export-vs-autosave split. Only files still
 * referenced by an included element are written out: an already-orphaned file left over from a
 * since-deleted image never bloats the output.
 */
export function serializeScene(scene: Scene, options: SerializeSceneOptions = {}): SceneDocumentV1 {
  const { includeDeleted = false, appState, excludeHidden = false, excludeFileIds } = options;
  const elements = scene.getElements().filter((element) => (includeDeleted || !element.isDeleted) && !(excludeHidden && scene.isElementHidden(element)));

  const referencedFileIds = new Set<string>();
  for (const element of elements) {
    if (element.type === "image") referencedFileIds.add(element.fileId);
  }
  const files: SceneDocumentV1["files"] = {};
  for (const fileId of referencedFileIds) {
    if (excludeFileIds?.has(fileId)) continue;
    const file = scene.getFile(fileId);
    if (file) files[fileId] = { mimeType: file.mimeType, dataURL: file.dataURL, createdAt: file.createdAt };
  }

  const document: SceneDocumentV1 = { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements, files };
  // Merge the scene's own document-level background into appState so it rides every save/autosave/share
  // path (all of which go through here) without each caller having to remember to pass it in options.
  const background = scene.getBackground();
  const mergedAppState = { ...appState, ...(background !== null ? { background } : {}) };
  if (Object.keys(mergedAppState).length > 0) document.appState = mergedAppState;
  // Layers ride every save path too, but ONLY when non-trivial — an untouched scene's output stays
  // byte-identical to a pre-layers build (the additive-schema compatibility contract).
  if (scene.hasNonTrivialLayers()) {
    document.layers = scene.getLayers();
    document.activeLayerId = scene.getActiveLayerId();
  }
  // Comments ride every save path under the same "only when non-empty" rule, so a scene that never
  // had a comment stays byte-identical to pre-comments output. Tombstoned threads/messages are
  // included deliberately (unlike elements' `includeDeleted`): a comment deletion that vanished on
  // save could be out-voted by a peer's stale copy and resurrect the thread.
  if (scene.hasComments()) {
    document.comments = scene.getAllCommentThreads();
    document.commentMessages = scene.getAllCommentMessages();
  }
  return document;
}

export type DeserializeSceneResult = { ok: true; scene: Scene } | { ok: false; error: string };

/**
 * Clears every dangling or otherwise-invalid cross-reference left over from input that passed
 * structural validation (each field's own type was correct) but points somewhere it shouldn't — a
 * missing element id, a self-reference, or a reference to an element of the wrong kind. Hand-edited or
 * corrupted JSON, not the normal save/load path: arrow bindings, bound-text `containerId`,
 * `boundElements` back-refs, and `frameId`. Deliberately does *not* reuse `bindings/binding-model.ts`'s
 * bind/unbind helpers — those assume both sides of a reference are already consistent before the call,
 * which is exactly what a dangling/invalid ref (by definition) is not; this is a one-sided best-effort
 * repair over data already known to be inconsistent, not a normal bind/unbind transition.
 */
function repairDanglingReferences(scene: Scene): void {
  const liveIds = new Set(scene.getElements().map((element) => element.id));

  for (const element of scene.getElements()) {
    if (element.type === "arrow") {
      const changes: Partial<ArrowElement> = {};
      if (element.startBinding && !liveIds.has(element.startBinding.elementId)) changes.startBinding = null;
      if (element.endBinding && !liveIds.has(element.endBinding.elementId)) changes.endBinding = null;
      if (Object.keys(changes).length > 0) scene.updateElement(element.id, changes);
    }
    if (element.type === "text" && element.containerId) {
      // A container can never be the text element itself (a self-reference is a degenerate 1-element
      // cycle) or a non-bindable element type (e.g. text bound to another text, or to an arrow) — both
      // pass structural validation (a plain string id) but would make `containerId` traversal
      // (bound-text layout, container-resize sync) walk into nonsense the moment it goes multi-hop.
      const container = element.containerId === element.id ? undefined : scene.getElement(element.containerId);
      if (!container || !isBindableContainer(container)) {
        const changes: Partial<TextElement> = { containerId: null };
        scene.updateElement(element.id, changes);
      }
    }
    // `frameId`/`boundElements` are common `BaseElement` fields shared by every element type, so
    // these two checks apply uniformly regardless of `element.type`.
    if (element.frameId && !liveIds.has(element.frameId)) {
      scene.updateElement(element.id, { frameId: null });
    }
    if (element.boundElements) {
      const filtered = element.boundElements.filter((ref) => liveIds.has(ref.id));
      if (filtered.length !== element.boundElements.length) scene.updateElement(element.id, { boundElements: filtered });
    }
  }
}

/**
 * JSON (from any untrusted source) -> a brand-new, fully-populated `Scene`, or a descriptive error —
 * never a thrown exception, and never a partially-populated `Scene` handed back to the caller: every
 * validation/migration step runs against the raw document *before* any element or file is inserted
 * into the freshly-constructed `Scene`. Elements/files are restored via `Scene`'s trusted restore path
 * (`restoreElement`/`restoreFile`), not `addElement`/`addFile`, so a reload doesn't masquerade as a
 * fresh edit — see `scene/scene.ts`'s doc on those methods for why that distinction matters.
 */
export function deserializeScene(raw: unknown): DeserializeSceneResult {
  try {
    const migrated = migrateRawDocument(raw);
    if (!migrated.ok) return { ok: false, error: migrated.error };

    const validated = validateSceneDocument(migrated.document);
    if (!validated.ok) return { ok: false, error: validated.error };

    return { ok: true, scene: buildSceneFromDocument(validated.value) };
  } catch (error) {
    if (error instanceof UnsupportedSchemaVersionError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "unknown error deserializing scene" };
  }
}

export type DeserializeSceneLenientResult = { ok: true; scene: Scene; droppedErrors: string[] } | { ok: false; error: string };

/**
 * Entry-level-salvage variant of `deserializeScene` for restore paths where a rejected document is
 * *destroyed*, not merely "not opened" — the localStorage autosave (`local-storage-autosave.ts`), whose
 * stored value the next debounced write overwrites. Same envelope/migration gate, but validation drops
 * an invalid element/file entry (reported in `droppedErrors`) instead of failing the whole load; see
 * `validateSceneDocumentLenient`. File-open paths deliberately keep using the strict `deserializeScene`:
 * there the source file survives rejection untouched, and a hard error is the honest answer.
 */
export function deserializeSceneLenient(raw: unknown): DeserializeSceneLenientResult {
  try {
    const migrated = migrateRawDocument(raw);
    if (!migrated.ok) return { ok: false, error: migrated.error };

    const validated = validateSceneDocumentLenient(migrated.document);
    if (!validated.ok) return { ok: false, error: validated.error };

    return { ok: true, scene: buildSceneFromDocument(validated.value.document), droppedErrors: validated.value.droppedErrors };
  } catch (error) {
    if (error instanceof UnsupportedSchemaVersionError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "unknown error deserializing scene" };
  }
}

/** Shared envelope check + migration for both deserializers: raw JSON in, a document at `CURRENT_SCHEMA_VERSION`'s shape (not yet validated) out. */
function migrateRawDocument(raw: unknown): { ok: true; document: unknown } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "scene document must be a JSON object" };
  }
  const envelope = raw as Record<string, unknown>;
  if (envelope.type !== SCENE_DOCUMENT_TYPE) {
    return { ok: false, error: `scene document "type" must be "${SCENE_DOCUMENT_TYPE}"` };
  }
  if (typeof envelope.schemaVersion !== "number" || !Number.isInteger(envelope.schemaVersion) || envelope.schemaVersion < 1) {
    return { ok: false, error: 'scene document "schemaVersion" must be a positive integer' };
  }
  return { ok: true, document: applyMigrations(envelope, envelope.schemaVersion) };
}

/** Shared `Scene` construction from an already-validated document — restore paths only (see `deserializeScene`'s doc for why `restoreElement`/`restoreFile`, not `addElement`/`addFile`). */
function buildSceneFromDocument(document: SceneDocumentV1): Scene {
  const scene = new Scene();
  // Layers first, so element membership resolves against the real list from the first read; an
  // absent/empty list keeps the constructor's default layer (`replaceLayers` refuses empties — the
  // hostile-input guard). `activeLayerId` is a soft default only (see the schema doc).
  if (document.layers !== undefined) scene.replaceLayers(document.layers, document.activeLayerId);
  if (document.comments !== undefined || document.commentMessages !== undefined) {
    scene.replaceComments(document.comments ?? [], document.commentMessages ?? []);
  }
  for (const [fileId, file] of Object.entries(document.files)) scene.restoreFile(fileId, file);
  for (const element of document.elements) scene.restoreElement(element);
  if (document.appState?.background !== undefined) scene.setBackground(document.appState.background);
  repairDanglingReferences(scene);
  return scene;
}

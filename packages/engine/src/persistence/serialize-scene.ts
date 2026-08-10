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
import { validateSceneDocument } from "./scene-validation";

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
}

/**
 * Live `Scene` -> the versioned JSON document shape — see the module doc and
 * `SerializeSceneOptions.includeDeleted`'s doc for the export-vs-autosave split. Only files still
 * referenced by an included element are written out: an already-orphaned file left over from a
 * since-deleted image never bloats the output.
 */
export function serializeScene(scene: Scene, options: SerializeSceneOptions = {}): SceneDocumentV1 {
  const { includeDeleted = false, appState } = options;
  const elements = scene.getElements().filter((element) => includeDeleted || !element.isDeleted);

  const referencedFileIds = new Set<string>();
  for (const element of elements) {
    if (element.type === "image") referencedFileIds.add(element.fileId);
  }
  const files: SceneDocumentV1["files"] = {};
  for (const fileId of referencedFileIds) {
    const file = scene.getFile(fileId);
    if (file) files[fileId] = { mimeType: file.mimeType, dataURL: file.dataURL, createdAt: file.createdAt };
  }

  const document: SceneDocumentV1 = { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements, files };
  // Merge the scene's own document-level background into appState so it rides every save/autosave/share
  // path (all of which go through here) without each caller having to remember to pass it in options.
  const background = scene.getBackground();
  const mergedAppState = { ...appState, ...(background !== null ? { background } : {}) };
  if (Object.keys(mergedAppState).length > 0) document.appState = mergedAppState;
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

    const migrated = applyMigrations(envelope, envelope.schemaVersion);
    const validated = validateSceneDocument(migrated);
    if (!validated.ok) return { ok: false, error: validated.error };

    const scene = new Scene();
    for (const [fileId, file] of Object.entries(validated.value.files)) scene.restoreFile(fileId, file);
    for (const element of validated.value.elements) scene.restoreElement(element);
    if (validated.value.appState?.background !== undefined) scene.setBackground(validated.value.appState.background);
    repairDanglingReferences(scene);

    return { ok: true, scene };
  } catch (error) {
    if (error instanceof UnsupportedSchemaVersionError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "unknown error deserializing scene" };
  }
}

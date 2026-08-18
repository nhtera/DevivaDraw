/**
 * Structural validation for scene JSON coming from an untrusted source (localStorage, a dropped
 * `.devivadraw` file, a pasted PNG/SVG's embedded metadata) — the *only* gate between arbitrary,
 * possibly hand-edited/corrupted input and a live `Scene`. Every check here is defensive: reject
 * anything that doesn't match the expected shape rather than trust it and risk a `Scene`/renderer
 * crash later on a missing or wrong-typed field. Runs *after* `migrations.ts` has already brought the
 * document up to `CURRENT_SCHEMA_VERSION`'s shape, so this only ever validates one (the current)
 * schema shape, not every historical version.
 */
import type { AnyElement } from "../elements/element-types";
import { CURRENT_SCHEMA_VERSION, SCENE_DOCUMENT_TYPE } from "./scene-schema";
import type { SceneDocumentV1, SerializedAppState, SerializedLayer, SerializedStoredFile } from "./scene-schema";
import { validateCommentRecords } from "./comment-validation";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Hostile-document ceilings — pure decompression-bomb/DoS guards, deliberately far above any real
 * board (validation decision, 2026-08-16: generous on purpose; a product limit these are not).
 * `maxDocumentBytes` is enforced where raw text exists (file-open boundaries and the desktop shell's
 * on-disk pre-check) since parsed JSON no longer knows its serialized size; the rest are enforced
 * here and in `multi-page-document.ts`. Centralized so tuning is one edit.
 */
export const DOCUMENT_CEILINGS = {
  /** Elements per scene (per page) — and, via `multi-page-document.ts`, across a whole document. */
  maxElements: 100_000,
  /** Whole-document serialized size in bytes/chars, checked at text boundaries before parsing. */
  maxDocumentBytes: 50 * 1024 * 1024,
  /** One embedded file's dataURL length — a single 20MB+ image entry is a memory bomb, not artwork. */
  maxFileDataUrlChars: 20 * 1024 * 1024,
  /** Pages per multi-page document. */
  maxPages: 500,
} as const;

/**
 * Scene-load twin of the UI entry gate in `@deviva-draw/react`'s `components/link-url.ts`: only
 * absolute `http:`/`https:` URLs survive a load. A `javascript:`/`data:`/`file:` link in a crafted
 * `.devivadraw` file would otherwise flow into the link-open anchor path — with OS file association
 * (double-click opens the file), that is an untrusted-input XSS surface, so it is closed at the one
 * gate every load path shares.
 */
const isSafeLinkUrl = (link: string): boolean => {
  try {
    const protocol = new URL(link).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const ok = <T>(value: T): ValidationResult<T> => ({ ok: true, value });
const fail = <T>(error: string): ValidationResult<T> => ({ ok: false, error });

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
/** Stricter than `isFiniteNumber` for fields where a negative value is nonsensical (a box/image can't have negative width/height) — a hand-edited `width: -50` would otherwise pass structural validation and silently corrupt downstream bounds math (e.g. `computeExportBounds`'s union bbox, or the culling/rendering AABB tests) with a degenerate or excluded footprint instead of being rejected up front. */
const isNonNegativeFiniteNumber = (value: unknown): value is number => isFiniteNumber(value) && value >= 0;
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
/** A `BaseElement.scale` pair: exactly two entries, each +1 or -1 (see `elements/element-mirror.ts` — it records mirroring, not resizing). */
const isMirrorScale = (value: unknown): boolean => Array.isArray(value) && value.length === 2 && value.every((entry) => entry === 1 || entry === -1);

const isOneOf = <T extends string>(value: unknown, options: readonly T[]): value is T => typeof value === "string" && (options as readonly string[]).includes(value);

const FILL_STYLES = ["hachure", "cross-hatch", "solid", "zigzag"] as const;
const STROKE_STYLES = ["solid", "dashed", "dotted"] as const;
const ELEMENT_TYPES = [
  "generic", "rectangle", "ellipse", "diamond", "triangle", "hexagon", "star",
  "parallelogram", "trapezoid", "cylinder", "double-circle",
  "block-arrow", "cloud", "heart", "x-box", "check-box",
  "line", "freedraw", "text", "arrow", "image", "frame", "note", "embed", "table",
] as const;

// Table grid caps — literal duplicates of `elements/table-layout.ts`'s MAX_TABLE_ROWS/MAX_TABLE_COLS/
// MAX_TABLE_CELL_CHARS (this module keeps zero scene-implementation imports, the MAX_LAYER_ENTRIES
// convention); change both places together.
const MAX_TABLE_ROWS = 64;
const MAX_TABLE_COLS = 16;
const MAX_TABLE_CELL_CHARS = 4000;
/** Literal duplicate of `elements/frame-element.ts`'s MAX_FRAME_NOTES_LENGTH, same convention as the table caps above; change both together. */
const MAX_FRAME_NOTES_LENGTH = 4000;
/** A table band size: finite and strictly positive — a zero/negative column or row is degenerate geometry. */
const isPositiveFiniteNumber = (value: unknown): value is number => isFiniteNumber(value) && value > 0;
const BLOCK_ARROW_DIRECTIONS = ["left", "right", "up", "down"] as const;
const TEXT_FONT_FAMILIES = ["normal", "code", "hand-drawn-slot"] as const;
const TEXT_ALIGNS = ["left", "center", "right"] as const;
const VERTICAL_ALIGNS = ["top", "middle", "bottom"] as const;
const ARROWHEADS = ["none", "arrow", "bar", "dot", "triangle"] as const;
const ARROW_TYPES = ["straight", "curved", "elbow"] as const;

const isPoint = (value: unknown): value is { x: number; y: number } => isPlainObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
const isFreedrawPoint = (value: unknown): value is [number, number, number] => Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber);
const isBoundElementRef = (value: unknown): value is { id: string; type: string } => isPlainObject(value) && isString(value.id) && isString(value.type);
const isFixedPoint = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber);

/** Validates every `BaseElement` field present on `raw`, common to all 9 element types. Returns an error string describing the first problem found, or `null` once every base field checks out. */
function validateBaseFields(raw: Record<string, unknown>, index: number): string | null {
  const label = `elements[${index}]`;
  if (!isString(raw.id)) return `${label}.id must be a string`;
  if (!isOneOf(raw.type, ELEMENT_TYPES)) return `${label}.type must be one of ${ELEMENT_TYPES.join(", ")}`;
  for (const field of ["x", "y", "angle", "strokeWidth", "roughness", "opacity", "seed", "version", "versionNonce", "updated"] as const) {
    if (!isFiniteNumber(raw[field])) return `${label}.${field} must be a finite number`;
  }
  if (!isNonNegativeFiniteNumber(raw.width)) return `${label}.width must be a non-negative finite number`;
  if (!isNonNegativeFiniteNumber(raw.height)) return `${label}.height must be a non-negative finite number`;
  if (!isString(raw.strokeColor)) return `${label}.strokeColor must be a string`;
  if (!isString(raw.backgroundColor)) return `${label}.backgroundColor must be a string`;
  if (!isOneOf(raw.fillStyle, FILL_STYLES)) return `${label}.fillStyle must be one of ${FILL_STYLES.join(", ")}`;
  if (!isOneOf(raw.strokeStyle, STROKE_STYLES)) return `${label}.strokeStyle must be one of ${STROKE_STYLES.join(", ")}`;
  if (!(raw.roundness === null || (isPlainObject(raw.roundness) && isFiniteNumber(raw.roundness.type)))) return `${label}.roundness must be null or {type: number}`;
  // Absent on anything never flipped, and on every scene saved before mirroring existed — both must load.
  if (raw.scale !== undefined && !isMirrorScale(raw.scale)) return `${label}.scale must be a [±1, ±1] pair when present`;
  if (!(Array.isArray(raw.groupIds) && raw.groupIds.every(isString))) return `${label}.groupIds must be a string array`;
  if (!(raw.frameId === null || isString(raw.frameId))) return `${label}.frameId must be a string or null`;
  if (!(raw.boundElements === null || (Array.isArray(raw.boundElements) && raw.boundElements.every(isBoundElementRef)))) {
    return `${label}.boundElements must be null or an array of {id, type} refs`;
  }
  if (!(raw.link === null || isString(raw.link))) return `${label}.link must be a string or null`;
  if (!isBoolean(raw.locked)) return `${label}.locked must be a boolean`;
  if (!isString(raw.index)) return `${label}.index must be a string`;
  // Absent on every default-layer element and every pre-layers document — both must load.
  if (raw.layerId !== undefined && !isString(raw.layerId)) return `${label}.layerId must be a string when present`;
  if (!isBoolean(raw.isDeleted)) return `${label}.isDeleted must be a boolean`;
  return null;
}

/** Validates the fields specific to `raw.type`, on top of `validateBaseFields`'s common checks. */
function validateTypeSpecificFields(raw: Record<string, unknown>, index: number): string | null {
  const label = `elements[${index}]`;
  switch (raw.type) {
    case "generic":
    case "rectangle":
    case "ellipse":
    case "diamond":
    case "triangle":
    case "hexagon":
    case "star":
    case "parallelogram":
    case "trapezoid":
    case "cylinder":
    case "double-circle":
    case "cloud":
    case "heart":
    case "x-box":
    case "check-box":
    case "note":
      return null;
    case "block-arrow": {
      if (!isOneOf(raw.direction, BLOCK_ARROW_DIRECTIONS)) return `${label}.direction must be one of ${BLOCK_ARROW_DIRECTIONS.join(", ")}`;
      return null;
    }
    case "line": {
      if (!(Array.isArray(raw.points) && raw.points.length >= 1 && raw.points.every(isPoint))) return `${label}.points must be a non-empty array of {x, y} points`;
      return null;
    }
    case "arrow": {
      if (!(Array.isArray(raw.points) && raw.points.length >= 2 && raw.points.every(isPoint))) return `${label}.points must be an array of at least 2 {x, y} points`;
      for (const bindingField of ["startBinding", "endBinding"] as const) {
        const binding = raw[bindingField];
        if (binding !== null && !(isPlainObject(binding) && isString(binding.elementId) && isFiniteNumber(binding.focus) && isFiniteNumber(binding.gap))) {
          return `${label}.${bindingField} must be null or {elementId, focus, gap}`;
        }
        // Optional, and only meaningful as a pair of shape-relative coordinates: a malformed one
        // would pin the endpoint at NaN rather than degrade to the focus beside it.
        if (isPlainObject(binding) && binding.fixedPoint !== undefined && binding.fixedPoint !== null && !isFixedPoint(binding.fixedPoint)) {
          return `${label}.${bindingField}.fixedPoint must be null or [x, y] numbers`;
        }
      }
      if (!isOneOf(raw.startArrowhead, ARROWHEADS)) return `${label}.startArrowhead must be one of ${ARROWHEADS.join(", ")}`;
      if (!isOneOf(raw.endArrowhead, ARROWHEADS)) return `${label}.endArrowhead must be one of ${ARROWHEADS.join(", ")}`;
      if (!isOneOf(raw.arrowType, ARROW_TYPES)) return `${label}.arrowType must be one of ${ARROW_TYPES.join(", ")}`;
      return null;
    }
    case "freedraw": {
      if (!(Array.isArray(raw.points) && raw.points.length >= 1 && raw.points.every(isFreedrawPoint))) {
        return `${label}.points must be a non-empty array of [x, y, pressure] tuples`;
      }
      if (!isBoolean(raw.simulatePressure)) return `${label}.simulatePressure must be a boolean`;
      return null;
    }
    case "text": {
      if (!isString(raw.text)) return `${label}.text must be a string`;
      if (!isOneOf(raw.fontFamily, TEXT_FONT_FAMILIES)) return `${label}.fontFamily must be one of ${TEXT_FONT_FAMILIES.join(", ")}`;
      if (!isFiniteNumber(raw.fontSize)) return `${label}.fontSize must be a finite number`;
      if (!isOneOf(raw.textAlign, TEXT_ALIGNS)) return `${label}.textAlign must be one of ${TEXT_ALIGNS.join(", ")}`;
      if (!isOneOf(raw.verticalAlign, VERTICAL_ALIGNS)) return `${label}.verticalAlign must be one of ${VERTICAL_ALIGNS.join(", ")}`;
      if (!isFiniteNumber(raw.lineHeight)) return `${label}.lineHeight must be a finite number`;
      if (!(raw.containerId === null || isString(raw.containerId))) return `${label}.containerId must be a string or null`;
      if (raw.fontWeight !== undefined && !isOneOf(raw.fontWeight, ["normal", "bold"])) return `${label}.fontWeight must be "normal" or "bold" when present`;
      if (raw.fontStyle !== undefined && !isOneOf(raw.fontStyle, ["normal", "italic"])) return `${label}.fontStyle must be "normal" or "italic" when present`;
      return null;
    }
    case "image": {
      if (!isString(raw.fileId)) return `${label}.fileId must be a string`;
      if (!isNonNegativeFiniteNumber(raw.naturalWidth)) return `${label}.naturalWidth must be a non-negative finite number`;
      if (!isNonNegativeFiniteNumber(raw.naturalHeight)) return `${label}.naturalHeight must be a non-negative finite number`;
      if (raw.crop !== undefined && raw.crop !== null) {
        if (typeof raw.crop !== "object" || Array.isArray(raw.crop)) return `${label}.crop must be an object or null`;
        const crop = raw.crop as Record<string, unknown>;
        for (const field of ["x", "y", "width", "height"] as const) {
          const value = crop[field];
          if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return `${label}.crop.${field} must be a number in [0, 1]`;
        }
        if ((crop.width as number) <= 0 || (crop.height as number) <= 0) return `${label}.crop must have positive width/height`;
      }
      return null;
    }
    case "embed": {
      if (!isString(raw.url)) return `${label}.url must be a string`;
      return null;
    }
    case "frame": {
      if (!isString(raw.name)) return `${label}.name must be a string`;
      // Presenter notes: optional, so absent is valid (every frame authored before the field existed),
      // but present-and-wrong is rejected rather than coerced — the same stance the table cell cap takes.
      if (raw.notes !== undefined) {
        if (!isString(raw.notes)) return `${label}.notes must be a string`;
        if (raw.notes.length > MAX_FRAME_NOTES_LENGTH) return `${label}.notes must be at most ${MAX_FRAME_NOTES_LENGTH} characters`;
      }
      return null;
    }
    case "table": {
      if (!(Array.isArray(raw.columnWidths) && raw.columnWidths.length >= 1 && raw.columnWidths.length <= MAX_TABLE_COLS && raw.columnWidths.every(isPositiveFiniteNumber))) {
        return `${label}.columnWidths must be 1-${MAX_TABLE_COLS} positive finite numbers`;
      }
      if (!(Array.isArray(raw.rowHeights) && raw.rowHeights.length >= 1 && raw.rowHeights.length <= MAX_TABLE_ROWS && raw.rowHeights.every(isPositiveFiniteNumber))) {
        return `${label}.rowHeights must be 1-${MAX_TABLE_ROWS} positive finite numbers`;
      }
      // The cells grid must match the size arrays exactly — a jagged or mismatched grid is precisely
      // what downstream layout math would otherwise index into blindly (defense-in-depth alongside
      // table-layout's read-time clamps; this is the first NESTED-array element field this validator gates).
      if (!Array.isArray(raw.cells) || raw.cells.length !== raw.rowHeights.length) {
        return `${label}.cells must be an array with one row per rowHeights entry`;
      }
      for (const rowCells of raw.cells) {
        if (!Array.isArray(rowCells) || rowCells.length !== raw.columnWidths.length) return `${label}.cells rows must each match columnWidths in length`;
        for (const cell of rowCells) {
          if (!isString(cell)) return `${label}.cells entries must be strings`;
          if (cell.length > MAX_TABLE_CELL_CHARS) return `${label}.cells entries must be at most ${MAX_TABLE_CELL_CHARS} characters`;
        }
      }
      if (!isPositiveFiniteNumber(raw.fontSize)) return `${label}.fontSize must be a positive finite number`;
      if (!isOneOf(raw.fontFamily, TEXT_FONT_FAMILIES)) return `${label}.fontFamily must be one of ${TEXT_FONT_FAMILIES.join(", ")}`;
      // The geometry invariant (width/height are the band sums) with a small float allowance — every
      // legitimate mutation path recomputes the sums, so a real mismatch is hand-edited/corrupted data
      // that would desync the selection bbox from the drawn grid.
      const columnSum = (raw.columnWidths as number[]).reduce((total, value) => total + value, 0);
      const rowSum = (raw.rowHeights as number[]).reduce((total, value) => total + value, 0);
      if (Math.abs((raw.width as number) - columnSum) > 0.5) return `${label}.width must equal the sum of columnWidths`;
      if (Math.abs((raw.height as number) - rowSum) > 0.5) return `${label}.height must equal the sum of rowHeights`;
      return null;
    }
    default:
      return `${label}.type is not a recognized element type`;
  }
}

function validateElement(raw: unknown, index: number): ValidationResult<AnyElement> {
  if (!isPlainObject(raw)) return fail(`elements[${index}] must be an object`);
  const baseError = validateBaseFields(raw, index);
  if (baseError) return fail(baseError);
  const typeError = validateTypeSpecificFields(raw, index);
  if (typeError) return fail(typeError);
  // Every field `AnyElement`'s discriminated union requires has now been checked above (base fields
  // plus this element's specific `type` branch) — the shape matches structurally.
  // Unsafe link schemes are nulled (not rejected — losing a link must never lose the element), on a
  // copy: callers may pass objects they still own (e.g. a host's `initialData`), never mutate those.
  if (isString(raw.link) && !isSafeLinkUrl(raw.link)) return ok({ ...raw, link: null } as unknown as AnyElement);
  return ok(raw as unknown as AnyElement);
}

function validateFile(raw: unknown, fileId: string): ValidationResult<SerializedStoredFile> {
  if (!isPlainObject(raw)) return fail(`files["${fileId}"] must be an object`);
  if (!isString(raw.mimeType)) return fail(`files["${fileId}"].mimeType must be a string`);
  if (!isString(raw.dataURL)) return fail(`files["${fileId}"].dataURL must be a string`);
  if (raw.dataURL.length > DOCUMENT_CEILINGS.maxFileDataUrlChars) {
    return fail(`files["${fileId}"].dataURL exceeds the ${DOCUMENT_CEILINGS.maxFileDataUrlChars}-character ceiling for one embedded file`);
  }
  if (!isFiniteNumber(raw.createdAt)) return fail(`files["${fileId}"].createdAt must be a finite number`);
  return ok({ mimeType: raw.mimeType, dataURL: raw.dataURL, createdAt: raw.createdAt });
}

function validateAppState(raw: unknown): ValidationResult<SerializedAppState | undefined> {
  if (raw === undefined) return ok(undefined);
  if (!isPlainObject(raw)) return fail('scene document "appState" must be an object when present');
  const state: SerializedAppState = {};
  for (const field of ["scrollX", "scrollY", "zoom"] as const) {
    if (raw[field] === undefined) continue;
    if (!isFiniteNumber(raw[field])) return fail(`appState.${field} must be a finite number when present`);
    state[field] = raw[field];
  }
  if (raw.background !== undefined) {
    if (!isString(raw.background)) return fail("appState.background must be a string when present");
    state.background = raw.background;
  }
  return ok(state);
}

/**
 * Validates a document already migrated to `CURRENT_SCHEMA_VERSION`'s shape. Checks the top-level
 * envelope (`type`/`schemaVersion`/`elements`/`files`/`appState`), then every element and file entry —
 * the first problem found anywhere aborts validation and is returned as a human-readable error rather
 * than throwing, so a caller (`serialize-scene.ts`'s `deserializeScene`) can report *why* a load was
 * rejected instead of just "something went wrong".
 */
/** The envelope shape both validators require before looking at any entry: a plain object tagged with the document type, at the current (post-migration) schema version, with `elements`/`files` containers of the right kind. Shared so a future envelope change can't drift between the strict and lenient paths — both reconstruction sites below MUST carry every field this picks, or an addition silently drops on one path (the layers field's original design-review risk). */
function validateEnvelope(
  raw: unknown,
): ValidationResult<{ elements: unknown[]; files: Record<string, unknown>; appState: unknown; layers: unknown; activeLayerId: unknown; comments: unknown; commentMessages: unknown }> {
  if (!isPlainObject(raw)) return fail("scene document must be a JSON object");
  if (raw.type !== SCENE_DOCUMENT_TYPE) return fail(`scene document "type" must be "${SCENE_DOCUMENT_TYPE}"`);
  if (raw.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return fail(`scene document "schemaVersion" must be ${CURRENT_SCHEMA_VERSION} after migration (got ${String(raw.schemaVersion)})`);
  }
  if (!Array.isArray(raw.elements)) return fail('scene document "elements" must be an array');
  if (raw.elements.length > DOCUMENT_CEILINGS.maxElements) {
    return fail(`scene document has ${raw.elements.length} elements — the ${DOCUMENT_CEILINGS.maxElements}-element ceiling protects against hostile documents`);
  }
  if (!isPlainObject(raw.files)) return fail('scene document "files" must be an object');
  return ok({ elements: raw.elements, files: raw.files, appState: raw.appState, layers: raw.layers, activeLayerId: raw.activeLayerId, comments: raw.comments, commentMessages: raw.commentMessages });
}

/** Hostile-input ceiling for a persisted layer list — mirrors `scene-layers.ts`'s `MAX_LAYERS`; duplicated as a literal so this module keeps zero scene-implementation imports. */
const MAX_LAYER_ENTRIES = 256;

/**
 * Validates the optional `layers` list with the same per-field rigor elements and files get:
 * id/name must be strings (id non-empty), visible/locked booleans, duplicate ids dropped keep-first,
 * the whole list capped. Returns `undefined` for an absent field, and treats a non-array or
 * over-cap value as absent-with-error rather than failing the document — layers are organizational
 * metadata; a corrupt list must degrade to "one default layer", never destroy the board. Dropped
 * entries/reasons land in `errors` for the lenient path's report.
 */
function validateLayersList(raw: unknown): { layers: SerializedLayer[] | undefined; errors: string[] } {
  if (raw === undefined) return { layers: undefined, errors: [] };
  if (!Array.isArray(raw)) return { layers: undefined, errors: ['scene document "layers" must be an array when present'] };
  if (raw.length > MAX_LAYER_ENTRIES) return { layers: undefined, errors: [`scene document "layers" exceeds the ${MAX_LAYER_ENTRIES}-entry cap`] };

  const errors: string[] = [];
  const seen = new Set<string>();
  const layers: SerializedLayer[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!isPlainObject(entry)) {
      errors.push(`layers[${index}] must be an object`);
      continue;
    }
    if (!isString(entry.id) || entry.id.length === 0 || !isString(entry.name) || !isBoolean(entry.visible) || !isBoolean(entry.locked)) {
      errors.push(`layers[${index}] must have string id/name and boolean visible/locked`);
      continue;
    }
    if (seen.has(entry.id)) {
      errors.push(`layers[${index}] duplicates id "${entry.id}" (kept the first)`);
      continue;
    }
    seen.add(entry.id);
    layers.push({ id: entry.id, name: entry.name, visible: entry.visible, locked: entry.locked });
  }
  // Every entry invalid ⇒ same degradation as an absent list: the scene's constructor default layer.
  return { layers: layers.length > 0 ? layers : undefined, errors };
}

export function validateSceneDocument(raw: unknown): ValidationResult<SceneDocumentV1> {
  const envelope = validateEnvelope(raw);
  if (!envelope.ok) return fail(envelope.error);

  const elements: AnyElement[] = [];
  for (const [index, rawElement] of envelope.value.elements.entries()) {
    const result = validateElement(rawElement, index);
    if (!result.ok) return fail(result.error);
    elements.push(result.value);
  }

  const files: Record<string, SerializedStoredFile> = {};
  for (const [fileId, rawFile] of Object.entries(envelope.value.files)) {
    const result = validateFile(rawFile, fileId);
    if (!result.ok) return fail(result.error);
    files[fileId] = result.value;
  }

  const appStateResult = validateAppState(envelope.value.appState);
  if (!appStateResult.ok) return fail(appStateResult.error);

  const document: SceneDocumentV1 = { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements, files };
  if (appStateResult.value) document.appState = appStateResult.value;
  // Layers stay lenient even on the strict path (a corrupt list degrades, never rejects the board —
  // organizational metadata, see `validateLayersList`); only entry-level problems are reported, and
  // on this path a problem list is a hard failure to match the strict contract.
  const layersResult = validateLayersList(envelope.value.layers);
  if (layersResult.errors.length > 0) return fail(layersResult.errors[0]!);
  if (layersResult.layers) {
    document.layers = layersResult.layers;
    if (isString(envelope.value.activeLayerId)) document.activeLayerId = envelope.value.activeLayerId;
  }
  // Comments follow the layers policy exactly (see `comment-validation.ts`): entry-level salvage,
  // but on the strict path any dropped entry is reported as a hard failure to honour the contract.
  const commentsResult = validateCommentRecords(envelope.value.comments, envelope.value.commentMessages);
  if (commentsResult.errors.length > 0) return fail(commentsResult.errors[0]!);
  if (commentsResult.threads) document.comments = commentsResult.threads;
  if (commentsResult.messages) document.commentMessages = commentsResult.messages;
  return ok(document);
}

export interface LenientSceneValidation {
  document: SceneDocumentV1;
  /** One human-readable reason per element/file/appState entry that failed validation and was dropped. Empty means the document was fully valid. */
  droppedErrors: string[];
}

/**
 * Entry-level salvage variant of `validateSceneDocument`, for restore paths where rejecting the whole
 * document destroys data the user cannot re-open from anywhere else (localStorage autosave — see
 * `local-storage-autosave.ts`). The envelope is still validated strictly (an unrecognizable document
 * stays rejected), but an individual element or file entry that fails validation is dropped — with its
 * reason recorded in `droppedErrors` — instead of aborting the load: one corrupted element in a
 * 500-element board must not turn into "the whole board is gone". A dropped element's dangling
 * references (bindings, `containerId`, `frameId`) are cleaned up afterwards by
 * `deserializeScene`'s `repairDanglingReferences` pass, same as any other inconsistent input.
 */
export function validateSceneDocumentLenient(raw: unknown): ValidationResult<LenientSceneValidation> {
  const envelope = validateEnvelope(raw);
  if (!envelope.ok) return fail(envelope.error);

  const droppedErrors: string[] = [];

  const elements: AnyElement[] = [];
  for (const [index, rawElement] of envelope.value.elements.entries()) {
    const result = validateElement(rawElement, index);
    if (result.ok) elements.push(result.value);
    else droppedErrors.push(result.error);
  }

  const files: Record<string, SerializedStoredFile> = {};
  for (const [fileId, rawFile] of Object.entries(envelope.value.files)) {
    const result = validateFile(rawFile, fileId);
    if (result.ok) files[fileId] = result.value;
    else droppedErrors.push(result.error);
  }

  const document: SceneDocumentV1 = { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements, files };
  // appState is pure view state (scroll/zoom/background) — losing it is cosmetic, so a bad one is dropped like a bad element rather than failing the load.
  const appStateResult = validateAppState(envelope.value.appState);
  if (appStateResult.ok) {
    if (appStateResult.value) document.appState = appStateResult.value;
  } else {
    droppedErrors.push(appStateResult.error);
  }
  // Layers salvage entry-by-entry like elements do — a bad entry drops with a reason, the survivors load.
  const layersResult = validateLayersList(envelope.value.layers);
  droppedErrors.push(...layersResult.errors);
  if (layersResult.layers) {
    document.layers = layersResult.layers;
    if (isString(envelope.value.activeLayerId)) document.activeLayerId = envelope.value.activeLayerId;
  }
  // Comments salvage entry-by-entry like layers and elements — a corrupt thread drops with a reason,
  // the rest of the conversation loads.
  const commentsResult = validateCommentRecords(envelope.value.comments, envelope.value.commentMessages);
  droppedErrors.push(...commentsResult.errors);
  if (commentsResult.threads) document.comments = commentsResult.threads;
  if (commentsResult.messages) document.commentMessages = commentsResult.messages;
  return ok({ document, droppedErrors });
}

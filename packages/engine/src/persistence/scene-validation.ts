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
import type { SceneDocumentV1, SerializedAppState, SerializedStoredFile } from "./scene-schema";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

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
  "line", "freedraw", "text", "arrow", "image", "frame", "note", "embed",
] as const;
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
      return null;
    }
    case "embed": {
      if (!isString(raw.url)) return `${label}.url must be a string`;
      return null;
    }
    case "frame": {
      if (!isString(raw.name)) return `${label}.name must be a string`;
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
  return ok(raw as unknown as AnyElement);
}

function validateFile(raw: unknown, fileId: string): ValidationResult<SerializedStoredFile> {
  if (!isPlainObject(raw)) return fail(`files["${fileId}"] must be an object`);
  if (!isString(raw.mimeType)) return fail(`files["${fileId}"].mimeType must be a string`);
  if (!isString(raw.dataURL)) return fail(`files["${fileId}"].dataURL must be a string`);
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
export function validateSceneDocument(raw: unknown): ValidationResult<SceneDocumentV1> {
  if (!isPlainObject(raw)) return fail("scene document must be a JSON object");
  if (raw.type !== SCENE_DOCUMENT_TYPE) return fail(`scene document "type" must be "${SCENE_DOCUMENT_TYPE}"`);
  if (raw.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return fail(`scene document "schemaVersion" must be ${CURRENT_SCHEMA_VERSION} after migration (got ${String(raw.schemaVersion)})`);
  }
  if (!Array.isArray(raw.elements)) return fail('scene document "elements" must be an array');
  if (!isPlainObject(raw.files)) return fail('scene document "files" must be an object');

  const elements: AnyElement[] = [];
  for (const [index, rawElement] of raw.elements.entries()) {
    const result = validateElement(rawElement, index);
    if (!result.ok) return fail(result.error);
    elements.push(result.value);
  }

  const files: Record<string, SerializedStoredFile> = {};
  for (const [fileId, rawFile] of Object.entries(raw.files)) {
    const result = validateFile(rawFile, fileId);
    if (!result.ok) return fail(result.error);
    files[fileId] = result.value;
  }

  const appStateResult = validateAppState(raw.appState);
  if (!appStateResult.ok) return fail(appStateResult.error);

  const document: SceneDocumentV1 = { type: SCENE_DOCUMENT_TYPE, schemaVersion: CURRENT_SCHEMA_VERSION, elements, files };
  if (appStateResult.value) document.appState = appStateResult.value;
  return ok(document);
}

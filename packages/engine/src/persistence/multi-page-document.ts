/**
 * Multi-page document envelope — a document is an ordered list of named pages, each page's content
 * being a complete single-scene document in the existing v1 scene format (`scene-schema.ts`). Its
 * own `type` discriminator (`"devivadraw/document"`), not a scene `schemaVersion` bump, on purpose:
 * the scene format stays the stable unit every existing consumer keeps speaking (collab element
 * sync, embedded export payloads, share snapshots, test seeds), and this envelope only *composes*
 * scenes — so all of the per-scene validation, migration, and salvage machinery is reused verbatim
 * per page rather than reimplemented at a second nesting level.
 *
 * Legacy tolerance: every reader here accepts a bare scene document (`"devivadraw/scene"`) as a
 * one-page document, so autosaves and files written before pages existed load without a migration.
 */
import { Scene } from "../scene/scene";
import { randomInt } from "../elements/element-factory-defaults";
import { deserializeScene, deserializeSceneLenient, serializeScene } from "./serialize-scene";
import type { SceneDocumentV1 } from "./scene-schema";
import { SCENE_DOCUMENT_TYPE } from "./scene-schema";

export const MULTI_PAGE_DOCUMENT_TYPE = "devivadraw/document";

/** Version of the *envelope* (page list + naming), independent of the per-page scene schemaVersion. */
export const CURRENT_DOCUMENT_SCHEMA_VERSION = 1;

export interface SerializedPage {
  id: string;
  name: string;
  scene: SceneDocumentV1;
}

export interface MultiPageDocumentV1 {
  type: typeof MULTI_PAGE_DOCUMENT_TYPE;
  schemaVersion: 1;
  /** The page open when the document was written; readers fall back to the first page when absent or unknown. */
  activePageId?: string;
  pages: SerializedPage[];
}

/** A live page — what deserialization hands back and serialization consumes. */
export interface ScenePage {
  id: string;
  name: string;
  scene: Scene;
}

/** Unique-enough page id, same generation strategy as element ids (`element-factory-defaults.ts`). */
export function generatePageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${randomInt().toString(36)}`;
}

export interface SerializeMultiPageOptions {
  activePageId?: string;
  /** Forwarded to each page's `serializeScene` — autosave keeps tombstones, exports strip them (see `SerializeSceneOptions.includeDeleted`). */
  includeDeleted?: boolean;
}

export function serializeMultiPageDocument(pages: readonly ScenePage[], options: SerializeMultiPageOptions = {}): MultiPageDocumentV1 {
  const document: MultiPageDocumentV1 = {
    type: MULTI_PAGE_DOCUMENT_TYPE,
    schemaVersion: CURRENT_DOCUMENT_SCHEMA_VERSION,
    pages: pages.map((page) => ({ id: page.id, name: page.name, scene: serializeScene(page.scene, { includeDeleted: options.includeDeleted }) })),
  };
  if (options.activePageId !== undefined) document.activePageId = options.activePageId;
  return document;
}

export type DeserializeMultiPageResult = { ok: true; pages: ScenePage[]; activePageId: string | null } | { ok: false; error: string };

export type DeserializeMultiPageLenientResult =
  | { ok: true; pages: ScenePage[]; activePageId: string | null; droppedErrors: string[] }
  | { ok: false; error: string };

const LEGACY_PAGE_NAME = "Page 1";

/**
 * Strict reader for file-open paths (the source file survives rejection, so a hard error is the
 * honest answer — same policy split as `deserializeScene` vs `deserializeSceneLenient`). Accepts a
 * multi-page document or a legacy single-scene document.
 */
export function deserializeMultiPageDocument(raw: unknown): DeserializeMultiPageResult {
  const shaped = readEnvelope(raw);
  if (!shaped.ok) return shaped;
  if (shaped.kind === "scene") {
    const result = deserializeScene(raw);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, pages: [{ id: generatePageId(), name: LEGACY_PAGE_NAME, scene: result.scene }], activePageId: null };
  }

  const pages: ScenePage[] = [];
  for (const [index, entry] of shaped.entries.entries()) {
    const page = readPageEntry(entry, index);
    if (!page.ok) return { ok: false, error: page.error };
    const result = deserializeScene(page.scene);
    if (!result.ok) return { ok: false, error: `page "${page.name}": ${result.error}` };
    if (pages.some((existing) => existing.id === page.id)) return { ok: false, error: `duplicate page id "${page.id}"` };
    pages.push({ id: page.id, name: page.name, scene: result.scene });
  }
  if (pages.length === 0) return { ok: false, error: "document has no pages" };
  return { ok: true, pages, activePageId: resolveActivePageId(shaped.activePageId, pages) };
}

/**
 * Salvage reader for the autosave path, mirroring `deserializeSceneLenient`'s contract one level up:
 * a structurally-broken page entry is dropped (recorded in `droppedErrors`) instead of failing the
 * whole document, and each surviving page's scene is itself salvaged per-element. Only a document
 * with *zero* readable pages fails outright.
 */
export function deserializeMultiPageDocumentLenient(raw: unknown): DeserializeMultiPageLenientResult {
  const shaped = readEnvelope(raw);
  if (!shaped.ok) return shaped;
  if (shaped.kind === "scene") {
    const result = deserializeSceneLenient(raw);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, pages: [{ id: generatePageId(), name: LEGACY_PAGE_NAME, scene: result.scene }], activePageId: null, droppedErrors: result.droppedErrors };
  }

  const pages: ScenePage[] = [];
  const droppedErrors: string[] = [];
  for (const [index, entry] of shaped.entries.entries()) {
    const page = readPageEntry(entry, index);
    if (!page.ok) {
      droppedErrors.push(page.error);
      continue;
    }
    if (pages.some((existing) => existing.id === page.id)) {
      droppedErrors.push(`dropped page ${index}: duplicate page id "${page.id}"`);
      continue;
    }
    const result = deserializeSceneLenient(page.scene);
    if (!result.ok) {
      droppedErrors.push(`dropped page "${page.name}": ${result.error}`);
      continue;
    }
    droppedErrors.push(...result.droppedErrors.map((message) => `page "${page.name}": ${message}`));
    pages.push({ id: page.id, name: page.name, scene: result.scene });
  }
  if (pages.length === 0) return { ok: false, error: "document has no readable pages" };
  return { ok: true, pages, activePageId: resolveActivePageId(shaped.activePageId, pages), droppedErrors };
}

type EnvelopeShape =
  | { ok: true; kind: "scene" }
  | { ok: true; kind: "document"; entries: unknown[]; activePageId: unknown }
  | { ok: false; error: string };

/** Distinguishes the two accepted envelopes and checks the document-level structure (not yet the pages). */
function readEnvelope(raw: unknown): EnvelopeShape {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "document must be a JSON object" };
  }
  const envelope = raw as Record<string, unknown>;
  if (envelope.type === SCENE_DOCUMENT_TYPE) return { ok: true, kind: "scene" };
  if (envelope.type !== MULTI_PAGE_DOCUMENT_TYPE) {
    return { ok: false, error: `document "type" must be "${MULTI_PAGE_DOCUMENT_TYPE}" or "${SCENE_DOCUMENT_TYPE}"` };
  }
  if (envelope.schemaVersion !== CURRENT_DOCUMENT_SCHEMA_VERSION) {
    return { ok: false, error: `unsupported document schemaVersion ${String(envelope.schemaVersion)}` };
  }
  if (!Array.isArray(envelope.pages)) return { ok: false, error: 'document "pages" must be an array' };
  return { ok: true, kind: "document", entries: envelope.pages, activePageId: envelope.activePageId };
}

/** Structural check for one page entry — id/name/scene shapes only; the scene's own content is the scene deserializer's job. */
function readPageEntry(entry: unknown, index: number): { ok: true; id: string; name: string; scene: unknown } | { ok: false; error: string } {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return { ok: false, error: `dropped page ${index}: entry must be an object` };
  const page = entry as Record<string, unknown>;
  if (typeof page.id !== "string" || page.id.length === 0) return { ok: false, error: `dropped page ${index}: "id" must be a non-empty string` };
  if (typeof page.name !== "string") return { ok: false, error: `dropped page ${index}: "name" must be a string` };
  if (typeof page.scene !== "object" || page.scene === null) return { ok: false, error: `dropped page ${index}: "scene" must be an object` };
  return { ok: true, id: page.id, name: page.name, scene: page.scene };
}

function resolveActivePageId(candidate: unknown, pages: readonly ScenePage[]): string | null {
  return typeof candidate === "string" && pages.some((page) => page.id === candidate) ? candidate : null;
}

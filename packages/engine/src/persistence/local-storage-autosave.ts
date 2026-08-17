/**
 * Debounced localStorage autosave/restore. Framework/DOM-free by design — `StorageLike` is satisfied
 * by the real `window.localStorage` but also by any in-memory fake, so this stays unit-testable in the
 * engine's Node test environment without a browser (mirrors `images/insert-image-file.ts`'s injected-
 * dependency pattern). Autosave writes keep soft-deleted (tombstoned) elements — see
 * `serialize-scene.ts`'s `SerializeSceneOptions.includeDeleted` doc — so undo can still restore a
 * delete across a page reload, unlike an export, which strips them.
 */
import type { Scene } from "../scene/scene";
import { deserializeMultiPageDocumentLenient } from "./multi-page-document";
import type { MultiPageDocumentV1, ScenePage } from "./multi-page-document";
import { deserializeSceneLenient, serializeScene } from "./serialize-scene";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Single source of truth for the autosave key name — versioned so a future incompatible format change
 * can coexist with (or deliberately replace) old saves without a silent name collision. Defined once,
 * here, so a future multi-scene/multi-workspace key scheme only ever needs to change this one constant
 * (or the call sites that pass their own `storageKey` override) instead of every place that currently
 * assumes "the" single global scene.
 */
export const AUTOSAVE_STORAGE_KEY = "devivadraw:autosave:v1";

const DEFAULT_DEBOUNCE_MS = 1000;

export interface AutosaveOptions {
  scene: Scene;
  storage: StorageLike;
  /** Debounce window between the last scene change and the actual write — default 1s. */
  debounceMs?: number;
  storageKey?: string;
  /** Called when a write is rejected for exceeding the storage quota — the caller (the UI chrome that warns the user) decides how to surface it; this module only guarantees the write itself never throws/crashes the app. */
  onQuotaExceeded?: (error: unknown) => void;
  /** Called for any other unexpected write failure — should be rare, a quota error is the only expected failure mode. */
  onError?: (error: unknown) => void;
  /** Called after a write actually lands. The success half of `onQuotaExceeded`: a warning raised by a failed write can only be *retracted* by evidence that saving works again, and this is that evidence. */
  onWritten?: () => void;
}

export interface AutosaveController {
  /** Forces any pending debounced write to happen immediately (e.g. on `beforeunload`). */
  flush(): void;
  /** Stops listening to scene changes and cancels any pending debounced write. */
  dispose(): void;
}

/** `DOMException.name`/`.code` for a storage-quota rejection — the one failure mode this module treats specially (see `AutosaveOptions.onQuotaExceeded`'s doc); every other thrown error goes through `onError` instead. */
function isQuotaExceededError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "QuotaExceededError" || error.code === 22 || error.code === 1014);
}

/** The three ways one write can end, reported to the caller — see each field's doc on `AutosaveOptions`. */
export interface AutosaveWriteCallbacks {
  onQuotaExceeded?: (error: unknown) => void;
  onError?: (error: unknown) => void;
  onWritten?: () => void;
}

/**
 * The one place a persisted snapshot actually reaches storage: serialize is the caller's job, the
 * never-throw contract and the outcome reporting are this function's. Both autosave flavours (single
 * scene, whole document) funnel through it so they cannot drift on which failures are swallowed.
 */
function commitWrite(storage: StorageLike, storageKey: string, serialized: () => string, callbacks: AutosaveWriteCallbacks): void {
  try {
    storage.setItem(storageKey, serialized());
  } catch (error) {
    if (isQuotaExceededError(error)) callbacks.onQuotaExceeded?.(error);
    else callbacks.onError?.(error);
    return;
  }
  callbacks.onWritten?.();
}

/** Subscribes to `scene`'s changes and writes a debounced snapshot to `storage` on every change, coalescing bursts of edits (a drag, a multi-keystroke text edit) into a single write per quiet period rather than one per mutation. */
export function startAutosave(options: AutosaveOptions): AutosaveController {
  const { scene, storage, debounceMs = DEFAULT_DEBOUNCE_MS, storageKey = AUTOSAVE_STORAGE_KEY, onQuotaExceeded, onError, onWritten } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearPending = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const write = () => commitWrite(storage, storageKey, () => JSON.stringify(serializeScene(scene, { includeDeleted: true })), { onQuotaExceeded, onError, onWritten });

  const unsubscribe = scene.subscribe(() => {
    clearPending();
    timer = setTimeout(() => {
      timer = null;
      write();
    }, debounceMs);
  });

  return {
    flush() {
      clearPending();
      write();
    },
    dispose() {
      unsubscribe();
      clearPending();
    },
  };
}

/** Suffix appended to the autosave key to form the recovery-backup slot — see `restoreAutosave`. */
export const AUTOSAVE_RECOVERY_KEY_SUFFIX = ":recovery";

export interface RestoreAutosaveOptions {
  /**
   * Called on any restore that was less than clean — BOTH a partial salvage (a scene came back but
   * `droppedErrors` lists entries that had to be dropped) and a total failure (the restore returned
   * `null` despite a stored value existing). `backedUp` says whether the original payload actually
   * made it into the recovery slot (false when the write failed, e.g. quota, or was skipped to
   * protect an older backup already there); the caller decides how loudly to tell the user.
   */
  onSalvage?: (info: { droppedErrors: string[]; backedUp: boolean }) => void;
}

/**
 * Restores a previously autosaved scene from `storage`, or returns `null` if there is nothing saved or
 * the stored value is beyond recovery — restore-on-boot must never throw and must never crash the app
 * into a broken editor over a corrupted/foreign localStorage value.
 *
 * A document that fails validation is *salvaged*, not discarded: invalid elements/files are dropped
 * and the rest of the board loads (`deserializeSceneLenient`) — because unlike a rejected file open, a
 * rejected autosave is destroyed by the very next debounced write. Whenever anything less than a clean
 * full restore happens, the original raw payload is first copied to `storageKey + ":recovery"` (unless
 * that slot already holds a different, older backup — see `backupAndReport`) so no byte of user data
 * is lost to the overwrite, and `onSalvage` reports what was dropped.
 */
export function restoreAutosave(storage: StorageLike, storageKey: string = AUTOSAVE_STORAGE_KEY, options: RestoreAutosaveOptions = {}): Scene | null {
  return restoreWithSalvage(storage, storageKey, options, deserializeSceneLenient, (result) => result.scene);
}

/**
 * Multi-page sibling of `restoreAutosave` — same salvage + recovery-backup semantics, but reads the
 * document envelope (`multi-page-document.ts`), so it also restores a legacy single-scene autosave as
 * a one-page document. This is what a pages-aware host restores on boot in place of `restoreAutosave`.
 */
export function restoreAutosaveDocument(
  storage: StorageLike,
  storageKey: string = AUTOSAVE_STORAGE_KEY,
  options: RestoreAutosaveOptions = {},
): { pages: ScenePage[]; activePageId: string | null } | null {
  return restoreWithSalvage(storage, storageKey, options, deserializeMultiPageDocumentLenient, (result) => ({
    pages: result.pages,
    activePageId: result.activePageId,
  }));
}

/**
 * Shared salvage-restore skeleton for both readers above: parse, one lenient deserialize pass (zero
 * drops ≡ a strict success — deliberately NOT strict-then-lenient, which would run `applyMigrations`
 * twice over the same parsed object and break the moment a migration is less than perfectly
 * pure/idempotent), and on anything less than a clean restore, first copy the raw payload to the
 * `":recovery"` slot before the next debounced write can destroy it.
 */
function restoreWithSalvage<Result extends { ok: true; droppedErrors: string[] } | { ok: false; error: string }, Value>(
  storage: StorageLike,
  storageKey: string,
  options: RestoreAutosaveOptions,
  deserialize: (parsed: unknown) => Result,
  pick: (result: Extract<Result, { ok: true }>) => Value,
): Value | null {
  const raw = storage.getItem(storageKey);
  if (raw === null) return null;

  const backupAndReport = (droppedErrors: string[]): void => {
    const recoveryKey = storageKey + AUTOSAVE_RECOVERY_KEY_SUFFIX;
    let backedUp = false;
    try {
      // Never clobber a *different* payload already parked in the recovery slot — a second corruption
      // event must not silently destroy the first event's backup (the same silent-loss failure mode
      // this whole path exists to close). A repeat of the same payload (every boot until the user
      // edits) is a harmless no-op rewrite.
      const existing = storage.getItem(recoveryKey);
      if (existing === null || existing === raw) {
        storage.setItem(recoveryKey, raw);
        backedUp = true;
      }
    } catch {
      // Best-effort (quota) — salvage still proceeds; losing the backup must not also lose the restore.
    }
    options.onSalvage?.({ droppedErrors, backedUp });
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    backupAndReport(["stored autosave is not valid JSON"]);
    return null;
  }

  const result = deserialize(parsed);
  if (!result.ok) {
    backupAndReport([result.error]);
    return null;
  }
  if (result.droppedErrors.length > 0) backupAndReport(result.droppedErrors);
  return pick(result as Extract<Result, { ok: true }>);
}

/**
 * One quota-safe write of a multi-page document to the autosave slot — the document-level counterpart
 * of the single-scene `writeSnapshot` above. Debounce/orchestration lives with the caller (a pages
 * host knows about page switches and page-list edits, which a single `Scene` subscription cannot see).
 */
export function writeAutosaveDocument(storage: StorageLike, document: MultiPageDocumentV1, options: AutosaveWriteCallbacks & { storageKey?: string } = {}): void {
  const { storageKey = AUTOSAVE_STORAGE_KEY, ...callbacks } = options;
  commitWrite(storage, storageKey, () => JSON.stringify(document), callbacks);
}

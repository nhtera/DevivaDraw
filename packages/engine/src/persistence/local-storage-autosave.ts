/**
 * Debounced localStorage autosave/restore. Framework/DOM-free by design — `StorageLike` is satisfied
 * by the real `window.localStorage` but also by any in-memory fake, so this stays unit-testable in the
 * engine's Node test environment without a browser (mirrors `images/insert-image-file.ts`'s injected-
 * dependency pattern). Autosave writes keep soft-deleted (tombstoned) elements — see
 * `serialize-scene.ts`'s `SerializeSceneOptions.includeDeleted` doc — so undo can still restore a
 * delete across a page reload, unlike an export, which strips them.
 */
import type { Scene } from "../scene/scene";
import { deserializeScene, deserializeSceneLenient, serializeScene } from "./serialize-scene";

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
  /** Called when a write is rejected for exceeding the storage quota — the caller (future UI chrome) decides how to warn the user; this module only guarantees the write itself never throws/crashes the app. */
  onQuotaExceeded?: (error: unknown) => void;
  /** Called for any other unexpected write failure — should be rare, a quota error is the only expected failure mode. */
  onError?: (error: unknown) => void;
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

function writeSnapshot(
  scene: Scene,
  storage: StorageLike,
  storageKey: string,
  onQuotaExceeded?: (error: unknown) => void,
  onError?: (error: unknown) => void,
): void {
  try {
    const document = serializeScene(scene, { includeDeleted: true });
    storage.setItem(storageKey, JSON.stringify(document));
  } catch (error) {
    if (isQuotaExceededError(error)) onQuotaExceeded?.(error);
    else onError?.(error);
  }
}

/** Subscribes to `scene`'s changes and writes a debounced snapshot to `storage` on every change, coalescing bursts of edits (a drag, a multi-keystroke text edit) into a single write per quiet period rather than one per mutation. */
export function startAutosave(options: AutosaveOptions): AutosaveController {
  const { scene, storage, debounceMs = DEFAULT_DEBOUNCE_MS, storageKey = AUTOSAVE_STORAGE_KEY, onQuotaExceeded, onError } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearPending = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const unsubscribe = scene.subscribe(() => {
    clearPending();
    timer = setTimeout(() => {
      timer = null;
      writeSnapshot(scene, storage, storageKey, onQuotaExceeded, onError);
    }, debounceMs);
  });

  return {
    flush() {
      clearPending();
      writeSnapshot(scene, storage, storageKey, onQuotaExceeded, onError);
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
   * Called when the saved document did not restore cleanly: `scene` came back but `droppedErrors`
   * lists entries that had to be dropped, or the whole document was unrecoverable (the restore
   * returned `null` despite a stored value existing). Either way the original payload has just been
   * copied to the recovery slot; the caller decides how loudly to tell the user.
   */
  onSalvage?: (info: { droppedErrors: string[] }) => void;
}

/**
 * Restores a previously autosaved scene from `storage`, or returns `null` if there is nothing saved or
 * the stored value is beyond recovery — restore-on-boot must never throw and must never crash the app
 * into a broken editor over a corrupted/foreign localStorage value.
 *
 * A document that fails strict validation is *salvaged*, not discarded: invalid elements/files are
 * dropped and the rest of the board loads (`deserializeSceneLenient`) — because unlike a rejected file
 * open, a rejected autosave is destroyed by the very next debounced write. Whenever anything less than
 * a clean full restore happens, the original raw payload is first copied to `storageKey + ":recovery"`
 * so no byte of user data is lost to the overwrite, and `onSalvage` reports what was dropped.
 */
export function restoreAutosave(storage: StorageLike, storageKey: string = AUTOSAVE_STORAGE_KEY, options: RestoreAutosaveOptions = {}): Scene | null {
  const raw = storage.getItem(storageKey);
  if (raw === null) return null;

  const backupAndReport = (droppedErrors: string[]): void => {
    try {
      storage.setItem(storageKey + AUTOSAVE_RECOVERY_KEY_SUFFIX, raw);
    } catch {
      // Best-effort (quota) — salvage still proceeds; losing the backup must not also lose the restore.
    }
    options.onSalvage?.({ droppedErrors });
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    backupAndReport(["stored autosave is not valid JSON"]);
    return null;
  }

  const strict = deserializeScene(parsed);
  if (strict.ok) return strict.scene;

  const lenient = deserializeSceneLenient(parsed);
  if (!lenient.ok) {
    backupAndReport([lenient.error]);
    return null;
  }
  backupAndReport(lenient.droppedErrors.length > 0 ? lenient.droppedErrors : [strict.error]);
  return lenient.scene;
}

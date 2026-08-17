/**
 * Editor behavior preferences — how a marquee drag decides what it selects, whether arrow endpoints
 * may attach to shapes, whether they snap onto a shape's edge midpoints, and whether the freehand
 * pen ignores pressure. Same shape as `input-device-preference.ts` (validated JSON object in
 * localStorage + a module-level store bridged to React by `useSyncExternalStore`), and deliberately
 * ONE module holding all of them rather than a file per preference: they share a storage key, a
 * parse routine and a menu section, and near-identical copies of this file would drift.
 *
 * The engine never reads this module. Each preference reaches the engine as a plain getter threaded
 * through `runtime/build-tools.ts` into the tool deps, keeping engine behavior a function of its
 * arguments rather than of browser storage — the same contract `getToolLocked` and the wheel-mode
 * config already follow.
 */
import { useSyncExternalStore } from "react";
import type { SelectOnMode } from "@deviva-draw/engine";
import type { StorageLike } from "../theme/theme-storage";

/** Unhyphenated app prefix + `:v1` version suffix, matching the theme/locale/library/input-device key convention. */
export const EDITOR_PREFERENCES_STORAGE_KEY = "devivadraw:editor-preferences:v1";

export interface EditorPreferences {
  /** What a marquee drag selects — see the engine's `SelectOnMode`. `"auto"` keeps the drag-direction convention. */
  selectOnMode: SelectOnMode;
  /** Whether a new arrow may attach its ends to shapes. Off does not disturb bindings that already exist. */
  arrowBinding: boolean;
  /** Whether an arrow endpoint snaps onto a shape's four edge midpoints (its connection anchors). Independent of the align-to-objects snap toggle. */
  snapMidpoints: boolean;
  /** Whether new freehand strokes ignore pressure and draw at one uniform width. Affects new strokes only — see the engine's `FreedrawToolDeps.getConstantWidth`. */
  constantWidthPen: boolean;
}

/** Every default preserves the behavior the editor had before these preferences existed — turning a preference on is opt-in, never a surprise on upgrade. */
export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = { selectOnMode: "auto", arrowBinding: true, snapMidpoints: true, constantWidthPen: false };

function isSelectOnMode(value: unknown): value is SelectOnMode {
  return value === "auto" || value === "wrap" || value === "overlap";
}

/** Parses a stored raw value per-field, so one corrupt or future-version field never takes the whole preference down (the input-device module's rationale applies verbatim). */
export function parseEditorPreferences(raw: string | null): EditorPreferences {
  if (raw === null) return DEFAULT_EDITOR_PREFERENCES;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_EDITOR_PREFERENCES;
    const record = parsed as Record<string, unknown>;
    return {
      selectOnMode: isSelectOnMode(record.selectOnMode) ? record.selectOnMode : DEFAULT_EDITOR_PREFERENCES.selectOnMode,
      arrowBinding: typeof record.arrowBinding === "boolean" ? record.arrowBinding : DEFAULT_EDITOR_PREFERENCES.arrowBinding,
      snapMidpoints: typeof record.snapMidpoints === "boolean" ? record.snapMidpoints : DEFAULT_EDITOR_PREFERENCES.snapMidpoints,
      // Absent in values stored before this field existed — the per-field fallback doubles as the version-tolerant upgrade path.
      constantWidthPen: typeof record.constantWidthPen === "boolean" ? record.constantWidthPen : DEFAULT_EDITOR_PREFERENCES.constantWidthPen,
    };
  } catch {
    return DEFAULT_EDITOR_PREFERENCES;
  }
}

export function readStoredEditorPreferences(storage: StorageLike): EditorPreferences {
  return parseEditorPreferences(storage.getItem(EDITOR_PREFERENCES_STORAGE_KEY));
}

export function writeStoredEditorPreferences(storage: StorageLike, preferences: EditorPreferences): void {
  try {
    storage.setItem(EDITOR_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.warn("deviva-draw: could not persist editor preferences", error);
  }
}

// --- Module-level store (thin wiring over the tested functions above; not unit tested, per the
// --- input-device/theme-provider precedent for pure localStorage/subscription glue) ---

let current: EditorPreferences | null = null;
const listeners = new Set<() => void>();

function liveStorage(): StorageLike | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

/** The current preferences — lazily hydrated from localStorage on first read, then cached (stable identity for `useSyncExternalStore`). */
export function getEditorPreferences(): EditorPreferences {
  if (current === null) {
    const storage = liveStorage();
    current = storage ? readStoredEditorPreferences(storage) : DEFAULT_EDITOR_PREFERENCES;
  }
  return current;
}

export function setEditorPreferences(patch: Partial<EditorPreferences>): void {
  current = { ...getEditorPreferences(), ...patch };
  const storage = liveStorage();
  if (storage) writeStoredEditorPreferences(storage, current);
  for (const listener of [...listeners]) listener();
}

export function subscribeEditorPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive view of the store for menu UI; `setPreferences` accepts a partial patch. */
export function useEditorPreferences(): { preferences: EditorPreferences; setPreferences: (patch: Partial<EditorPreferences>) => void } {
  const preferences = useSyncExternalStore(subscribeEditorPreferences, getEditorPreferences, () => DEFAULT_EDITOR_PREFERENCES);
  return { preferences, setPreferences: setEditorPreferences };
}

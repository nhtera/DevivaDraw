/**
 * Input-device (wheel-routing) preference: persistence + a tiny module-level store the main menu and
 * `build-runtime.ts` share. Same injected-`StorageLike` pattern as `theme/theme-storage.ts` (SSR
 * guards, testable pure read/write), combined with `library-storage.ts`'s safe-parse approach —
 * this preference is a JSON *object*, not a string enum, so every field is validated individually
 * and any corrupt/truncated/wrong-type value falls back to the documented default without throwing.
 *
 * A module-level store (not React context) because the consumer split is asymmetric: the engine
 * pipeline reads it through a plain callback (`build-runtime.ts` wires `getWheelBehavior`), while
 * only the menu needs reactive updates — `useInputDevicePreference()` bridges those via
 * `useSyncExternalStore`.
 */
import { useSyncExternalStore } from "react";
import type { WheelBehaviorMode } from "@deviva-draw/engine";
import type { StorageLike } from "../theme/theme-storage";

/** Unhyphenated app prefix + `:v1` version suffix, matching the theme/locale/library key convention. */
export const INPUT_DEVICE_STORAGE_KEY = "devivadraw:input-device:v1";

export interface InputDevicePreference {
  mode: WheelBehaviorMode;
  invertMouseZoom: boolean;
  /** "Pen draws, finger pans": with a draw-capable tool active, a single-finger touch pans the camera instead of drawing. See `runtime/tool-names.ts`'s `resolveTouchDrawPolicy`. */
  penOnlyDraw: boolean;
}

export const DEFAULT_INPUT_DEVICE_PREFERENCE: InputDevicePreference = { mode: "auto", invertMouseZoom: false, penOnlyDraw: false };

function isWheelBehaviorMode(value: unknown): value is WheelBehaviorMode {
  return value === "auto" || value === "trackpad" || value === "mouse";
}

/** Parses a stored raw value, per-field: an unknown/missing/wrong-type field falls back to its default so a future version's extra fields (or a corrupt write) never take the whole preference down. */
export function parseInputDevicePreference(raw: string | null): InputDevicePreference {
  if (raw === null) return DEFAULT_INPUT_DEVICE_PREFERENCE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_INPUT_DEVICE_PREFERENCE;
    const record = parsed as Record<string, unknown>;
    return {
      mode: isWheelBehaviorMode(record.mode) ? record.mode : DEFAULT_INPUT_DEVICE_PREFERENCE.mode,
      invertMouseZoom: typeof record.invertMouseZoom === "boolean" ? record.invertMouseZoom : DEFAULT_INPUT_DEVICE_PREFERENCE.invertMouseZoom,
      // Absent in values stored before this field existed — the per-field fallback doubles as the version-tolerant upgrade path.
      penOnlyDraw: typeof record.penOnlyDraw === "boolean" ? record.penOnlyDraw : DEFAULT_INPUT_DEVICE_PREFERENCE.penOnlyDraw,
    };
  } catch {
    return DEFAULT_INPUT_DEVICE_PREFERENCE;
  }
}

export function readStoredInputDevicePreference(storage: StorageLike): InputDevicePreference {
  return parseInputDevicePreference(storage.getItem(INPUT_DEVICE_STORAGE_KEY));
}

export function writeStoredInputDevicePreference(storage: StorageLike, preference: InputDevicePreference): void {
  try {
    storage.setItem(INPUT_DEVICE_STORAGE_KEY, JSON.stringify(preference));
  } catch (error) {
    console.warn("deviva-draw: could not persist input-device preference", error);
  }
}

// --- Module-level store (thin wiring over the tested functions above; not unit tested, per the
// --- theme-provider precedent for pure localStorage/subscription glue) ---

let current: InputDevicePreference | null = null;
const listeners = new Set<() => void>();

function liveStorage(): StorageLike | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

/** The current preference — lazily hydrated from localStorage on first read, then cached (stable identity for `useSyncExternalStore`). */
export function getInputDevicePreference(): InputDevicePreference {
  if (current === null) {
    const storage = liveStorage();
    current = storage ? readStoredInputDevicePreference(storage) : DEFAULT_INPUT_DEVICE_PREFERENCE;
  }
  return current;
}

export function setInputDevicePreference(patch: Partial<InputDevicePreference>): void {
  current = { ...getInputDevicePreference(), ...patch };
  const storage = liveStorage();
  if (storage) writeStoredInputDevicePreference(storage, current);
  for (const listener of [...listeners]) listener();
}

export function subscribeInputDevicePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reactive view of the store for menu UI; `setPreference` accepts a partial patch. */
export function useInputDevicePreference(): { preference: InputDevicePreference; setPreference: (patch: Partial<InputDevicePreference>) => void } {
  const preference = useSyncExternalStore(subscribeInputDevicePreference, getInputDevicePreference, () => DEFAULT_INPUT_DEVICE_PREFERENCE);
  return { preference, setPreference: setInputDevicePreference };
}

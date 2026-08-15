/**
 * The user's own LLM API key for "text to diagram" — same injected-`StorageLike` pattern as the
 * sibling preference stores. The key never leaves this browser except in the direct
 * browser→provider request itself (there is no proxy server holding it), which is the whole
 * privacy/cost model the feature was built on.
 */
import type { StorageLike } from "../theme/theme-storage";

const AI_KEY_STORAGE_KEY = "devivadraw:ai-key:v1";

/** The stored key, or empty string when none was saved. */
export function readStoredAiKey(storage: StorageLike): string {
  return storage.getItem(AI_KEY_STORAGE_KEY) ?? "";
}

export function writeStoredAiKey(storage: StorageLike, key: string): void {
  // A cleared key is stored as "" rather than removed — `StorageLike` deliberately has no
  // `removeItem` (see the theme store it mirrors), and `readStoredAiKey` treats both the same.
  storage.setItem(AI_KEY_STORAGE_KEY, key);
}

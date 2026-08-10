/**
 * Personal element library persisted in localStorage — Excalidraw's "save a selection, drag it back
 * later" feature. Each item is a serialized set of elements plus a PNG preview. Kept deliberately
 * simple (a plain JSON array under one versioned key, like the theme/locale prefs): a saved item is
 * just data, and re-inserting it goes through the engine's `insertElements` (fresh ids). Import/export
 * uses a `.devivalib` JSON file, mirroring Excalidraw's `.excalidrawlib` interchange idea.
 */
import type { AnyElement } from "@deviva-draw/engine";

export const LIBRARY_STORAGE_KEY = "devivadraw:library:v1";

export interface LibraryItem {
  id: string;
  name: string;
  elements: AnyElement[];
  /** PNG data URL preview. */
  preview: string;
  created: number;
}

function safeParse(raw: string | null): LibraryItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LibraryItem[]) : [];
  } catch {
    return [];
  }
}

export function loadLibrary(storage: Storage = window.localStorage): LibraryItem[] {
  return safeParse(storage.getItem(LIBRARY_STORAGE_KEY));
}

export function saveLibrary(items: LibraryItem[], storage: Storage = window.localStorage): void {
  try {
    storage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(items));
  } catch (error) {
    console.warn("deviva-draw: could not persist library (storage full?)", error);
  }
}

export function addLibraryItem(item: LibraryItem, storage: Storage = window.localStorage): LibraryItem[] {
  const items = [item, ...loadLibrary(storage)];
  saveLibrary(items, storage);
  return items;
}

export function removeLibraryItem(id: string, storage: Storage = window.localStorage): LibraryItem[] {
  const items = loadLibrary(storage).filter((item) => item.id !== id);
  saveLibrary(items, storage);
  return items;
}

/** Merges imported items in front of the existing library, de-duped by id. */
export function mergeImportedLibrary(imported: unknown, storage: Storage = window.localStorage): LibraryItem[] {
  const incoming = Array.isArray(imported) ? (imported as LibraryItem[]) : [];
  const existing = loadLibrary(storage);
  const seen = new Set(incoming.map((item) => item.id));
  const merged = [...incoming, ...existing.filter((item) => !seen.has(item.id))];
  saveLibrary(merged, storage);
  return merged;
}

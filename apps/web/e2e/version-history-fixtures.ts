import type { Page } from "@playwright/test";

/**
 * Reading and emptying the version-history database from a spec.
 *
 * A file of its own rather than more helpers in `image-file-store-fixtures.ts`: version history is a
 * separate store with a separate subject, and the image specs need it only because a stored snapshot
 * now protects images from collection — which is a fact about version history, not about images.
 *
 * Each helper opens the database without naming a version, so a spec never fights the app's own
 * connection over an upgrade, and creates the stores if it happens to touch an origin the app has
 * not booted on yet — the same shape `clearFileDatabase` uses next door.
 */

const VERSION_DATABASE = "devivadraw-versions";

/** What one stored version looks like from outside, minus its document. */
export interface StoredVersion {
  id: string;
  createdAt: number;
  trigger: "auto" | "manual" | "milestone";
  label?: string;
  pageCount: number;
  elementCount: number;
  bytes: number;
  fileIds: string[];
}

/** Every stored version's summary, newest first. */
export async function storedVersions(page: Page): Promise<StoredVersion[]> {
  return page.evaluate(
    (databaseName) =>
      new Promise<StoredVersion[]>((resolve) => {
        const request = indexedDB.open(databaseName);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("versions")) database.createObjectStore("versions", { keyPath: "id" });
          if (!database.objectStoreNames.contains("documents")) database.createObjectStore("documents");
        };
        request.onsuccess = () => {
          const database = request.result;
          const all = database.transaction("versions", "readonly").objectStore("versions").getAll();
          all.onsuccess = () => {
            resolve((all.result as StoredVersion[]).sort((left, right) => right.createdAt - left.createdAt));
            database.close();
          };
          all.onerror = () => {
            resolve([]);
            database.close();
          };
        };
        request.onerror = () => resolve([]);
      }),
    VERSION_DATABASE,
  );
}

/** Every file id any stored version still references — the keep-set collection must respect. */
export async function versionReferencedFileIds(page: Page): Promise<string[]> {
  return [...new Set((await storedVersions(page)).flatMap((version) => version.fileIds))].sort();
}

/** Empties version history without deleting the database — a delete would block on the page's own open connection. */
export async function clearVersionDatabase(page: Page): Promise<void> {
  await page.evaluate(
    (databaseName) =>
      new Promise<void>((resolve) => {
        const request = indexedDB.open(databaseName);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("versions")) database.createObjectStore("versions", { keyPath: "id" });
          if (!database.objectStoreNames.contains("documents")) database.createObjectStore("documents");
        };
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(["versions", "documents"], "readwrite");
          transaction.objectStore("versions").clear();
          transaction.objectStore("documents").clear();
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => {
            database.close();
            resolve();
          };
        };
        request.onerror = () => resolve();
      }),
    VERSION_DATABASE,
  );
}

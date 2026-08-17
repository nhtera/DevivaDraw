/**
 * The browser half of the engine's `FileStoreLike` port (`persistence/file-store.ts`): image payloads
 * kept in IndexedDB instead of inside the localStorage autosave string. localStorage hands an origin a
 * handful of megabytes for everything it stores; IndexedDB's budget is a share of free disk, which is
 * the difference between "one photograph ends this session's autosave" and "images are just data".
 *
 * Written directly against the raw IndexedDB API rather than pulling in a wrapper: the port is four
 * batched methods, and this is what those four cost.
 */
import type { FileStoreLike, StoredFile } from "@deviva-draw/engine";

const DATABASE_NAME = "devivadraw-files";
const OBJECT_STORE = "files";
const DATABASE_VERSION = 1;

/**
 * How long to wait for the database to open before giving up and running without one. An open can
 * stall indefinitely — another tab holding a version-change lock, a browser prompting for storage
 * permission — and boot is downstream of this: saving waits for files to be restored, so a hung open
 * would be a hung Save, which is far worse than falling back to keeping the bytes in localStorage.
 */
const OPEN_TIMEOUT_MS = 5000;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb request failed"));
  });
}

/** Resolves when the whole transaction commits — the only signal that a write actually reached disk; an individual `put`'s success fires before the commit. */
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("indexeddb transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("indexeddb transaction aborted"));
  });
}

function createStore(database: IDBDatabase): FileStoreLike {
  const run = <T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => Promise<T>): Promise<T> => {
    const transaction = database.transaction(OBJECT_STORE, mode);
    const result = body(transaction.objectStore(OBJECT_STORE));
    // Reads resolve on their own request; writes must also wait for the commit, so both are awaited
    // here rather than leaving each method to remember which of the two it needs.
    return mode === "readonly" ? result : Promise.all([result, transactionDone(transaction)]).then(([value]) => value);
  };

  return {
    async getMany(fileIds) {
      if (fileIds.length === 0) return new Map();
      return run("readonly", async (store) => {
        const found = new Map<string, StoredFile>();
        const results = await Promise.all(fileIds.map((fileId) => requestResult<StoredFile | undefined>(store.get(fileId))));
        fileIds.forEach((fileId, index) => {
          const file = results[index];
          if (file) found.set(fileId, file);
        });
        return found;
      });
    },

    async putMany(entries) {
      if (entries.size === 0) return;
      await run("readwrite", async (store) => {
        // `put`, not `add`: ids are content hashes, so a re-write is the same bytes landing again —
        // a harmless overwrite, where `add` would reject the whole transaction on a duplicate key
        // (which two tabs saving the same pasted image would produce routinely).
        for (const [fileId, file] of entries) store.put(file, fileId);
      });
    },

    async deleteMany(fileIds) {
      if (fileIds.length === 0) return;
      await run("readwrite", async (store) => {
        for (const fileId of fileIds) store.delete(fileId);
      });
    },

    async listIds() {
      return run("readonly", async (store) => (await requestResult(store.getAllKeys())).map(String));
    },
  };
}

/**
 * Opens the file database, or resolves `null` when this runtime cannot give us one — no `indexedDB`
 * at all (a server render, a locked-down embedding), a private-mode refusal, or an open that never
 * answers. `null` is a supported state, not an error: every caller falls back to keeping file bytes
 * in the localStorage document, which is exactly the behaviour that shipped before this store
 * existed. Never rejects, so no boot path has to guard it.
 */
export function openIndexedDbFileStore(databaseName: string = DATABASE_NAME): Promise<FileStoreLike | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise<FileStoreLike | null>((resolve) => {
    let settled = false;
    const settle = (store: FileStoreLike | null) => {
      if (settled) return;
      settled = true;
      resolve(store);
    };

    const timer = setTimeout(() => {
      console.warn("deviva-draw: the image file database did not open in time — keeping image data in localStorage for this session");
      settle(null);
    }, OPEN_TIMEOUT_MS);

    const finish = (store: FileStoreLike | null) => {
      clearTimeout(timer);
      settle(store);
    };

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(databaseName, DATABASE_VERSION);
    } catch (error) {
      console.warn("deviva-draw: could not open the image file database — keeping image data in localStorage", error);
      finish(null);
      return;
    }

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE)) request.result.createObjectStore(OBJECT_STORE);
    };
    request.onsuccess = () => finish(createStore(request.result));
    request.onerror = () => {
      console.warn("deviva-draw: could not open the image file database — keeping image data in localStorage", request.error);
      finish(null);
    };
    request.onblocked = () => {
      console.warn("deviva-draw: the image file database is blocked by another tab — keeping image data in localStorage for this session");
      finish(null);
    };
  });
}

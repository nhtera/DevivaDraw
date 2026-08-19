/**
 * Version history's storage: whole-document snapshots in IndexedDB, in a database of their own.
 *
 * Written directly against the raw IndexedDB API and modelled line-for-line on
 * `indexeddb-file-store.ts` — same open-with-timeout, same commit-not-request success signal, same
 * `null`-means-"this runtime cannot give us one" contract. Two adapters that hold the same kind of
 * data on the same boot path should fail the same way; a second style here would mean two answers to
 * "what happens in a private window".
 *
 * **A separate database, not a second object store in `devivadraw-files`.** Adding a store to that
 * database means bumping its version and running an upgrade transaction on the path every image on
 * screen depends on. Version history is worth having; it is not worth putting a migration in front
 * of the user's photographs.
 *
 * **Why two object stores.** A snapshot's document is by far the largest thing here, and the two
 * hottest queries — the panel's listing and collection's keep-set — need none of it. Keeping the
 * document in a record of its own means `list()` and `referencedFileIds()` read only the small
 * summary records: opening the history panel costs the size of the *index*, not the size of every
 * board ever snapshotted. Both stores are written and deleted inside one transaction, so a summary
 * without its document is not a state that can be observed.
 */
import type { MultiPageDocumentV1 } from "@deviva-draw/engine";
import type { VersionSnapshot, VersionSummary } from "./version-snapshot-types";

const DATABASE_NAME = "devivadraw-versions";
/** Summary + `fileIds` — everything except the document. Keyed by the snapshot id. */
const SUMMARY_STORE = "versions";
/** The documents, keyed by the same id. Read only by `get`, which is the only caller that wants them. */
const DOCUMENT_STORE = "documents";
const CREATED_AT_INDEX = "createdAt";
const DATABASE_VERSION = 1;

/** Same budget as the file store's open — see its `OPEN_TIMEOUT_MS` doc. A stalled open here is less costly (no save waits on it), but a boot that hangs on version history would be an absurd way to lose a session. */
const OPEN_TIMEOUT_MS = 5000;

/**
 * What the rest of the app may do with stored versions. Every method resolves rather than throwing
 * on a missing record; a rejection means the database itself failed, which is the signal Phase 2's
 * collection fail-safe reads — "the store is unwell" must stay distinguishable from "there is
 * nothing stored", because the two demand opposite behaviour from orphan collection.
 */
export interface VersionStore {
  /** Every stored version's summary, newest first. Never reads a document. */
  list(): Promise<VersionSummary[]>;
  /** One whole version, or `null` when that id is not stored. */
  get(id: string): Promise<VersionSnapshot | null>;
  put(snapshot: VersionSnapshot): Promise<void>;
  delete(ids: readonly string[]): Promise<void>;
  /**
   * Empties the whole history. The records go here; the image bytes they were protecting are
   * reclaimed by the *next* orphan-collection pass, which is why every caller of this runs one
   * straight afterwards — deleting the records alone would leave the pictures on disk with nothing
   * left pointing at them, which is precisely the state a user clearing their history is trying to
   * get out of.
   */
  clearAll(): Promise<void>;
  /** The union of every stored version's `fileIds` — the keep-set collection must respect. Never reads a document. */
  referencedFileIds(): Promise<Set<string>>;
}

/** What a summary record actually holds on disk: the summary the panel shows plus the denormalised file references collection needs. */
type StoredSummary = VersionSummary & { fileIds: string[] };

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb request failed"));
  });
}

/** Resolves when the whole transaction commits — the only signal a write actually reached disk; an individual `put`'s success fires before the commit. */
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("indexeddb transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("indexeddb transaction aborted"));
  });
}

/**
 * Projects a stored record down to what the panel is allowed to see. Written as an explicit pick
 * rather than a rest-spread omission so that a field added to the record later — another piece of
 * bookkeeping, a cached thumbnail — has to be named here before it can reach a listing.
 */
function toSummary(record: StoredSummary): VersionSummary {
  const { id, createdAt, trigger, pageCount, elementCount, bytes, label } = record;
  return { id, createdAt, trigger, pageCount, elementCount, bytes, ...(label === undefined ? {} : { label }) };
}

function createStore(database: IDBDatabase): VersionStore {
  const run = <T>(stores: string | string[], mode: IDBTransactionMode, body: (transaction: IDBTransaction) => Promise<T>): Promise<T> => {
    const transaction = database.transaction(stores, mode);
    const result = body(transaction);
    // Reads resolve on their own request; writes must also wait for the commit — same split the file
    // store makes, and for the same reason: neither method should have to remember which it needs.
    return mode === "readonly" ? result : Promise.all([result, transactionDone(transaction)]).then(([value]) => value);
  };

  const allSummaries = (transaction: IDBTransaction): Promise<StoredSummary[]> => requestResult<StoredSummary[]>(transaction.objectStore(SUMMARY_STORE).getAll());

  return {
    async list() {
      const summaries = await run(SUMMARY_STORE, "readonly", allSummaries);
      // Newest first — the order the panel shows and the order retention prunes from the far end of.
      // Sorted here rather than read through a reversed index cursor: the set is capped in the tens,
      // so the index buys nothing a comparison does not, and the caller gets one guaranteed order.
      return summaries.map(toSummary).sort((left, right) => right.createdAt - left.createdAt);
    },

    async get(id) {
      return run([SUMMARY_STORE, DOCUMENT_STORE], "readonly", async (transaction) => {
        const summary = await requestResult<StoredSummary | undefined>(transaction.objectStore(SUMMARY_STORE).get(id));
        if (!summary) return null;
        const document = await requestResult<MultiPageDocumentV1 | undefined>(transaction.objectStore(DOCUMENT_STORE).get(id));
        // A summary whose document is missing is a record that cannot be restored, and offering it
        // would be offering a button that fails. Treated as absent rather than repaired: the next
        // retention pass removes it, and `get` is not the place to run a database repair.
        if (!document) return null;
        return { ...summary, document };
      });
    },

    async put(snapshot) {
      const { document, ...summary } = snapshot;
      await run([SUMMARY_STORE, DOCUMENT_STORE], "readwrite", async (transaction) => {
        transaction.objectStore(SUMMARY_STORE).put(summary);
        transaction.objectStore(DOCUMENT_STORE).put(document, snapshot.id);
      });
    },

    async delete(ids) {
      if (ids.length === 0) return;
      await run([SUMMARY_STORE, DOCUMENT_STORE], "readwrite", async (transaction) => {
        for (const id of ids) {
          transaction.objectStore(SUMMARY_STORE).delete(id);
          transaction.objectStore(DOCUMENT_STORE).delete(id);
        }
      });
    },

    async clearAll() {
      await run([SUMMARY_STORE, DOCUMENT_STORE], "readwrite", async (transaction) => {
        transaction.objectStore(SUMMARY_STORE).clear();
        transaction.objectStore(DOCUMENT_STORE).clear();
      });
    },

    async referencedFileIds() {
      const summaries = await run(SUMMARY_STORE, "readonly", allSummaries);
      const ids = new Set<string>();
      for (const summary of summaries) for (const fileId of summary.fileIds) ids.add(fileId);
      return ids;
    },
  };
}

/**
 * Opens the version database, or resolves `null` when this runtime cannot give us one — no
 * `indexedDB` at all, a private-mode refusal, an open blocked by another tab, or an open that never
 * answers. `null` is a supported state: version history simply does not exist for that session, the
 * way it did not exist before this feature, and every caller degrades to that rather than failing.
 * Never rejects, so no boot path has to guard it.
 */
export function openIndexedDbVersionStore(databaseName: string = DATABASE_NAME): Promise<VersionStore | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise<VersionStore | null>((resolve) => {
    let settled = false;
    const settle = (store: VersionStore | null) => {
      if (settled) return;
      settled = true;
      resolve(store);
    };

    const timer = setTimeout(() => {
      console.warn("deviva-draw: the version history database did not open in time — version history is off for this session");
      settle(null);
    }, OPEN_TIMEOUT_MS);

    const finish = (store: VersionStore | null) => {
      clearTimeout(timer);
      settle(store);
    };

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(databaseName, DATABASE_VERSION);
    } catch (error) {
      console.warn("deviva-draw: could not open the version history database — version history is off for this session", error);
      finish(null);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SUMMARY_STORE)) {
        const summaries = database.createObjectStore(SUMMARY_STORE, { keyPath: "id" });
        // Not read by `list` (which sorts a capped set in memory), but declared so a future query
        // that does want a range — "everything older than a week" — has one without a migration.
        summaries.createIndex(CREATED_AT_INDEX, "createdAt");
      }
      if (!database.objectStoreNames.contains(DOCUMENT_STORE)) database.createObjectStore(DOCUMENT_STORE);
    };
    request.onsuccess = () => finish(createStore(request.result));
    request.onerror = () => {
      console.warn("deviva-draw: could not open the version history database — version history is off for this session", request.error);
      finish(null);
    };
    request.onblocked = () => {
      console.warn("deviva-draw: the version history database is blocked by another tab — version history is off for this session");
      finish(null);
    };
  });
}

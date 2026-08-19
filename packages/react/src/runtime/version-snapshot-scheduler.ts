/**
 * Decides *when* the document snapshots itself, and writes the record when it does.
 *
 * Three ways a snapshot happens, and they are not the same promise:
 *
 * - **auto** — the cadence. At most one per `AUTO_SNAPSHOT_INTERVAL_MS`, and only when the document's
 *   content revision moved since the last snapshot. An idle tab writes nothing at all, which is the
 *   difference between history and a log of the same board thirty times.
 * - **milestone** — taken immediately *before* an operation that replaces the whole document (file
 *   open, room join, clear canvas, restoring another version). These are the ones that matter most:
 *   a document swap is the one edit undo cannot walk back, so the snapshot is the only way back.
 * - **manual** — the user asked, by name. Never skipped, never pruned to make room for an automatic
 *   one.
 *
 * **The clock is injected.** Not a style preference: a scheduler that reads `Date.now()` ambiently
 * cannot be tested for the one property that matters here — "no second snapshot inside the window" —
 * without a test that actually waits five minutes.
 *
 * **A snapshot failure is never an autosave failure.** They are different promises to the user, and
 * `autosave-status-store.ts` exists to say "your work is not being saved". Losing version history is
 * not that, so every failure here is caught, warned about, and reported as `null` to the caller.
 */
import type { MultiPageDocumentV1 } from "@deviva-draw/engine";
import { summarizeDocument } from "../browser/version-snapshot-summary";
import { createVersionSnapshotWriter } from "./version-snapshot-writer";
import type { RetentionPolicy } from "../browser/version-retention";
import type { VersionStore } from "../browser/indexeddb-version-store";
import type { MilestoneReason, SnapshotTrigger, VersionSummary } from "../browser/version-snapshot-types";

/** At most one automatic snapshot per five minutes of *changed* activity — see `plan.md`'s Decisions Locked. ~12/hour of continuous editing, so the retention cap holds roughly a working session. */
export const AUTO_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

export interface VersionSnapshotSchedulerOptions {
  store: VersionStore;
  /** The document as autosave would write it — `DocumentAutosaveController.snapshotDocument`, never an independent serialisation (see that interface's doc for why the difference is load-bearing). */
  snapshotDocument(): MultiPageDocumentV1;
  /** Monotonic counter that moves whenever document *content* changes. Page switches and camera moves must not move it, or an idle look-around would fill history. */
  getContentRevision(): number;
  /** Injected for determinism under test — see the module doc. */
  now?(): number;
  /** Injected for determinism under test; production ids come from `crypto.randomUUID`. */
  newId?(): string;
  intervalMs?: number;
  /** Overridable so the policy can be driven to its edges in a test without writing fifty snapshots. */
  retentionPolicy?: RetentionPolicy;
}

export interface VersionSnapshotScheduler {
  /**
   * Writes a snapshot right now, bypassing the cadence gate. Returns the stored summary, or `null`
   * when nothing was written — a failed write, or a `milestone` over an empty board (there is
   * nothing to go back to, and a reload-then-new cycle would otherwise leave a trail of empty
   * records). A `manual` snapshot is always written: the user asked for it.
   */
  snapshotNow(trigger: "milestone", reason: MilestoneReason): Promise<VersionSummary | null>;
  snapshotNow(trigger: "manual", label: string): Promise<VersionSummary | null>;
  /**
   * One cadence evaluation. Called by this scheduler's own timer; exposed so the policy can be
   * driven directly by a test (and by a host that would rather own the timer) instead of being
   * reachable only by waiting.
   */
  tick(): Promise<VersionSummary | null>;
  /** `true` once snapshotting has given up for this session — see `VersionSnapshotWriter.stopped`. */
  stopped(): boolean;
  dispose(): void;
}

function defaultId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.trunc(Math.random() * 2 ** 32).toString(36)}`;
}

export function startVersionSnapshotScheduler(options: VersionSnapshotSchedulerOptions): VersionSnapshotScheduler {
  const { store, snapshotDocument, getContentRevision, now = () => Date.now(), newId = defaultId, intervalMs = AUTO_SNAPSHOT_INTERVAL_MS, retentionPolicy } = options;

  // Seeded from the state at start, not from zero: the document on screen right now is where history
  // begins, so the first automatic snapshot needs both a full interval AND a change after this point.
  let lastSnapshotAt = now();
  let lastSnapshotRevision = getContentRevision();
  // One store write at a time. The cadence timer and a milestone can land together (a room join at
  // the five-minute mark), and two concurrent writes would race on the bookkeeping above — with the
  // loser resetting `lastSnapshotAt` to a moment its own snapshot did not describe. Only the *write*
  // is serialised; each snapshot's content is captured synchronously at call time (see `capture`).
  let inFlight: Promise<VersionSummary | null> = Promise.resolve(null);
  // Landing a snapshot — quota handling and retention included — is the writer's job; this module
  // only decides whether one is worth taking. See `version-snapshot-writer.ts`.
  const writer = createVersionSnapshotWriter(store, retentionPolicy);

  /**
   * The synchronous half, and the reason this is split in two at all: a *milestone* snapshot is taken
   * immediately before the document is replaced, and the replacement happens in the same tick as the
   * call. Serialising inside the queued async write would read the document one microtask too late —
   * after the file that triggered the milestone had already been opened over it — so the snapshot
   * would capture the very state it exists to preserve a way back from.
   *
   * Returns `null` when there is nothing worth storing.
   */
  const capture = (trigger: SnapshotTrigger, label?: string): { summary: VersionSummary; document: MultiPageDocumentV1; fileIds: string[] } | null => {
    const document = snapshotDocument();
    const { fileIds, pageCount, elementCount, bytes } = summarizeDocument(document);
    // An empty board is not a version worth keeping — except when the user explicitly named one.
    if (elementCount === 0 && trigger !== "manual") return null;
    const summary: VersionSummary = { id: newId(), createdAt: now(), trigger, pageCount, elementCount, bytes, ...(label === undefined ? {} : { label }) };
    return { summary, document, fileIds };
  };

  const persist = async (captured: { summary: VersionSummary; document: MultiPageDocumentV1; fileIds: string[] }): Promise<VersionSummary | null> => {
    const { summary, document, fileIds } = captured;
    if (!(await writer.write({ ...summary, document, fileIds }))) return null;
    // Advanced only on a write that landed, so a failed attempt does not silently consume the
    // session's next interval — and stamped from the capture, not from "now", so the cadence measures
    // from the state the record actually describes.
    lastSnapshotAt = summary.createdAt;
    lastSnapshotRevision = getContentRevision();
    return summary;
  };

  const enqueue = (trigger: SnapshotTrigger, label?: string): Promise<VersionSummary | null> => {
    const captured = capture(trigger, label);
    if (!captured) return Promise.resolve(null);
    inFlight = inFlight.then(() => persist(captured));
    return inFlight;
  };

  const timer = setInterval(() => void tick(), intervalMs);

  async function tick(): Promise<VersionSummary | null> {
    if (now() - lastSnapshotAt < intervalMs) return null;
    if (getContentRevision() === lastSnapshotRevision) return null;
    return enqueue("auto");
  }

  return {
    snapshotNow: (trigger: SnapshotTrigger, label: string) => enqueue(trigger, label),
    tick,
    stopped: writer.stopped,
    dispose() {
      clearInterval(timer);
    },
  };
}

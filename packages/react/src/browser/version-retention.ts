/**
 * What version history keeps, and what it throws away — as a pure function over summaries, so the
 * policy can be tested exhaustively without a database in the room.
 *
 * The numbers are decisions, not defaults picked for roundness (see the plan's Decisions Locked):
 * 30 automatic + 10 manual, and a 50 MB ceiling over total *serialised snapshot bytes*. The ceiling
 * measures documents, not the images they reference: image bytes are shared between snapshots by
 * design — that sharing is the whole reason a snapshot is cheap — and counting them per snapshot
 * would charge the same photograph thirty times over.
 *
 * **Milestones are prunable, not protected.** They are machine-generated (a file open, a room join),
 * so a user who opens twenty files in an afternoon would otherwise fill a protected bucket with
 * entries they never asked for. They share the automatic budget and are pruned oldest-first with it.
 * Only a `manual` snapshot — one the user named — is protected.
 *
 * **Manual snapshots are protected from the counts, not from physics.** They are never pruned to make
 * room for an automatic one. But the byte ceiling is the answer to unbounded growth, and a rule that
 * exempted ten copies of a very large board would not be an answer at all — so once every prunable
 * entry is gone and the store is *still* over, the oldest manual entries go too. The newest snapshot
 * is always kept whatever the arithmetic says: a board too big to fit the ceiling should still leave
 * the user one version to go back to, rather than a history that silently stays empty.
 */
import type { VersionSummary } from "./version-snapshot-types";

export interface RetentionPolicy {
  /** Cap on `auto` + `milestone` entries combined — see the module doc on why milestones share this budget. */
  maxAutomatic: number;
  /** Cap on user-named `manual` entries. */
  maxManual: number;
  /** Ceiling over the sum of every retained snapshot's `bytes`. */
  maxTotalBytes: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  maxAutomatic: 30,
  maxManual: 10,
  maxTotalBytes: 50 * 1024 * 1024,
};

const isProtected = (summary: VersionSummary): boolean => summary.trigger === "manual";

/**
 * The ids to delete, given everything currently stored. Order of the input does not matter — it is
 * sorted newest-first here rather than trusted, because a policy that silently depended on its
 * caller's ordering would delete the wrong end of the history the first time a caller changed.
 */
export function snapshotsToPrune(summaries: readonly VersionSummary[], policy: RetentionPolicy = DEFAULT_RETENTION_POLICY): string[] {
  const newestFirst = [...summaries].sort((left, right) => right.createdAt - left.createdAt);
  const doomed = new Set<string>();

  // Count caps, each bucket keeping its own newest.
  let automatic = 0;
  let manual = 0;
  for (const summary of newestFirst) {
    if (isProtected(summary)) {
      manual += 1;
      if (manual > policy.maxManual) doomed.add(summary.id);
    } else {
      automatic += 1;
      if (automatic > policy.maxAutomatic) doomed.add(summary.id);
    }
  }

  // Byte ceiling over whatever the counts left behind. Oldest prunable first; only once none of
  // those remain does a protected entry become eligible — and never the newest snapshot of all.
  const survivors = newestFirst.filter((summary) => !doomed.has(summary.id));
  let total = survivors.reduce((sum, summary) => sum + summary.bytes, 0);
  const oldestFirst = [...survivors].reverse();
  for (const pass of [false, true]) {
    for (const summary of oldestFirst) {
      if (total <= policy.maxTotalBytes) break;
      if (doomed.has(summary.id)) continue;
      if (isProtected(summary) !== pass) continue;
      // The newest entry is the one thing this never takes — see the module doc.
      if (summary.id === newestFirst[0]?.id) continue;
      doomed.add(summary.id);
      total -= summary.bytes;
    }
  }

  return [...doomed];
}

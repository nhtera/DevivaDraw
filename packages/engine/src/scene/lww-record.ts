/**
 * The one last-writer-wins comparison every versioned record in this codebase resolves conflicts
 * with — elements, and now comment threads/messages. A higher `version` always wins outright; an
 * equal `version` is broken by a deterministic, order-independent comparison of `versionNonce`
 * (lexicographic STRING comparison, not numeric — either is deterministic, but the string form is
 * what every peer in this codebase has always compared, so it must stay that way rather than
 * silently drifting to a different-but-also-deterministic rule and splitting the network).
 *
 * It lives in the engine rather than in the collab client because the comment store must apply the
 * identical rule inside `applyRemote*` (the engine owns that decision, and the engine cannot import
 * the collab client — the dependency runs the other way). `collab-client/lww-merge.ts`'s
 * `remoteElementWins` delegates here, so there is exactly one implementation of the rule.
 */

/** The minimum every LWW-resolved record carries — the element envelope's version pair. */
export interface LwwRecord {
  version: number;
  versionNonce: number;
}

/**
 * `true` when `remote` should overwrite `local` (or `local` is absent — a brand-new record) under
 * the rule described in the module doc. `false` for an already-applied identical record (same
 * version AND versionNonce) as well as for a strictly older/losing one — both mean "nothing to
 * change", which callers use to skip a redundant apply or a pointless rebroadcast.
 */
export function lwwRecordWins(local: LwwRecord | undefined, remote: LwwRecord): boolean {
  if (!local) return true;
  if (remote.version !== local.version) return remote.version > local.version;
  if (remote.versionNonce === local.versionNonce) return false;
  return String(remote.versionNonce) > String(local.versionNonce);
}

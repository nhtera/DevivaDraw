/**
 * Centralized invariant enforcement for element mutations.
 *
 * Every code path that changes a persisted element field — including the very first insert —
 * must run through `touch()` so `version`/`versionNonce`/`updated` never drift out of lockstep.
 * A future collaboration layer diffs two copies of the same element by comparing `version` (and
 * breaking ties with `versionNonce`) rather than trusting wall-clock time across machines, so a
 * single mutation path that forgets to bump these would silently corrupt merges. Routing every
 * `Scene` mutation through this one function is what makes that impossible instead of just
 * unlikely.
 */
import type { AnyElement } from "../elements/element-types";

const MAX_RANDOM_INT = 2 ** 31;

/** Cryptographically-insignificant random int: only needs to be unlikely to collide, not secure. */
export function randomVersionNonce(): number {
  return Math.floor(Math.random() * MAX_RANDOM_INT);
}

/**
 * Returns a new element with `changes` applied and `version`/`versionNonce`/`updated` bumped.
 * Elements are treated as immutable snapshots — a new object is always returned, never mutated
 * in place — so subscribers and the history stack can rely on reference identity to detect change.
 *
 * The returned element (and its nested `groupIds`/`boundElements`/`roundness`) is frozen before
 * it leaves this function: `Scene` hands out the exact same object it stores internally, so
 * without freezing, a caller writing `scene.getElement(id).x = 5` would silently corrupt the
 * store's copy without ever going through this bump logic. Freezing turns that write into a
 * thrown `TypeError` (this module runs in strict mode) instead of a silent invariant violation.
 */
export function touch<T extends AnyElement>(element: T, changes: Partial<T> = {}): T {
  const next: T = {
    ...element,
    ...changes,
    version: element.version + 1,
    versionNonce: randomVersionNonce(),
    updated: Date.now(),
  };
  return freeze(next);
}

/** Freezes an element and the mutable containers nested inside it, one level deep. */
function freeze<T extends AnyElement>(element: T): T {
  Object.freeze(element.groupIds);
  if (element.boundElements) {
    for (const ref of element.boundElements) Object.freeze(ref);
    Object.freeze(element.boundElements);
  }
  if (element.roundness) Object.freeze(element.roundness);
  return Object.freeze(element);
}

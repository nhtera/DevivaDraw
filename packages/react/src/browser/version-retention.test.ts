/**
 * The retention policy. Exhaustive because it is pure and cheap to be exhaustive about, and because
 * every rule here is one a user experiences as loss: the wrong end of the history pruned, a version
 * they named thrown away for a machine-generated one, or a store that grows until the browser
 * complains.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RETENTION_POLICY, snapshotsToPrune } from "./version-retention";
import type { RetentionPolicy } from "./version-retention";
import type { SnapshotTrigger, VersionSummary } from "./version-snapshot-types";

function summary(id: string, createdAt: number, trigger: SnapshotTrigger = "auto", bytes = 1): VersionSummary {
  return { id, createdAt, trigger, pageCount: 1, elementCount: 1, bytes };
}

/** Small caps so the count rules are legible; the byte ceiling is out of the way unless a test wants it. */
const smallCaps: RetentionPolicy = { maxAutomatic: 3, maxManual: 2, maxTotalBytes: Number.MAX_SAFE_INTEGER };

describe("snapshotsToPrune", () => {
  it("keeps everything while under every cap", () => {
    const kept = [summary("a", 1), summary("b", 2, "manual"), summary("c", 3, "milestone")];

    expect(snapshotsToPrune(kept, smallCaps)).toEqual([]);
  });

  it("prunes the oldest automatic entries past the cap, newest kept", () => {
    const stored = [1, 2, 3, 4, 5].map((n) => summary(`a${n}`, n));

    expect(snapshotsToPrune(stored, smallCaps).sort()).toEqual(["a1", "a2"]);
  });

  it("counts milestones against the automatic budget, not a protected one", () => {
    const stored = [summary("m1", 1, "milestone"), summary("m2", 2, "milestone"), summary("a3", 3), summary("a4", 4)];

    // Four prunable entries, cap of three: the oldest goes, and being a milestone does not save it.
    expect(snapshotsToPrune(stored, smallCaps)).toEqual(["m1"]);
  });

  it("never prunes a manual snapshot to make room for an automatic one", () => {
    const stored = [summary("manual-old", 1, "manual"), ...[2, 3, 4, 5, 6].map((n) => summary(`a${n}`, n))];

    const doomed = snapshotsToPrune(stored, smallCaps);

    expect(doomed).not.toContain("manual-old");
    expect(doomed.sort()).toEqual(["a2", "a3"]);
  });

  it("prunes the oldest manual entries past their own, separate cap", () => {
    const stored = [1, 2, 3, 4].map((n) => summary(`m${n}`, n, "manual"));

    expect(snapshotsToPrune(stored, smallCaps).sort()).toEqual(["m1", "m2"]);
  });

  it("prunes by bytes even when every count cap is satisfied", () => {
    const policy: RetentionPolicy = { maxAutomatic: 100, maxManual: 100, maxTotalBytes: 250 };
    const stored = [summary("a1", 1, "auto", 100), summary("a2", 2, "auto", 100), summary("a3", 3, "auto", 100)];

    // 300 over a 250 ceiling: the oldest goes, and one removal is enough.
    expect(snapshotsToPrune(stored, policy)).toEqual(["a1"]);
  });

  it("spends every prunable entry on the byte ceiling before touching a manual one", () => {
    const policy: RetentionPolicy = { maxAutomatic: 100, maxManual: 100, maxTotalBytes: 250 };
    const stored = [summary("m1", 1, "manual", 100), summary("a2", 2, "auto", 100), summary("a3", 3, "auto", 100)];

    // `m1` is the oldest, but it is protected: the automatic entry goes instead.
    expect(snapshotsToPrune(stored, policy)).toEqual(["a2"]);
  });

  it("takes manual entries once nothing else is left and the store is still over", () => {
    const policy: RetentionPolicy = { maxAutomatic: 100, maxManual: 100, maxTotalBytes: 150 };
    const stored = [summary("m1", 1, "manual", 100), summary("m2", 2, "manual", 100), summary("m3", 3, "manual", 100)];

    // The ceiling is the answer to unbounded growth; exempting manual entries would unanswer it.
    // Both old entries go — pruning stops at the first size that fits, not at the first deletion.
    expect(snapshotsToPrune(stored, policy).sort()).toEqual(["m1", "m2"]);
  });

  it("always leaves the newest snapshot, however far over the ceiling one board is", () => {
    const policy: RetentionPolicy = { maxAutomatic: 100, maxManual: 100, maxTotalBytes: 10 };
    const stored = [summary("old", 1, "auto", 5000), summary("newest", 2, "auto", 5000)];

    const doomed = snapshotsToPrune(stored, policy);

    expect(doomed).toEqual(["old"]);
    // Still over the ceiling — and that is the right answer. A history that pruned itself empty
    // would leave a user with a large board no way back at all.
    expect(doomed).not.toContain("newest");
  });

  it("reads the same however the caller ordered its input", () => {
    const stored = [1, 2, 3, 4, 5].map((n) => summary(`a${n}`, n));
    const shuffled = [stored[2]!, stored[0]!, stored[4]!, stored[1]!, stored[3]!];

    expect(snapshotsToPrune(shuffled, smallCaps).sort()).toEqual(snapshotsToPrune(stored, smallCaps).sort());
  });

  it("ships the decided numbers, not placeholders", () => {
    expect(DEFAULT_RETENTION_POLICY).toEqual({ maxAutomatic: 30, maxManual: 10, maxTotalBytes: 50 * 1024 * 1024 });
  });

  it("holds the default caps against a realistic overflow", () => {
    const stored = [
      ...Array.from({ length: 40 }, (_unused, index) => summary(`a${index}`, index + 1)),
      ...Array.from({ length: 12 }, (_unused, index) => summary(`m${index}`, index + 100, "manual")),
    ];

    const doomed = new Set(snapshotsToPrune(stored));

    // 40 automatic → 10 oldest go; 12 manual → 2 oldest go.
    expect(doomed.size).toBe(12);
    expect([...doomed].filter((id) => id.startsWith("a"))).toHaveLength(10);
    expect(doomed.has("a0")).toBe(true);
    expect(doomed.has("a9")).toBe(true);
    expect(doomed.has("a10")).toBe(false);
    expect(doomed.has("m0")).toBe(true);
    expect(doomed.has("m1")).toBe(true);
    expect(doomed.has("m2")).toBe(false);
  });
});

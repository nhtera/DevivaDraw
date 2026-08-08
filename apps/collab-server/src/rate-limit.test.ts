import { describe, expect, it } from "vitest";
import { RATE_LIMITER_SWEEP_INTERVAL_CALLS, RateLimiter } from "./rate-limit";

describe("RateLimiter.allow", () => {
  it("allows requests up to maxRequests within a window", () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000 });
    expect(limiter.allow("k", 0)).toBe(true);
    expect(limiter.allow("k", 10)).toBe(true);
    expect(limiter.allow("k", 20)).toBe(true);
  });

  it("rejects the request that exceeds maxRequests within the same window", () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60_000 });
    expect(limiter.allow("k", 0)).toBe(true);
    expect(limiter.allow("k", 10)).toBe(true);
    expect(limiter.allow("k", 20)).toBe(false);
  });

  it("resets the count once the window elapses", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 });
    expect(limiter.allow("k", 0)).toBe(true);
    expect(limiter.allow("k", 500)).toBe(false);
    expect(limiter.allow("k", 1000)).toBe(true); // new window starts at exactly windowMs
  });

  it("tracks separate keys independently", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
    expect(limiter.allow("put:1.2.3.4", 0)).toBe(true);
    expect(limiter.allow("put:5.6.7.8", 0)).toBe(true);
    expect(limiter.allow("put:1.2.3.4", 10)).toBe(false);
    expect(limiter.allow("put:5.6.7.8", 10)).toBe(false);
  });

  it("defaults 'now' to the real clock when omitted", () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60_000 });
    expect(limiter.allow("k")).toBe(true);
  });
});

describe("RateLimiter — bounded memory (eviction + expiry sweep)", () => {
  it("caps distinct-key memory at maxEntries, evicting the oldest-inserted bucket to admit a new key", () => {
    const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60_000, maxEntries: 3 });
    limiter.allow("a", 0);
    limiter.allow("b", 0);
    limiter.allow("c", 0);
    expect(limiter.size).toBe(3);

    limiter.allow("d", 0); // exceeds maxEntries=3 — "a" (oldest-inserted) must be evicted to admit "d"

    expect(limiter.size).toBe(3);
  });

  it("never exceeds maxEntries even under a sustained burst of unique keys", () => {
    const limiter = new RateLimiter({ maxRequests: 10, windowMs: 60_000, maxEntries: 50 });
    for (let i = 0; i < 500; i += 1) limiter.allow(`unique-key-${i}`, 0);
    expect(limiter.size).toBeLessThanOrEqual(50);
  });

  it("sweeps expired buckets on the periodic cadence, reclaiming memory from many one-off keys", () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000, maxEntries: 100_000 });

    // Seed a batch of distinct keys, all in a window that will be long expired by the time the sweep
    // below runs — each key is only ever touched once, so nothing besides the periodic sweep (not
    // per-key refresh) can ever reclaim them.
    const expiredKeyCount = RATE_LIMITER_SWEEP_INTERVAL_CALLS + 50;
    for (let i = 0; i < expiredKeyCount; i += 1) limiter.allow(`expired-${i}`, 0);
    expect(limiter.size).toBe(expiredKeyCount);

    // Enough further calls (at a `now` past every seeded bucket's window) to guarantee at least one
    // full sweep cycle has run.
    const farFuture = 1_000_000;
    for (let i = 0; i < RATE_LIMITER_SWEEP_INTERVAL_CALLS * 2; i += 1) limiter.allow(`fresh-${i}`, farFuture);

    // Every `expired-*` bucket is long past its 1000ms window relative to `farFuture`, and every
    // `fresh-*` key is brand new — so if (and only if) the periodic sweep reclaimed the expired batch,
    // the final tracked count is exactly the number of fresh keys just added, not that plus the stale
    // 306 left over from before.
    expect(limiter.size).toBe(RATE_LIMITER_SWEEP_INTERVAL_CALLS * 2);
  });
});

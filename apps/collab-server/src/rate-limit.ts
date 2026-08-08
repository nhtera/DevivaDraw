/**
 * Simple per-key fixed-window token bucket, in-memory per Worker isolate. Abuse-deterrence, not a
 * security boundary (the client-side AES-GCM encryption is that boundary): requests from the same
 * caller landing on different isolates each get their own independent bucket, so a determined attacker
 * spread across enough isolates can still exceed the effective global rate. Memory is still bounded
 * regardless of how many distinct keys are seen: `sweepPeriodically` amortizes dropping expired
 * buckets, and `maxEntries` hard-caps the map size with oldest-inserted eviction, so a burst of unique
 * keys (e.g. spoofed `cf-connecting-ip` values) can never grow this map without bound.
 */
export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  /** Hard cap on distinct keys tracked at once; the oldest-inserted bucket is evicted to admit a new key once reached. Defaults to `DEFAULT_MAX_ENTRIES`. */
  maxEntries?: number;
}

interface BucketState {
  count: number;
  windowStartedAt: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;
/** How often (in `allow()` calls) to sweep every bucket for expired entries — amortizes the sweep's O(bucket count) cost across many calls instead of paying it on every single one. Exported so tests can trigger a sweep deterministically instead of guessing the cadence. */
export const RATE_LIMITER_SWEEP_INTERVAL_CALLS = 256;

export class RateLimiter {
  private readonly buckets = new Map<string, BucketState>();
  private readonly maxEntries: number;
  private callsSinceSweep = 0;

  constructor(private readonly options: RateLimiterOptions) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /** Distinct keys currently tracked — exposed primarily so tests can assert eviction/sweep behavior without reaching into private state. */
  get size(): number {
    return this.buckets.size;
  }

  /**
   * `true` if `key` is still under its limit for the current window (and records this call against
   * it); `false` once the window's `maxRequests` is exceeded. `now` is injectable so tests can
   * exercise window rollover and sweep/eviction deterministically instead of racing `Date.now()`.
   */
  allow(key: string, now: number = Date.now()): boolean {
    this.sweepPeriodically(now);

    const existing = this.buckets.get(key);
    if (!existing || now - existing.windowStartedAt >= this.options.windowMs) {
      this.admitNewBucket(key, now);
      return true;
    }
    if (existing.count >= this.options.maxRequests) return false;
    existing.count += 1;
    return true;
  }

  /**
   * Inserts a fresh bucket for `key`, evicting the oldest-inserted entry first if already at
   * `maxEntries` — bounds memory even if every incoming key is unique. "Oldest-inserted" (`Map`'s
   * first iteration entry), not "least-recently-used": a cheap, deliberately simple approximation,
   * not a full LRU — a key refreshed after its window expired keeps its original insertion slot
   * rather than moving to the back.
   */
  private admitNewBucket(key: string, now: number): void {
    if (!this.buckets.has(key) && this.buckets.size >= this.maxEntries) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey !== undefined) this.buckets.delete(oldestKey);
    }
    this.buckets.set(key, { count: 1, windowStartedAt: now });
  }

  /**
   * Amortized full sweep of expired buckets every `RATE_LIMITER_SWEEP_INTERVAL_CALLS` calls — cleans
   * up memory from many distinct keys that are each only ever seen once, which `admitNewBucket`'s
   * per-key reset alone would never do (it only ever touches the one key being called with).
   */
  private sweepPeriodically(now: number): void {
    this.callsSinceSweep += 1;
    if (this.callsSinceSweep < RATE_LIMITER_SWEEP_INTERVAL_CALLS) return;
    this.callsSinceSweep = 0;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStartedAt >= this.options.windowMs) this.buckets.delete(key);
    }
  }
}

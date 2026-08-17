import { describe, expect, it, vi } from "vitest";
import { createAutosaveStatusStore } from "./autosave-status-store";

describe("createAutosaveStatusStore", () => {
  it("starts able to save", () => {
    expect(createAutosaveStatusStore().getStatus()).toBe("ok");
  });

  it("latches a quota failure and notifies subscribers", () => {
    const store = createAutosaveStatusStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.markQuotaExceeded();

    expect(store.getStatus()).toBe("quota-exceeded");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("clears the warning on the next successful write — the whole reason successes are reported", () => {
    const store = createAutosaveStatusStore();
    store.markQuotaExceeded();
    const listener = vi.fn();
    store.subscribe(listener);

    store.markWritten();

    expect(store.getStatus()).toBe("ok");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // Autosave writes once per quiet period for a whole session; notifying on every one of those would
  // re-render the chrome forever for a status that never changed.
  it("notifies only on an actual transition, not on every write", () => {
    const store = createAutosaveStatusStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.markWritten();
    store.markWritten();
    expect(listener).not.toHaveBeenCalled();

    store.markQuotaExceeded();
    store.markQuotaExceeded();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createAutosaveStatusStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.markQuotaExceeded();

    expect(listener).not.toHaveBeenCalled();
  });
});

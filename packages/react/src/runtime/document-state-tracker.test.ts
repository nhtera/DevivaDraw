import { describe, expect, it, vi } from "vitest";
import { DocumentStateTracker } from "./document-state-tracker";

describe("DocumentStateTracker", () => {
  it("starts clean and untitled", () => {
    expect(new DocumentStateTracker().getState()).toEqual({ path: null, name: "Untitled", dirty: false });
  });

  it("an edit flips dirty synchronously; a successful save flips it back and records identity", () => {
    const tracker = new DocumentStateTracker();
    tracker.markContentChanged();
    expect(tracker.getState().dirty).toBe(true);

    tracker.markSaved({ path: "/tmp/a.devivadraw", name: "a.devivadraw" });
    expect(tracker.getState()).toEqual({ path: "/tmp/a.devivadraw", name: "a.devivadraw", dirty: false });
  });

  it("a failed save (no markSaved call) leaves dirty state untouched", () => {
    const tracker = new DocumentStateTracker();
    tracker.markSaved({ path: "/tmp/a.devivadraw", name: "a.devivadraw" });
    tracker.markContentChanged();
    // ...save attempt rejects; caller does NOT markSaved...
    expect(tracker.getState().dirty).toBe(true);
  });

  it("edits after a save re-dirty; an open (markSaved with new identity) cleans against the CURRENT revision", () => {
    const tracker = new DocumentStateTracker();
    tracker.markContentChanged();
    tracker.markContentChanged();
    tracker.markSaved({ path: null, name: "board.devivadraw" }); // e.g. a browser open — no path
    expect(tracker.getState()).toEqual({ path: null, name: "board.devivadraw", dirty: false });

    tracker.markContentChanged();
    expect(tracker.getState().dirty).toBe(true);
  });

  it("notifies subscribers on every transition, and unsubscribe stops it", () => {
    const tracker = new DocumentStateTracker();
    const seen = vi.fn();
    const stop = tracker.subscribe(seen);
    tracker.markContentChanged();
    tracker.markSaved({ path: "/p", name: "p" });
    expect(seen).toHaveBeenCalledTimes(2);
    stop();
    tracker.markContentChanged();
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

/**
 * The rule that keeps a replaced document from writing over the file it used to be.
 */
describe("markNewDocument", () => {
  it("forgets the file the document used to be, so the next save cannot overwrite it", () => {
    const tracker = new DocumentStateTracker();
    tracker.markSaved({ path: "/home/me/my-work.devivadraw", name: "my-work.devivadraw" });
    tracker.markContentChanged();

    tracker.markNewDocument();

    expect(tracker.getState().path).toBeNull();
    expect(tracker.getState().name).toBe("Untitled");
  });

  it("is clean, because a blank document has nothing in it to lose", () => {
    const tracker = new DocumentStateTracker();
    tracker.markContentChanged();
    expect(tracker.getState().dirty).toBe(true);

    tracker.markNewDocument();

    expect(tracker.getState().dirty).toBe(false);
  });

  it("goes dirty again on the first edit after it, like any other document", () => {
    const tracker = new DocumentStateTracker();
    tracker.markNewDocument();

    tracker.markContentChanged();

    expect(tracker.getState().dirty).toBe(true);
  });

  it("notifies, so a host title bar drops the file name it was showing", () => {
    const tracker = new DocumentStateTracker();
    tracker.markSaved({ path: "/tmp/a.devivadraw", name: "a.devivadraw" });
    let notifications = 0;
    tracker.subscribe(() => (notifications += 1));

    tracker.markNewDocument();

    expect(notifications).toBe(1);
  });
});

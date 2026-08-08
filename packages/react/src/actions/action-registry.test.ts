import { describe, expect, it, vi } from "vitest";
import { ActionRegistry } from "./action-registry";
import type { Action, ActionRuntime } from "./action-types";

const FAKE_RUNTIME = {} as ActionRuntime;

function makeAction(overrides: Partial<Action> = {}): Action {
  return { id: "test-action", labelKey: "action.undo", icon: "undo", run: vi.fn(), ...overrides };
}

describe("ActionRegistry.register/get/list", () => {
  it("registers and retrieves an action by id", () => {
    const registry = new ActionRegistry();
    const action = makeAction();
    registry.register(action);
    expect(registry.get("test-action")).toBe(action);
  });

  it("get returns undefined for an unregistered id", () => {
    const registry = new ActionRegistry();
    expect(registry.get("nope")).toBeUndefined();
  });

  it("list returns every registered action in registration order", () => {
    const registry = new ActionRegistry();
    const a = makeAction({ id: "a" });
    const b = makeAction({ id: "b" });
    registry.register(a);
    registry.register(b);
    expect(registry.list()).toEqual([a, b]);
  });

  it("warns and keeps the first registration when the same id is registered twice", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ActionRegistry();
    const first = makeAction({ id: "dup" });
    const second = makeAction({ id: "dup", icon: "different" });
    registry.register(first);
    registry.register(second);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(registry.get("dup")).toBe(first);
    warn.mockRestore();
  });
});

describe("ActionRegistry.isEnabled", () => {
  it("is true by default when isEnabled is omitted", () => {
    const registry = new ActionRegistry();
    registry.register(makeAction());
    expect(registry.isEnabled("test-action", FAKE_RUNTIME)).toBe(true);
  });

  it("delegates to the action's own isEnabled predicate", () => {
    const registry = new ActionRegistry();
    registry.register(makeAction({ isEnabled: () => false }));
    expect(registry.isEnabled("test-action", FAKE_RUNTIME)).toBe(false);
  });

  it("is false for an unregistered action id", () => {
    const registry = new ActionRegistry();
    expect(registry.isEnabled("nope", FAKE_RUNTIME)).toBe(false);
  });
});

describe("ActionRegistry.run", () => {
  it("invokes the action's run handler with the given runtime", () => {
    const registry = new ActionRegistry();
    const run = vi.fn();
    registry.register(makeAction({ run }));

    registry.run("test-action", FAKE_RUNTIME);

    expect(run).toHaveBeenCalledWith(FAKE_RUNTIME);
  });

  it("does not invoke run when isEnabled returns false", () => {
    const registry = new ActionRegistry();
    const run = vi.fn();
    registry.register(makeAction({ run, isEnabled: () => false }));

    registry.run("test-action", FAKE_RUNTIME);

    expect(run).not.toHaveBeenCalled();
  });

  it("warns (not throws) for an unknown action id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ActionRegistry();
    expect(() => registry.run("nope", FAKE_RUNTIME)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("never dispatches by anything other than a registered id (no dynamic/eval-style execution surface)", () => {
    const registry = new ActionRegistry();
    const run = vi.fn();
    registry.register(makeAction({ id: "safe-action", run }));

    // Simulates a hostile/typo'd id arriving from an untrusted UI surface — must be a no-op, not a crash.
    registry.run("__proto__", FAKE_RUNTIME);
    registry.run("constructor", FAKE_RUNTIME);

    expect(run).not.toHaveBeenCalled();
  });
});

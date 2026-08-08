/**
 * A boolean React state paired with a ref-backed synchronous getter — needed because `ActionRuntime`
 * (`actions/action-types.ts`'s `UiToggleState`) is built once inside `use-deviva-runtime.ts`'s mount
 * effect (which only re-runs on an explicit scene swap, not on every toggle) and its action handlers
 * read `getZenMode()` etc. synchronously at click/shortcut time — a plain closure over a `useState`
 * value would freeze at whatever it was when the effect last ran. The ref always holds the current
 * value; `set` keeps both in sync so the value is simultaneously "React-reactive" (drives a re-render
 * for chrome components that display it) and "always current" (safe for the engine-layer getter).
 * Not unit tested: a bare React hook has no logic left to test outside a component render cycle once
 * separated from `useState`/`useRef`/`useCallback` themselves — no test renderer (`@testing-library/
 * react`) is a dependency of this package, same trade-off this package's other hooks document.
 */
import { useCallback, useRef, useState } from "react";

export interface ToggleState {
  value: boolean;
  get(): boolean;
  set(next: boolean): void;
}

export function useToggleState(initial: boolean): ToggleState {
  const [value, setValue] = useState(initial);
  const ref = useRef(initial);
  const set = useCallback((next: boolean) => {
    ref.current = next;
    setValue(next);
  }, []);
  const get = useCallback(() => ref.current, []);
  return { value, get, set };
}

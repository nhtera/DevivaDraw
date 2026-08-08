/**
 * Generic version of `use-toggle-state.ts`'s "React-reactive + always-current ref" pattern for
 * non-boolean UI state that an action handler (living outside React, see `ActionRuntime`) needs to
 * read/write synchronously and a chrome component needs to re-render on. `ShareDialogState`
 * (`actions/action-types.ts`) is the one case besides the boolean toggles where an action mutates
 * state a component displays — see `use-toggle-state.ts`'s doc for the full rationale (`ActionRuntime`
 * is built once inside `use-deviva-runtime.ts`'s mount effect, so a plain closure over a `useState`
 * value would freeze at whatever it was when that effect last ran).
 * Not unit tested for the same reason `use-toggle-state.ts` isn't: no logic remains once separated
 * from `useState`/`useRef`/`useCallback` themselves, and this package has no DOM test renderer.
 */
import { useCallback, useRef, useState } from "react";

export interface ValueState<T> {
  value: T;
  get(): T;
  set(next: T): void;
}

export function useValueState<T>(initial: T): ValueState<T> {
  const [value, setValue] = useState(initial);
  const ref = useRef(initial);
  const set = useCallback((next: T) => {
    ref.current = next;
    setValue(next);
  }, []);
  const get = useCallback(() => ref.current, []);
  return { value, get, set };
}

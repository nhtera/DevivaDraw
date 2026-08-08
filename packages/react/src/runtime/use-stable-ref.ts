/**
 * Two small ref-indirection hooks solving the stale-closure problem any "built once, called later"
 * consumer runs into — `use-deviva-runtime.ts`'s mount effect is the main example: it only reruns on
 * an explicit scene swap (not on every render), so a plain closure over a prop/callback/piece of
 * state would freeze at whatever it was when the effect last ran (theme mode/toggle, and — after the
 * dialog-suppression and stale-`onChange` review fixes — the chrome-overlay-open flag and the host's
 * `onChange` callback). Both hooks are thin React wiring (`useRef`+`useEffect`, updated every render)
 * around `latest-callback-box.ts`'s pure, fully unit-tested "always call the latest version" core —
 * the wiring itself has no logic left to test without a React renderer (this package has no
 * `@testing-library/react` dependency, same trade-off this package's other hooks document).
 */
import { useEffect, useRef } from "react";
import { createLatestCallbackBox } from "./latest-callback-box";

/** Returns a stable `() => T` that always reads the latest `value` passed on each render. */
export function useStableGetter<T>(value: T): () => T {
  const boxRef = useRef<ReturnType<typeof createLatestCallbackBox<() => T>> | null>(null);
  boxRef.current ??= createLatestCallbackBox(() => value);
  useEffect(() => {
    boxRef.current!.set(() => value);
  });
  return boxRef.current.invoke;
}

/** Returns a stable function that always delegates to the latest `fn` passed on each render. */
export function useStableCallback<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R {
  const boxRef = useRef<ReturnType<typeof createLatestCallbackBox<(...args: Args) => R>> | null>(null);
  boxRef.current ??= createLatestCallbackBox(fn);
  useEffect(() => {
    boxRef.current!.set(fn);
  });
  return boxRef.current.invoke;
}

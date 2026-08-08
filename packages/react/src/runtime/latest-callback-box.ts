/**
 * Pure, framework-free "always call the latest version of this function" box — the core mechanism
 * `use-stable-ref.ts`'s `useStableGetter`/`useStableCallback` wrap in a React ref/effect. Split out
 * on its own so the actual "does calling `invoke` after `set` dispatch to the newest function"
 * behavior is unit-testable without a React renderer (this package has no `@testing-library/react`
 * dependency — see every other hook's doc for the same constraint). `invoke`'s identity never
 * changes across `set()` calls, which is what makes it safe to hand to a `useEffect`
 * dependency array or an engine callback slot built once and never rebuilt (e.g.
 * `use-deviva-runtime.ts`'s mount effect, which only reruns on an explicit scene swap).
 */
export interface LatestCallbackBox<Fn extends (...args: never[]) => unknown> {
  /** Repoints `invoke` at `fn` — call on every render with the newest closure. */
  set(fn: Fn): void;
  /** Stable identity; always delegates to whatever `set` most recently received. */
  invoke: Fn;
}

export function createLatestCallbackBox<Fn extends (...args: never[]) => unknown>(initial: Fn): LatestCallbackBox<Fn> {
  let current = initial;
  const invoke = ((...args: Parameters<Fn>) => current(...args)) as Fn;
  return {
    set: (fn) => {
      current = fn;
    },
    invoke,
  };
}

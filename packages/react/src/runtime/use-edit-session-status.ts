/**
 * Re-renders on text-edit start/commit/cancel and reports the current status — the same
 * subscribe-based "reflect live engine state" shape as `use-live-version.ts`'s hooks, split out
 * because it returns the status itself rather than a version counter, and because it tolerates a
 * `null` session (the shell has none until the runtime finishes mounting).
 */
import { useEffect, useReducer } from "react";
import type { TextEditSession } from "@deviva-draw/engine";

export function useEditSessionStatus(session: TextEditSession | null): "idle" | "editing" {
  const [, dispatch] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!session) return;
    return session.subscribe(() => dispatch());
  }, [session]);
  return session?.getState().status ?? "idle";
}

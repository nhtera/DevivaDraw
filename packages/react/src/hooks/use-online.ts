/**
 * Offline awareness for online-only entry points (Share, Collaborate, Mermaid AI). Two pieces:
 * `useOnline` tracks `navigator.onLine` live, and `OfflineHintsContext` gates whether that state
 * is allowed to RENDER anything — only hosts that opt in (`<DevivaDraw offlineHints/>`, set by the
 * desktop shell) show hints, so the web app's rendered output is provably unchanged (same pattern
 * as the `shareApiBaseUrl`-absent degradation). Detection is deliberately entry-point-gating, not
 * request-polling: `navigator.onLine` is a cheap upper bound, and a request that fails anyway
 * still lands in each feature's existing error state.
 */
import { createContext, useContext, useEffect, useState } from "react";

/** `true` ⇒ components may render "requires internet" hints. Default `false`: browser hosts render exactly as before. */
export const OfflineHintsContext = createContext(false);

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** `true` iff the host opted into hints AND the machine is offline — the render condition every online-only entry point shares. */
export function useOfflineHint(): boolean {
  const enabled = useContext(OfflineHintsContext);
  const online = useOnline();
  return enabled && !online;
}

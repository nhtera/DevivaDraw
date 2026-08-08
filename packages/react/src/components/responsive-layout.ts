/**
 * Responsive breakpoint logic for the mobile chrome milestone: a bottom toolbar replaces the desktop
 * toolbar below `MOBILE_BREAKPOINT_PX`. `isNarrowViewport` is pure/tested; `useIsNarrowViewport` is
 * the thin `window.matchMedia`-driven hook `deviva-draw-app.tsx` reads (untested — DOM-only listener
 * wiring with no logic left once the pure predicate is factored out, same trade-off this package's
 * other DOM hooks document).
 */
import { useEffect, useState } from "react";

/** Below this viewport width, the chrome switches to the mobile (bottom-toolbar) layout — a conventional phone/small-tablet portrait breakpoint. */
export const MOBILE_BREAKPOINT_PX = 768;

export function isNarrowViewport(viewportWidthPx: number, breakpointPx: number = MOBILE_BREAKPOINT_PX): boolean {
  return viewportWidthPx < breakpointPx;
}

export function useIsNarrowViewport(breakpointPx: number = MOBILE_BREAKPOINT_PX): boolean {
  const [narrow, setNarrow] = useState(() => (typeof window === "undefined" ? false : isNarrowViewport(window.innerWidth, breakpointPx)));

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [breakpointPx]);

  return narrow;
}

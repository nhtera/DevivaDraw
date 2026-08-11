/**
 * Responsive breakpoint logic for the mobile chrome: below `MOBILE_BREAKPOINT_PX` wide *or* below
 * `MOBILE_SHORT_EDGE_PX` tall, the chrome switches to the mobile layout (bottom toolbar + compact
 * properties bar). The height clause is what routes a landscape phone — wide enough to clear the width
 * breakpoint but only ~400px tall — to the mobile UX, instead of the desktop top-right panel which is
 * taller than a landscape phone's viewport and would clip its lower controls.
 *
 * `isNarrowViewport`/`isCompactViewport` are pure/tested; `useIsNarrowViewport` is the thin
 * `window.matchMedia`-driven hook `deviva-draw-shell.tsx` reads (untested — DOM-only listener wiring
 * with no logic left once the pure predicates are factored out, same trade-off this package's other DOM
 * hooks document).
 */
import { useEffect, useState } from "react";

/** Below this viewport width, the chrome switches to the mobile (bottom-toolbar) layout — a conventional phone/small-tablet portrait breakpoint. */
export const MOBILE_BREAKPOINT_PX = 768;

/** Below this viewport height, the chrome also switches to mobile — catches landscape phones (wide but short), whose height can't fit the desktop side panel. */
export const MOBILE_SHORT_EDGE_PX = 500;

export function isNarrowViewport(viewportWidthPx: number, breakpointPx: number = MOBILE_BREAKPOINT_PX): boolean {
  return viewportWidthPx < breakpointPx;
}

/** True when either dimension is small enough to warrant the mobile chrome — narrow width OR short height. */
export function isCompactViewport(
  viewportWidthPx: number,
  viewportHeightPx: number,
  breakpointPx: number = MOBILE_BREAKPOINT_PX,
  shortEdgePx: number = MOBILE_SHORT_EDGE_PX,
): boolean {
  return isNarrowViewport(viewportWidthPx, breakpointPx) || viewportHeightPx < shortEdgePx;
}

export function useIsNarrowViewport(breakpointPx: number = MOBILE_BREAKPOINT_PX, shortEdgePx: number = MOBILE_SHORT_EDGE_PX): boolean {
  const [narrow, setNarrow] = useState(() => (typeof window === "undefined" ? false : isCompactViewport(window.innerWidth, window.innerHeight, breakpointPx, shortEdgePx)));

  useEffect(() => {
    // A comma-separated media query is a logical OR — matches when the viewport is narrow OR short.
    const query = window.matchMedia(`(max-width: ${breakpointPx - 1}px), (max-height: ${shortEdgePx - 1}px)`);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [breakpointPx, shortEdgePx]);

  return narrow;
}

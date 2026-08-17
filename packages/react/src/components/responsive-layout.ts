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

/**
 * The chrome's three effective layout tiers. `phone` is the compact bottom-toolbar chrome (narrow OR
 * short — unchanged). `tablet` is the desktop layout with touch-sized (≥44px effective) targets: wide
 * enough for desktop chrome but driven by a coarse primary pointer (an iPad in landscape). `desktop`
 * is the fine-pointer layout, unchanged. An iPad with an attached trackpad reports a fine pointer and
 * gets desktop density — acceptable, the pointer is precise.
 */
export type LayoutTier = "phone" | "tablet" | "desktop";

export function resolveLayoutTier(
  viewportWidthPx: number,
  viewportHeightPx: number,
  isCoarsePointer: boolean,
  breakpointPx: number = MOBILE_BREAKPOINT_PX,
  shortEdgePx: number = MOBILE_SHORT_EDGE_PX,
): LayoutTier {
  return resolveLayoutTierFromFlags(isCompactViewport(viewportWidthPx, viewportHeightPx, breakpointPx, shortEdgePx), isCoarsePointer);
}

/** The tier decision itself, on the two already-resolved flags — what `useLayoutTier` runs live (its flags come from matchMedia, not raw dimensions). */
export function resolveLayoutTierFromFlags(isCompact: boolean, isCoarsePointer: boolean): LayoutTier {
  if (isCompact) return "phone";
  return isCoarsePointer ? "tablet" : "desktop";
}

/** Live layout tier for the shell: compact viewport → phone; else coarse pointer → tablet; else desktop. Recomputes on matchMedia changes (viewport resize, mouse attach/detach). */
export function useLayoutTier(): LayoutTier {
  return resolveLayoutTierFromFlags(useIsNarrowViewport(), useIsCoarsePointer());
}

/** Live `(pointer: coarse)` — flips when e.g. a mouse is attached/detached. Thin matchMedia wiring (untested, like `useIsNarrowViewport`); SSR-safe. */
export function useIsCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => (typeof window === "undefined" ? false : !!window.matchMedia?.("(pointer: coarse)").matches));

  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return coarse;
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

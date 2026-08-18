/**
 * The one place transient, canvas-wide messages appear: top-centre, below the toolbar.
 *
 * Each banner used to position itself, which worked only for as long as there was one of them. Two
 * independently-absolute banners in the same band overlap the moment both are true at once — storage
 * filling up during a long session is exactly when that session is also likely to end — and the
 * result is unreadable rather than merely untidy. Stacking them here means any number can be on
 * screen at once, in a fixed order, with no component knowing about the others.
 *
 * `pointerEvents` is off on the column and back on for each child, so the empty space either side of
 * a short banner never eats a click meant for the canvas underneath.
 */
import type { ReactNode } from "react";
import { Z_LAYER } from "./chrome-styles";

export function TopBannerStack(props: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 120,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        zIndex: Z_LAYER.dialog,
        pointerEvents: "none",
        maxWidth: "min(560px, calc(100vw - 32px))",
      }}
    >
      {props.children}
    </div>
  );
}

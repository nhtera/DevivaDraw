/**
 * Desktop dock for the style controls: the `PropertiesPanelBody` in a fixed top-left floating card,
 * tucked under the top bar on the same edge.
 * Always visible (not gated on a selection) unless there's nothing to style — with nothing selected it
 * edits `ShapeStyleState`'s "next shape" defaults; with a selection the same handlers go through
 * `applyToSelection`. The narrow-viewport variant lives in `mobile/mobile-properties-bar.tsx`, which
 * wraps the same body in a bottom sheet; both share the visibility rule (`isPropertiesPanelHidden`).
 */
import { useEffect, useReducer } from "react";
import { panelStyle } from "./chrome-styles";
import { PropertiesPanelBody, isPropertiesPanelHidden, isTextOnlyPanel } from "./properties-panel-body";
import { TOP_BAR_BOTTOM } from "./top-bar";
import { useSceneVersion, useSelectionVersion, useToolVersion } from "../runtime/use-live-version";
import type { DevivaRuntime } from "../runtime/runtime-types";

/** Gap between the panel and the viewport edges, on all sides — also the basis for its height cap. */
const PANEL_INSET = 12;

export interface PropertiesPanelProps {
  runtime: DevivaRuntime;
}

export function PropertiesPanel(props: PropertiesPanelProps) {
  const { runtime } = props;
  useSceneVersion(runtime.scene);
  useSelectionVersion(runtime.selection);
  useToolVersion(runtime.toolStateMachine);
  const [, forceRender] = useReducer((count: number) => count + 1, 0);
  // Re-render when a text-edit session opens/closes (re-editing an existing element mutates no scene
  // state on open, so `useSceneVersion` alone wouldn't switch the panel into text mode).
  useEffect(() => runtime.editSession.subscribe(forceRender), [runtime.editSession]);

  if (isPropertiesPanelHidden(runtime)) return null;

  const testId = isTextOnlyPanel(runtime) ? "properties-panel-text" : "properties-panel";
  return (
    <div
      style={{
        ...panelStyle,
        position: "absolute",
        // Under the top bar, sharing its edge: the style controls are what a drawing tool reaches for
        // most, and the left edge is where the eye already goes for them. It also leaves the whole
        // right edge to the library sidebar, which used to have to push this panel out of its way.
        top: TOP_BAR_BOTTOM + PANEL_INSET,
        left: PANEL_INSET,
        width: 220,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        // The panel grows with the selection (an arrow adds arrowhead rows, a mixed selection adds text
        // rows on top of shape rows) and is anchored to the top, so on a short-but-not-mobile viewport it
        // used to run off the bottom of the screen with its lower controls — align, distribute, lock —
        // unreachable. Cap it and scroll instead. Nothing else is anchored to this edge below it, so the
        // cap is simply everything left under the top bar.
        maxHeight: `calc(100dvh - ${TOP_BAR_BOTTOM + PANEL_INSET * 2}px)`,
        // Without this the cap applies to the *content* box, so the panel still renders `padding * 2 +
        // border` taller than its own max-height and overflows the space reserved above.
        boxSizing: "border-box",
        overflowY: "auto",
        overscrollBehavior: "contain",
      }}
      data-testid={testId}
    >
      <PropertiesPanelBody runtime={runtime} />
    </div>
  );
}

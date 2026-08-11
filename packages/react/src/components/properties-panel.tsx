/**
 * Desktop dock for the style controls: the `PropertiesPanelBody` in a fixed top-right floating card.
 * Always visible (not gated on a selection) unless there's nothing to style — with nothing selected it
 * edits `ShapeStyleState`'s "next shape" defaults; with a selection the same handlers go through
 * `applyToSelection`. The narrow-viewport variant lives in `mobile/mobile-properties-bar.tsx`, which
 * wraps the same body in a bottom sheet; both share the visibility rule (`isPropertiesPanelHidden`).
 */
import { useEffect, useReducer } from "react";
import { panelStyle } from "./chrome-styles";
import { PropertiesPanelBody, isPropertiesPanelHidden, isTextOnlyPanel } from "./properties-panel-body";
import { useSceneVersion, useSelectionVersion, useToolVersion } from "../runtime/use-live-version";
import type { DevivaRuntime } from "../runtime/runtime-types";

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
    <div style={{ ...panelStyle, position: "absolute", top: 12, right: 12, width: 220, padding: 12, display: "flex", flexDirection: "column", gap: 10 }} data-testid={testId}>
      <PropertiesPanelBody runtime={runtime} />
    </div>
  );
}

/**
 * The full style system surfaced as UI: color pickers (palette + custom hex + recently-
 * used), fill style, stroke width/style, roughness, edges, opacity — plus per-type extras
 * (`type-style-sections.tsx`) and layer actions (`layer-actions-section.tsx`). Always visible (not
 * gated on a selection): with nothing selected it edits `ShapeStyleState`'s "next shape" defaults;
 * with a selection, the exact same handlers go through `applyToSelection` (see
 * `tools/shape-style-state.ts`'s doc — it already does both, one call).
 */
import { DEFAULT_BACKGROUND_COLOR_PALETTE, DEFAULT_STROKE_COLOR_PALETTE, ROUNDNESS_LEVELS, SLOPPINESS_LEVELS, STROKE_WIDTH_LEVELS } from "@deviva-draw/engine";
import type { AnyElement, FillStyle, RoundnessValue, ShapeStyle, StrokeStyle, TextElement } from "@deviva-draw/engine";
import { useEffect, useReducer } from "react";
import { ColorPicker } from "./color-picker";
import { LayerActionsSection } from "./layer-actions-section";
import { LinkSection } from "./link-section";
import { panelStyle, labelStyle } from "./chrome-styles";
import { StyleSection } from "./style-section";
import { ArrowStyleSection, TextPropertiesPanel, TextStyleSection } from "./type-style-sections";
import { useTranslation } from "../i18n/use-translation";
import { useSceneVersion, useSelectionVersion, useToolVersion } from "../runtime/use-live-version";
import { ERASER_TOOL_NAME, FRAME_TOOL_NAME, LASER_TOOL_NAME, LASSO_TOOL_NAME, PAN_TOOL_NAME, SELECT_TOOL_NAME } from "../runtime/tool-names";
import type { DevivaRuntime } from "../runtime/runtime-types";

const FILL_STYLE_OPTIONS: FillStyle[] = ["hachure", "cross-hatch", "solid", "zigzag"];
const STROKE_STYLE_OPTIONS: StrokeStyle[] = ["solid", "dashed", "dotted"];

function roundnessKey(value: RoundnessValue | null): "sharp" | "round" {
  return value === null ? "sharp" : "round";
}

/** The text elements the panel should write style through: the live edit-session element (if a text is being edited — it isn't part of the selection) plus any selected text elements, deduped by id. */
function textStyleTargets(runtime: DevivaRuntime): TextElement[] {
  const targets: TextElement[] = [];
  const editing = runtime.editSession.getState();
  if (editing.status === "editing") {
    const element = runtime.scene.getElement(editing.elementId);
    if (element && element.type === "text" && !element.isDeleted) targets.push(element);
  }
  for (const id of runtime.selection.getSelectedIds()) {
    const element = runtime.scene.getElement(id);
    if (element && element.type === "text" && !element.isDeleted && !targets.some((t) => t.id === element.id)) targets.push(element);
  }
  return targets;
}

/** Selected non-text elements — their presence means a *mixed* selection, which keeps the full shape panel rather than the text-only one. */
function hasNonTextSelected(runtime: DevivaRuntime): boolean {
  for (const id of runtime.selection.getSelectedIds()) {
    const element = runtime.scene.getElement(id);
    if (element && !element.isDeleted && (element as AnyElement).type !== "text") return true;
  }
  return false;
}

function currentDisplayStyle(runtime: DevivaRuntime): ShapeStyle {
  const selected = [...runtime.selection.getSelectedIds()]
    .map((id) => runtime.scene.getElement(id))
    .filter((element): element is NonNullable<typeof element> => !!element && !element.isDeleted);
  const first = selected[0];
  if (!first) return runtime.styleState.getStyle();
  return {
    strokeColor: first.strokeColor,
    backgroundColor: first.backgroundColor,
    fillStyle: first.fillStyle,
    strokeWidth: first.strokeWidth,
    strokeStyle: first.strokeStyle,
    roughness: first.roughness,
    opacity: first.opacity,
    roundness: first.roundness,
  };
}

export interface PropertiesPanelProps {
  runtime: DevivaRuntime;
}

export function PropertiesPanel(props: PropertiesPanelProps) {
  const { runtime } = props;
  const { t } = useTranslation();
  useSceneVersion(runtime.scene);
  useSelectionVersion(runtime.selection);
  useToolVersion(runtime.toolStateMachine);
  const [, forceRender] = useReducer((count: number) => count + 1, 0);
  // Re-render when a text-edit session opens/closes (re-editing an existing element mutates no scene
  // state on open, so `useSceneVersion` alone wouldn't switch the panel into text mode).
  useEffect(() => runtime.editSession.subscribe(forceRender), [runtime.editSession]);

  // Clean idle canvas, like Excalidraw/tldraw: with a non-creating tool (select/pan/eraser) active,
  // nothing selected, and no text being edited, there is nothing to style — hide the panel entirely
  // rather than showing "next shape" defaults nobody asked for. A creation tool (shape/line/arrow/
  // freehand/text) keeps the panel visible so its defaults can be set before drawing.
  const activeTool = runtime.toolStateMachine.getActiveToolName();
  // Non-creating tools (select/pan/eraser/laser/lasso/frame) have nothing to pre-style, so the panel
  // hides for them. The frame's look is fixed chrome; the lasso only selects. The highlighter is a
  // creation tool (its stroke color/width/opacity are set here), so it deliberately keeps the panel.
  const isIdleTool =
    activeTool === SELECT_TOOL_NAME ||
    activeTool === PAN_TOOL_NAME ||
    activeTool === ERASER_TOOL_NAME ||
    activeTool === LASER_TOOL_NAME ||
    activeTool === LASSO_TOOL_NAME ||
    activeTool === FRAME_TOOL_NAME;
  const isEditingText = runtime.editSession.getState().status === "editing";
  if (isIdleTool && runtime.selection.size === 0 && !isEditingText) return null;

  const style = currentDisplayStyle(runtime);
  const apply = (partial: Partial<ShapeStyle>) => {
    // `ShapeStyleState.applyToSelection` writes directly through `Scene.updateElement` with no
    // history integration of its own (by design — it's a style-only concern, see that method's
    // doc) — batching it here is what makes a style-picker edit undoable, the same "one batch per
    // discrete user action" rule every other multi-element mutation in this codebase follows
    // (`type-style-sections.tsx`'s `updateBatched`, every `actions/*.ts` file).
    const hasSelection = runtime.selection.size > 0;
    if (hasSelection) runtime.history.beginBatch();
    runtime.styleState.applyToSelection(partial);
    if (hasSelection) runtime.history.endBatch(runtime.scene.getElements());
    forceRender();
  };

  // While editing a text, or when the selection is text-only, show a focused text panel (color, font
  // family, size, align, opacity) — matching Excalidraw/tldraw — instead of the shape controls
  // (fill/stroke-width/sloppiness/edges) that don't apply to text. A mixed selection keeps the full
  // shape panel (which already appends `TextStyleSection` for whatever text it contains).
  const textTargets = textStyleTargets(runtime);
  if (textTargets.length > 0 && !hasNonTextSelected(runtime)) {
    return (
      <div style={{ ...panelStyle, position: "absolute", top: 12, right: 12, width: 220, padding: 12, display: "flex", flexDirection: "column", gap: 10 }} data-testid="properties-panel-text">
        <TextPropertiesPanel runtime={runtime} targets={textTargets} />
        {runtime.selection.size > 0 && (
          <>
            <div style={{ height: 1, background: "var(--dd-chrome-border)" }} />
            <LinkSection runtime={runtime} />
            <span style={labelStyle}>{t("panel.layers")}</span>
            <LayerActionsSection runtime={runtime} />
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ ...panelStyle, position: "absolute", top: 12, right: 12, width: 220, padding: 12, display: "flex", flexDirection: "column", gap: 10 }} data-testid="properties-panel">
      <ColorPicker
        label={t("panel.stroke")}
        testId="stroke-color"
        value={style.strokeColor}
        palette={DEFAULT_STROKE_COLOR_PALETTE}
        recentColors={runtime.styleState.getRecentColors()}
        customColorLabel={t("panel.customColor")}
        onChange={(color) => apply({ strokeColor: color })}
      />
      <ColorPicker
        label={t("panel.background")}
        testId="background-color"
        value={style.backgroundColor}
        palette={DEFAULT_BACKGROUND_COLOR_PALETTE}
        recentColors={runtime.styleState.getRecentColors()}
        customColorLabel={t("panel.customColor")}
        onChange={(color) => apply({ backgroundColor: color })}
      />
      <StyleSection label={t("panel.fill")} value={style.fillStyle} options={FILL_STYLE_OPTIONS.map((v) => ({ value: v, label: t(`styleValue.${v}`), icon: `fill-${v}` }))} onChange={(v) => apply({ fillStyle: v })} />
      <StyleSection
        label={t("panel.strokeWidth")}
        testIdPrefix="stroke-width"
        value={style.strokeWidth === STROKE_WIDTH_LEVELS.thin ? "thin" : style.strokeWidth === STROKE_WIDTH_LEVELS.bold ? "bold" : "extra-bold"}
        options={Object.keys(STROKE_WIDTH_LEVELS).map((key) => ({ value: key, label: t(`styleValue.${key as "thin" | "bold" | "extra-bold"}`), icon: `stroke-width-${key}` }))}
        onChange={(key) => apply({ strokeWidth: STROKE_WIDTH_LEVELS[key as keyof typeof STROKE_WIDTH_LEVELS] })}
      />
      <StyleSection
        label={t("panel.strokeStyle")}
        value={style.strokeStyle}
        options={STROKE_STYLE_OPTIONS.map((v) => ({ value: v, label: t(`styleValue.${v}`), icon: `stroke-style-${v}` }))}
        onChange={(v) => apply({ strokeStyle: v })}
      />
      <StyleSection
        label={t("panel.roughness")}
        value={Object.entries(SLOPPINESS_LEVELS).find(([, value]) => value === style.roughness)?.[0] ?? "artist"}
        options={Object.keys(SLOPPINESS_LEVELS).map((key) => ({ value: key, label: t(`styleValue.${key as "architect" | "artist" | "cartoonist"}`), icon: `sloppiness-${key}` }))}
        onChange={(key) => apply({ roughness: SLOPPINESS_LEVELS[key as keyof typeof SLOPPINESS_LEVELS] })}
      />
      <StyleSection
        label={t("panel.edges")}
        value={roundnessKey(style.roundness)}
        options={["sharp", "round"].map((key) => ({ value: key, label: t(`styleValue.${key as "sharp" | "round"}`), icon: `edge-${key}` }))}
        onChange={(key) => apply({ roundness: ROUNDNESS_LEVELS[key as "sharp" | "round"] })}
      />
      <div>
        <span style={labelStyle}>
          {t("panel.opacity")}: {style.opacity}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={style.opacity}
          onChange={(event) => apply({ opacity: Number(event.target.value) })}
          style={{ width: "100%" }}
        />
      </div>
      <TextStyleSection runtime={runtime} />
      <ArrowStyleSection runtime={runtime} />
      {runtime.selection.size > 0 && (
        <>
          <div style={{ height: 1, background: "var(--dd-chrome-border)" }} />
          <LinkSection runtime={runtime} />
          <span style={labelStyle}>{t("panel.layers")}</span>
          <LayerActionsSection runtime={runtime} />
        </>
      )}
    </div>
  );
}

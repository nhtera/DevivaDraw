/**
 * The style controls themselves, decoupled from where they're docked: color pickers (stroke +
 * background), fill/stroke-width/stroke-style/roughness/edges, opacity, per-type extras
 * (`type-style-sections.tsx`) and layer actions. `properties-panel.tsx` wraps this in the desktop
 * top-right floating card; `mobile/mobile-properties-bar.tsx` wraps the same body in a bottom sheet —
 * one source of truth for the controls, two containers.
 *
 * The visibility rule and the "which style is showing" derivation live here too (`isPropertiesPanelHidden`,
 * `isTextOnlyPanel`, `currentDisplayStyle`) so both containers gate/label identically. This body renders
 * only the control content (no positioning, no testid'd container) and never returns null — the caller
 * checks `isPropertiesPanelHidden` and supplies the container.
 */
import { DEFAULT_BACKGROUND_COLOR_PALETTE, DEFAULT_STROKE_COLOR_PALETTE, ROUNDNESS_LEVELS, SLOPPINESS_LEVELS, STROKE_WIDTH_LEVELS } from "@deviva-draw/engine";
import type { AnyElement, FillStyle, RoundnessValue, ShapeStyle, StrokeStyle, TextElement } from "@deviva-draw/engine";
import { useReducer } from "react";
import { ColorPicker } from "./color-picker";
import { FrameNotesSection } from "./frame-notes-section";
import { Icon } from "./icon";
import { LayerActionsSection } from "./layer-actions-section";
import { LinkSection } from "./link-section";
import { buttonStyle, labelStyle } from "./chrome-styles";
import { OpacityRow, StyleSection } from "./style-section";
import { ArrowStyleSection, TextPropertiesPanel, TextStyleSection } from "./type-style-sections";
import { TableStyleSection } from "./table-style-section";
import { useTranslation } from "../i18n/use-translation";
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

/** True when the sole selected element is a freehand stroke (for the "Draw to shape" affordance). */
function singleFreedrawSelected(runtime: DevivaRuntime): boolean {
  const ids = [...runtime.selection.getSelectedIds()];
  if (ids.length !== 1) return false;
  const element = runtime.scene.getElement(ids[0]!);
  return !!element && !element.isDeleted && element.type === "freedraw";
}

/** Selected non-text elements — their presence means a *mixed* selection, which keeps the full shape panel rather than the text-only one. */
function hasNonTextSelected(runtime: DevivaRuntime): boolean {
  for (const id of runtime.selection.getSelectedIds()) {
    const element = runtime.scene.getElement(id);
    if (element && !element.isDeleted && (element as AnyElement).type !== "text") return true;
  }
  return false;
}

/** The style the panel should display: the first selected element's, or the "next shape" defaults with nothing selected. */
export function currentDisplayStyle(runtime: DevivaRuntime): ShapeStyle {
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

/**
 * Whether the panel has nothing to style: a non-creating tool (select/pan/eraser/laser/lasso/frame)
 * is active, nothing is selected, and no text is being edited. A creation tool keeps it visible so its
 * "next shape" defaults can be set before drawing (matching Excalidraw/tldraw's idle-canvas behavior).
 */
export function isPropertiesPanelHidden(runtime: DevivaRuntime): boolean {
  const activeTool = runtime.toolStateMachine.getActiveToolName();
  const isIdleTool =
    activeTool === SELECT_TOOL_NAME ||
    activeTool === PAN_TOOL_NAME ||
    activeTool === ERASER_TOOL_NAME ||
    activeTool === LASER_TOOL_NAME ||
    activeTool === LASSO_TOOL_NAME ||
    activeTool === FRAME_TOOL_NAME;
  const isEditingText = runtime.editSession.getState().status === "editing";
  return isIdleTool && runtime.selection.size === 0 && !isEditingText;
}

/** True when the focused text-only panel should render (editing text, or a text-only selection) rather than the full shape panel. */
export function isTextOnlyPanel(runtime: DevivaRuntime): boolean {
  return textStyleTargets(runtime).length > 0 && !hasNonTextSelected(runtime);
}

export interface PropertiesPanelBodyProps {
  runtime: DevivaRuntime;
  /** Called after any style edit — lets a container (e.g. the mobile bar) refresh its own swatches when a no-selection default changes without mutating the scene. */
  onAfterApply?(): void;
}

/** The style controls, container-agnostic. Assumes `!isPropertiesPanelHidden(runtime)` — the caller gates. */
export function PropertiesPanelBody(props: PropertiesPanelBodyProps) {
  const { runtime, onAfterApply } = props;
  const { t } = useTranslation();
  const [, forceRender] = useReducer((count: number) => count + 1, 0);

  const apply = (partial: Partial<ShapeStyle>) => {
    // `applyToSelection` writes through `Scene.updateElement` with no history of its own (style-only
    // concern) — batching here is what makes a style edit undoable, one batch per user action.
    const hasSelection = runtime.selection.size > 0;
    if (hasSelection) runtime.history.beginBatch();
    runtime.styleState.applyToSelection(partial);
    if (hasSelection) runtime.history.endBatch(runtime.scene.getElements());
    forceRender();
    onAfterApply?.();
  };

  const style = currentDisplayStyle(runtime);

  // Editing a text, or a text-only selection → focused text panel (color, font, size, align, opacity)
  // instead of the shape controls that don't apply to text. A mixed selection keeps the full panel.
  if (isTextOnlyPanel(runtime)) {
    return (
      <>
        <TextPropertiesPanel runtime={runtime} targets={textStyleTargets(runtime)} />
        {runtime.selection.size > 0 && (
          <>
            <div style={{ height: 1, background: "var(--dd-chrome-border)" }} />
            <LinkSection runtime={runtime} />
            <span style={labelStyle}>{t("panel.layers")}</span>
            <LayerActionsSection runtime={runtime} />
          </>
        )}
      </>
    );
  }

  return (
    <>
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
      <OpacityRow label={t("panel.opacity")} value={style.opacity} onChange={(opacity) => apply({ opacity })} />
      <TextStyleSection runtime={runtime} />
      <TableStyleSection runtime={runtime} />
      <ArrowStyleSection runtime={runtime} />
      <FrameNotesSection runtime={runtime} />
      {runtime.selection.size > 0 && (
        <>
          <div style={{ height: 1, background: "var(--dd-chrome-border)" }} />
          {singleFreedrawSelected(runtime) && (
            <button type="button" data-testid="draw-to-shape" style={{ ...buttonStyle(false), justifyContent: "flex-start", width: "100%" }} onClick={() => runtime.actionRegistry.run("draw-to-shape", runtime)}>
              <Icon name="shapes" />
              {t("action.drawToShape")}
            </button>
          )}
          <LinkSection runtime={runtime} />
          <span style={labelStyle}>{t("panel.layers")}</span>
          <LayerActionsSection runtime={runtime} />
        </>
      )}
    </>
  );
}

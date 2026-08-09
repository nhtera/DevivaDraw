/**
 * The full style system surfaced as UI: color pickers (palette + custom hex + recently-
 * used), fill style, stroke width/style, roughness, edges, opacity — plus per-type extras
 * (`type-style-sections.tsx`) and layer actions (`layer-actions-section.tsx`). Always visible (not
 * gated on a selection): with nothing selected it edits `ShapeStyleState`'s "next shape" defaults;
 * with a selection, the exact same handlers go through `applyToSelection` (see
 * `tools/shape-style-state.ts`'s doc — it already does both, one call).
 */
import { DEFAULT_BACKGROUND_COLOR_PALETTE, DEFAULT_STROKE_COLOR_PALETTE, ROUNDNESS_LEVELS, SLOPPINESS_LEVELS, STROKE_WIDTH_LEVELS } from "@deviva-draw/engine";
import type { FillStyle, RoundnessValue, ShapeStyle, StrokeStyle } from "@deviva-draw/engine";
import { useReducer } from "react";
import { ColorPicker } from "./color-picker";
import { LayerActionsSection } from "./layer-actions-section";
import { panelStyle, labelStyle } from "./chrome-styles";
import { StyleSection } from "./style-section";
import { ArrowStyleSection, TextStyleSection } from "./type-style-sections";
import { useTranslation } from "../i18n/use-translation";
import { useSceneVersion, useSelectionVersion } from "../runtime/use-live-version";
import type { DevivaRuntime } from "../runtime/runtime-types";

const FILL_STYLE_OPTIONS: FillStyle[] = ["hachure", "cross-hatch", "solid", "zigzag"];
const STROKE_STYLE_OPTIONS: StrokeStyle[] = ["solid", "dashed", "dotted"];

function roundnessKey(value: RoundnessValue | null): "sharp" | "round" {
  return value === null ? "sharp" : "round";
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
  const [, forceRender] = useReducer((count: number) => count + 1, 0);

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

  return (
    <div style={{ ...panelStyle, position: "absolute", top: 12, right: 12, width: 220, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <ColorPicker
        label={t("panel.stroke")}
        value={style.strokeColor}
        palette={DEFAULT_STROKE_COLOR_PALETTE}
        recentColors={runtime.styleState.getRecentColors()}
        customColorLabel={t("panel.customColor")}
        onChange={(color) => apply({ strokeColor: color })}
      />
      <ColorPicker
        label={t("panel.background")}
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
          <span style={labelStyle}>{t("panel.layers")}</span>
          <LayerActionsSection runtime={runtime} />
        </>
      )}
    </div>
  );
}

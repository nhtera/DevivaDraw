/**
 * Per-element-type style extras: font size/family/text-align for text elements, arrowheads for
 * arrows — fields that live directly on the element (not part of `ShapeStyleState`'s shared "next
 * shape" style set), so these write via `Scene.updateElement` for every matching selected element in
 * one batched history step instead of through `styleState.applyToSelection`.
 */
import { DEFAULT_STROKE_COLOR_PALETTE, FONT_SIZE_LEVELS } from "@deviva-draw/engine";
import type { AnyElement, ArrowElement, Arrowhead, TextAlign, TextElement, TextFontFamily } from "@deviva-draw/engine";
import { ColorPicker } from "./color-picker";
import { buttonStyle, labelStyle } from "./chrome-styles";
import { StyleSection } from "./style-section";
import { useTranslation } from "../i18n/use-translation";
import type { DevivaRuntime } from "../runtime/runtime-types";

function selectedElementsOfType<T extends AnyElement["type"]>(runtime: DevivaRuntime, type: T): Extract<AnyElement, { type: T }>[] {
  return [...runtime.selection.getSelectedIds()]
    .map((id) => runtime.scene.getElement(id))
    .filter((element): element is Extract<AnyElement, { type: T }> => !!element && !element.isDeleted && element.type === type);
}

function updateBatched(runtime: DevivaRuntime, elements: AnyElement[], changes: Partial<AnyElement>): void {
  if (elements.length === 0) return;
  runtime.history.beginBatch();
  for (const element of elements) runtime.scene.updateElement(element.id, changes);
  runtime.history.endBatch(runtime.scene.getElements());
}

const FONT_FAMILY_OPTIONS: TextFontFamily[] = ["normal", "code", "hand-drawn-slot"];
const TEXT_ALIGN_OPTIONS: TextAlign[] = ["left", "center", "right"];
const ARROWHEAD_OPTIONS: Arrowhead[] = ["none", "arrow", "triangle", "bar", "dot"];
/** Text-align values reuse the existing chrome align glyphs; arrowheads use the self-authored SVG set (`icon-style-glyphs.tsx`). */
const TEXT_ALIGN_ICONS: Record<TextAlign, string> = { left: "align-left", center: "align-center-h", right: "align-right" };

export function TextStyleSection(props: { runtime: DevivaRuntime }) {
  const { runtime } = props;
  const { t } = useTranslation();
  const textElements = selectedElementsOfType<"text">(runtime, "text");
  if (textElements.length === 0) return null;
  const first = textElements[0] as TextElement;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <StyleSection
        label={t("panel.fontFamily")}
        value={first.fontFamily}
        options={FONT_FAMILY_OPTIONS.map((value) => ({ value, label: t(`fontFamily.${value}`) }))}
        onChange={(value) => updateBatched(runtime, textElements, { fontFamily: value })}
      />
      <StyleSection
        label={t("panel.fontSize")}
        value={String(first.fontSize)}
        options={Object.entries(FONT_SIZE_LEVELS).map(([label, value]) => ({ value: String(value), label }))}
        onChange={(value) => updateBatched(runtime, textElements, { fontSize: Number(value) })}
      />
      <StyleSection
        label={t("panel.textAlign")}
        value={first.textAlign}
        options={TEXT_ALIGN_OPTIONS.map((value) => ({ value, label: t(`textAlign.${value}`), icon: TEXT_ALIGN_ICONS[value] }))}
        onChange={(value) => updateBatched(runtime, textElements, { textAlign: value })}
      />
    </div>
  );
}

/**
 * The focused text property panel shown while a text element is being edited or is the whole
 * selection — only the controls that apply to text (color, font family, size, align, opacity), matching
 * Excalidraw/tldraw, instead of the shape panel's fill/stroke-width/sloppiness/edges. `targets` is the
 * element(s) to write through: the live edit-session element (even though it isn't "selected") and/or
 * the selected text elements, so restyling works the same whether editing or just selected. Every field
 * lives directly on the element, so all of them go through `updateBatched`.
 */
export function TextPropertiesPanel(props: { runtime: DevivaRuntime; targets: TextElement[] }) {
  const { runtime, targets } = props;
  const { t } = useTranslation();
  const first = targets[0];
  if (!first) return null;
  const set = (changes: Partial<TextElement>) => updateBatched(runtime, targets, changes);

  return (
    <>
      <ColorPicker
        label={t("panel.stroke")}
        testId="stroke-color"
        value={first.strokeColor}
        palette={DEFAULT_STROKE_COLOR_PALETTE}
        recentColors={runtime.styleState.getRecentColors()}
        customColorLabel={t("panel.customColor")}
        onChange={(color) => set({ strokeColor: color })}
      />
      <StyleSection
        label={t("panel.fontFamily")}
        value={first.fontFamily}
        options={FONT_FAMILY_OPTIONS.map((value) => ({ value, label: t(`fontFamily.${value}`) }))}
        onChange={(value) => set({ fontFamily: value as TextFontFamily })}
      />
      <StyleSection
        label={t("panel.fontSize")}
        value={String(first.fontSize)}
        options={Object.entries(FONT_SIZE_LEVELS).map(([label, value]) => ({ value: String(value), label }))}
        onChange={(value) => set({ fontSize: Number(value) })}
      />
      <StyleSection
        label={t("panel.textAlign")}
        value={first.textAlign}
        options={TEXT_ALIGN_OPTIONS.map((value) => ({ value, label: t(`textAlign.${value}`), icon: TEXT_ALIGN_ICONS[value] }))}
        onChange={(value) => set({ textAlign: value as TextAlign })}
      />
      <div>
        <span style={labelStyle}>{t("panel.textStyle")}</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            data-testid="text-bold"
            aria-pressed={first.fontWeight === "bold"}
            aria-label={t("panel.bold")}
            title={t("panel.bold")}
            style={{ ...buttonStyle(first.fontWeight === "bold"), flex: 1, justifyContent: "center", fontWeight: "bold" }}
            onClick={() => set({ fontWeight: first.fontWeight === "bold" ? "normal" : "bold" })}
          >
            B
          </button>
          <button
            type="button"
            data-testid="text-italic"
            aria-pressed={first.fontStyle === "italic"}
            aria-label={t("panel.italic")}
            title={t("panel.italic")}
            style={{ ...buttonStyle(first.fontStyle === "italic"), flex: 1, justifyContent: "center", fontStyle: "italic" }}
            onClick={() => set({ fontStyle: first.fontStyle === "italic" ? "normal" : "italic" })}
          >
            I
          </button>
        </div>
      </div>
      <div>
        <span style={labelStyle}>
          {t("panel.opacity")}: {first.opacity}
        </span>
        <input type="range" min={0} max={100} value={first.opacity} onChange={(event) => set({ opacity: Number(event.target.value) })} style={{ width: "100%" }} />
      </div>
    </>
  );
}

export function ArrowStyleSection(props: { runtime: DevivaRuntime }) {
  const { runtime } = props;
  const { t } = useTranslation();
  const arrows = selectedElementsOfType<"arrow">(runtime, "arrow");
  if (arrows.length === 0) return null;
  const first = arrows[0] as ArrowElement;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <StyleSection
        label={t("panel.arrowheadStart")}
        value={first.startArrowhead}
        options={ARROWHEAD_OPTIONS.map((value) => ({ value, label: t(`arrowhead.${value}`), icon: `arrowhead-${value}` }))}
        onChange={(value) => updateBatched(runtime, arrows, { startArrowhead: value })}
      />
      <StyleSection
        label={t("panel.arrowheadEnd")}
        value={first.endArrowhead}
        options={ARROWHEAD_OPTIONS.map((value) => ({ value, label: t(`arrowhead.${value}`), icon: `arrowhead-${value}` }))}
        onChange={(value) => updateBatched(runtime, arrows, { endArrowhead: value })}
      />
    </div>
  );
}


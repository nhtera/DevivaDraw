/**
 * Per-element-type style extras: font size/family/text-align for text elements, arrowheads for
 * arrows — fields that live directly on the element (not part of `ShapeStyleState`'s shared "next
 * shape" style set), so these write via `Scene.updateElement` for every matching selected element in
 * one batched history step instead of through `styleState.applyToSelection`.
 */
import { DEFAULT_STROKE_COLOR_PALETTE, FONT_SIZE_LEVELS, findBoundTextRef } from "@deviva-draw/engine";
import type { AnyElement, ArrowElement, Arrowhead, ArrowType, TextAlign, TextElement, TextFontFamily } from "@deviva-draw/engine";
import { ColorPicker } from "./color-picker";
import { buttonStyle, labelStyle } from "./chrome-styles";
import { OpacityRow, StyleSection } from "./style-section";
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
const ARROW_TYPE_OPTIONS: ArrowType[] = ["straight", "curved", "elbow"];
/** Text-align values reuse the existing chrome align glyphs; arrowheads use the self-authored SVG set (`icon-style-glyphs.tsx`). */
const TEXT_ALIGN_ICONS: Record<TextAlign, string> = { left: "align-left", center: "align-center-h", right: "align-right" };

/**
 * Every text element the font controls should write through: text elements in the selection, plus the
 * bound label of any selected shape or arrow that has one. A labelled shape is the common case — the
 * label is what the user sees and wants bigger — and without this the only route to its font size is
 * double-clicking into the label and back out, which is a detour past controls that were already on
 * screen. Both other whiteboards surface font size for a labelled shape for the same reason.
 */
function selectedTextTargets(runtime: DevivaRuntime): TextElement[] {
  const targets: TextElement[] = [];
  const push = (element: AnyElement | undefined) => {
    if (!element || element.isDeleted || element.type !== "text") return;
    if (!targets.some((existing) => existing.id === element.id)) targets.push(element);
  };
  for (const id of runtime.selection.getSelectedIds()) {
    const element = runtime.scene.getElement(id);
    if (!element || element.isDeleted) continue;
    push(element);
    const labelRef = findBoundTextRef(element);
    if (labelRef) push(runtime.scene.getElement(labelRef.id));
  }
  return targets;
}

export function TextStyleSection(props: { runtime: DevivaRuntime }) {
  const { runtime } = props;
  const { t } = useTranslation();
  const textElements = selectedTextTargets(runtime);
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
        testIdPrefix="font-size"
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
        testIdPrefix="font-size"
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
      <OpacityRow label={t("panel.opacity")} value={first.opacity} onChange={(opacity) => set({ opacity })} />
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
        label={t("panel.arrowType")}
        testIdPrefix="style-arrowType"
        value={first.arrowType}
        options={ARROW_TYPE_OPTIONS.map((value) => ({ value, label: t(`arrowType.${value}`), icon: `arrow-type-${value}` }))}
        onChange={(value) => updateBatched(runtime, arrows, { arrowType: value })}
      />
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


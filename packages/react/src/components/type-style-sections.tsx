/**
 * Per-element-type style extras: font size/family/text-align for text elements, arrowheads for
 * arrows — fields that live directly on the element (not part of `ShapeStyleState`'s shared "next
 * shape" style set), so these write via `Scene.updateElement` for every matching selected element in
 * one batched history step instead of through `styleState.applyToSelection`.
 */
import { FONT_SIZE_LEVELS } from "@deviva-draw/engine";
import type { AnyElement, ArrowElement, Arrowhead, TextAlign, TextElement, TextFontFamily } from "@deviva-draw/engine";
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


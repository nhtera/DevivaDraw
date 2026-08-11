/**
 * Renders a "compartment box" — a titled rectangle divided into stacked sections by horizontal rules
 * — used for class boxes (name / attributes / methods) and ER entities (name / attributes). Provides
 * `measureCompartment` (so the layout can size the node to its text) and `createCompartmentElements`
 * (outer rect + centered title + left-aligned section text + divider lines, all sharing one group).
 */
import type { AnyElement } from "../../elements/element-types";
import { createLineElement, createRectangleElement } from "../../elements/shape-elements";
import { createTextElement } from "../../elements/text-element";
import type { LayoutBox } from "../layout/types";

const LINE_H = 22;
const FONT = 16;
const CHAR_W = 8.5;
const PAD_X = 14;
const TITLE_PAD_Y = 9;
const SECTION_PAD_Y = 7;
const MIN_W = 90;

export interface CompartmentSpec {
  title: string;
  /** Each section is a stacked, divider-separated group of left-aligned text lines. */
  sections: string[][];
}

const titleHeight = (): number => LINE_H + TITLE_PAD_Y * 2;
const sectionHeight = (lines: string[]): number => Math.max(1, lines.length) * LINE_H + SECTION_PAD_Y * 2;

export function measureCompartment(spec: CompartmentSpec): { width: number; height: number } {
  const allLines = [spec.title, ...spec.sections.flat()];
  const longest = allLines.reduce((max, line) => Math.max(max, line.length), 0);
  const width = Math.max(MIN_W, Math.round(longest * CHAR_W) + PAD_X * 2);
  const height = titleHeight() + spec.sections.reduce((sum, lines) => sum + sectionHeight(lines), 0);
  return { width, height };
}

export function createCompartmentElements(box: LayoutBox, spec: CompartmentSpec, groupId: string): AnyElement[] {
  const groupIds = [groupId];
  const elements: AnyElement[] = [
    createRectangleElement({ x: box.x, y: box.y, width: box.width, height: box.height, groupIds }),
  ];

  const th = titleHeight();
  elements.push(
    createTextElement({
      x: box.x,
      y: box.y + (th - LINE_H) / 2,
      width: box.width,
      height: LINE_H,
      text: spec.title,
      textAlign: "center",
      groupIds,
    }),
  );

  let y = box.y + th;
  for (const lines of spec.sections) {
    // Divider above each section (below the title / previous section).
    elements.push(
      createLineElement({
        x: box.x,
        y,
        width: box.width,
        height: 0,
        points: [
          { x: 0, y: 0 },
          { x: box.width, y: 0 },
        ],
        groupIds,
      }),
    );
    if (lines.length > 0) {
      elements.push(
        createTextElement({
          x: box.x + PAD_X,
          y: y + SECTION_PAD_Y,
          width: box.width - PAD_X * 2,
          height: lines.length * LINE_H,
          text: lines.join("\n"),
          fontSize: FONT,
          textAlign: "left",
          groupIds,
        }),
      );
    }
    y += sectionHeight(lines);
  }
  return elements;
}

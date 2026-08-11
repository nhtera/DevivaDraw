/**
 * Builds a node's element(s): the shape plus its label as *bound* text (Excalidraw parity) — the
 * label carries `containerId` and the shape carries the matching `boundElements` ref, so double-click
 * edits and container resizes reflow the label instead of leaving an overlaid, detached text. A
 * `click A "url"` hyperlink maps to the shape's `link`. Both sides of the binding are set here; a
 * half-wired binding would detach the label.
 */
import type { AnyElement } from "../../elements/element-types";
import { createTextElement } from "../../elements/text-element";
import type { LayoutBox } from "../layout/types";
import type { FlowNode } from "../parse/flowchart-ir";
import { shapeToElement } from "./shape-map";
import type { ResolvedNodeStyle } from "./style-map";

const LABEL_LINE_HEIGHT = 24;

export function createNodeElements(node: FlowNode, box: LayoutBox, style: ResolvedNodeStyle): AnyElement[] {
  const groupIds = [`mermaid-${node.id}`];
  const shape = shapeToElement(node.shape, { ...box, groupIds }, style);
  if (node.link) shape.link = node.link;

  const lines = Math.max(1, node.label.split("\n").length);
  const textHeight = lines * LABEL_LINE_HEIGHT;
  const label = createTextElement({
    x: box.x + 8,
    y: box.y + (box.height - textHeight) / 2,
    width: box.width - 16,
    height: textHeight,
    text: node.label,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: shape.id,
    groupIds,
  });
  shape.boundElements = [{ id: label.id, type: "text" }];
  return [shape, label];
}

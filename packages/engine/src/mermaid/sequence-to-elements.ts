/**
 * Mermaid `sequenceDiagram` → Deviva elements. Parses to an event stream, runs the bespoke lane/time
 * layout (`sequence-layout.ts`), then emits: fragment frames (behind), dashed lifelines, activation
 * bars, participant boxes with bound labels, notes, and message arrows with their text. Message arrow
 * style maps to stroke/arrowhead (dashed line, cross head → bar); self-messages loop to the right.
 */
import type { AnyElement } from "../elements/element-types";
import { createLineElement, createRectangleElement } from "../elements/shape-elements";
import { createTextElement } from "../elements/text-element";
import { createNodeElements } from "./map/node-elements";
import { createEdgeElements } from "./map/edge-elements";
import type { FlowNode } from "./parse/flowchart-ir";
import { parseSequenceDiagram } from "./parse/parse-sequence";
import { ACT_W, HEADER_H, SELF_W, layoutSequence } from "./sequence-layout";
import type { MessageLayout } from "./sequence-layout";

const NOTE_FILL = "#fff5ad";
const ACT_FILL = "#e9ecf1";
const SELF_LOOP_H = 20;

function messageElements(msg: MessageLayout, cxOf: (id: string) => number, group: string): AnyElement[] {
  const endArrowhead = msg.head === "cross" ? "bar" : msg.head === "none" ? "none" : "arrow";
  const strokeStyle = msg.line === "dashed" ? ("dashed" as const) : undefined;
  const groupIds = [group];
  if (msg.selfLoop) {
    const x = cxOf(msg.from);
    const points = [
      { x, y: msg.y },
      { x: x + SELF_W, y: msg.y },
      { x: x + SELF_W, y: msg.y + SELF_LOOP_H },
      { x, y: msg.y + SELF_LOOP_H },
    ];
    const arrow = createEdgeElements(points, { startArrowhead: "none", endArrowhead, strokeStyle }, group);
    if (!msg.text) return arrow;
    const label = createTextElement({ x: x + SELF_W + 6, y: msg.y - 2, width: Math.max(40, msg.text.length * 8), height: 20, text: msg.text, fontSize: 14, textAlign: "left", groupIds });
    return [...arrow, label];
  }
  const from = cxOf(msg.from);
  const to = cxOf(msg.to);
  const arrow = createEdgeElements(
    [{ x: from, y: msg.y }, { x: to, y: msg.y }],
    { startArrowhead: "none", endArrowhead, strokeStyle },
    group,
  );
  const label = createTextElement({ x: Math.min(from, to), y: msg.y - 22, width: Math.abs(to - from), height: 20, text: msg.text, fontSize: 14, textAlign: "center", groupIds });
  return msg.text ? [...arrow, label] : arrow;
}

export function sequenceToElements(source: string): AnyElement[] {
  const layout = layoutSequence(parseSequenceDiagram(source));
  const cxOf = (id: string): number => layout.lanes.find((l) => l.id === id)?.cx ?? 0;
  const elements: AnyElement[] = [];

  // Fragment frames sit behind everything.
  layout.fragments.forEach((frag, i) => {
    const groupIds = [`mermaid-seq-frag-${i}`];
    elements.push(createRectangleElement({ x: frag.x, y: frag.y, width: frag.w, height: frag.h, groupIds }));
    const tag = frag.label ? `${frag.kind} [${frag.label}]` : frag.kind;
    elements.push(createTextElement({ x: frag.x + 8, y: frag.y + 4, width: frag.w - 16, height: 18, text: tag, fontSize: 13, textAlign: "left", groupIds }));
    for (const divider of frag.dividers) {
      elements.push(createLineElement({ x: frag.x, y: divider.y, width: frag.w, height: 0, points: [{ x: 0, y: 0 }, { x: frag.w, y: 0 }], strokeStyle: "dashed", groupIds }));
      if (divider.label) elements.push(createTextElement({ x: frag.x + 8, y: divider.y + 2, width: frag.w - 16, height: 18, text: `[${divider.label}]`, fontSize: 13, textAlign: "left", groupIds }));
    }
  });

  // Lifelines, then activation bars on top of them.
  for (const lane of layout.lanes) {
    const len = layout.bottomY - HEADER_H;
    elements.push(createLineElement({ x: lane.cx, y: HEADER_H, width: 0, height: len, points: [{ x: 0, y: 0 }, { x: 0, y: len }], strokeStyle: "dashed", groupIds: [`mermaid-seq-life-${lane.id}`] }));
  }
  for (const act of layout.activations) {
    const x = act.cx - ACT_W / 2 + act.level * (ACT_W - 3);
    // Grouped with the owning lifeline so an activation bar moves/selects together with it.
    elements.push(createRectangleElement({ x, y: act.y1, width: ACT_W, height: Math.max(4, act.y2 - act.y1), backgroundColor: ACT_FILL, fillStyle: "solid", groupIds: [`mermaid-seq-life-${act.id}`] }));
  }

  // Participant boxes (with bound labels) at the top.
  for (const lane of layout.lanes) {
    const node: FlowNode = { id: lane.id, label: lane.label, shape: "rectangle", classes: [] };
    elements.push(...createNodeElements(node, { x: lane.boxX, y: 0, width: lane.boxW, height: HEADER_H }, {}));
  }

  // Notes.
  layout.notes.forEach((note, i) => {
    const groupIds = [`mermaid-seq-note-${i}`];
    elements.push(createRectangleElement({ x: note.x, y: note.y, width: note.w, height: note.h, backgroundColor: NOTE_FILL, fillStyle: "solid", groupIds }));
    elements.push(createTextElement({ x: note.x + 8, y: note.y + 8, width: note.w - 16, height: note.h - 16, text: note.text, fontSize: 14, textAlign: "center", verticalAlign: "middle", groupIds }));
  });

  // Messages last so arrows and labels read above the lifelines/activations.
  layout.messages.forEach((msg, i) => elements.push(...messageElements(msg, cxOf, `mermaid-seq-msg-${i}`)));

  return elements;
}

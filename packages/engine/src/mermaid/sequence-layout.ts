/**
 * Bespoke layout for sequence diagrams (NOT dagre — this is a fixed participant-lane + vertical-time
 * geometry). Places participants left-to-right, then walks the event stream top-down assigning a Y row
 * to each message/note, tracking activation-bar spans and nested fragment (loop/alt/opt/par) bounding
 * boxes. Pure + deterministic. The emitter (`sequence-to-elements.ts`) turns this into elements.
 */
import type { FragmentKind, MessageHead, MessageLine, SequenceDiagram } from "./parse/sequence-ir";

export const HEADER_H = 40;
export const ACT_W = 10;
export const SELF_W = 46;
const LANE_GAP = 60;
const LANE_MIN_W = 90;
const CHAR_W = 8.5;
const PAD_X = 14;
const ROW_H = 46;
const NOTE_LINE_H = 22;
const NOTE_PAD = 8;
const BODY_TOP_GAP = 26;
const FRAG_HEADER = 26;
const FRAG_PAD = 14;
const FRAG_INSET = 8;
const SELF_H = 34;

export interface LaneLayout {
  id: string;
  label: string;
  isActor: boolean;
  cx: number;
  boxX: number;
  boxW: number;
}
export interface MessageLayout {
  from: string;
  to: string;
  text: string;
  line: MessageLine;
  head: MessageHead;
  y: number;
  selfLoop: boolean;
}
export interface NoteLayout {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ActivationLayout {
  id: string;
  cx: number;
  y1: number;
  y2: number;
  level: number;
}
export interface FragmentLayout {
  kind: FragmentKind;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  dividers: { y: number; label: string }[];
}
export interface SequenceLayout {
  lanes: LaneLayout[];
  messages: MessageLayout[];
  notes: NoteLayout[];
  activations: ActivationLayout[];
  fragments: FragmentLayout[];
  bottomY: number;
}

const measureWidth = (label: string): number => Math.max(LANE_MIN_W, Math.round(label.length * CHAR_W) + PAD_X * 2);

export function layoutSequence(diagram: SequenceDiagram): SequenceLayout {
  const lanes: LaneLayout[] = [];
  const laneOf = new Map<string, LaneLayout>();
  let cursor = 0;
  for (const p of diagram.participants) {
    const boxW = measureWidth(p.label);
    const lane: LaneLayout = { id: p.id, label: p.label, isActor: p.isActor, cx: cursor + boxW / 2, boxX: cursor, boxW };
    lanes.push(lane);
    laneOf.set(p.id, lane);
    cursor += boxW + LANE_GAP;
  }
  const cx = (id: string): number => laneOf.get(id)?.cx ?? 0;
  const allLeft = lanes.length ? Math.min(...lanes.map((l) => l.boxX)) : 0;
  const allRight = lanes.length ? Math.max(...lanes.map((l) => l.boxX + l.boxW)) : 0;

  const messages: MessageLayout[] = [];
  const notes: NoteLayout[] = [];
  const activations: ActivationLayout[] = [];
  const fragments: FragmentLayout[] = [];
  const actStack = new Map<string, number[]>(); // participant → open activation start Ys
  const fragStack: { kind: FragmentKind; label: string; topY: number; depth: number; dividers: { y: number; label: string }[] }[] = [];

  const openAct = (id: string, y: number): void => {
    const stack = actStack.get(id) ?? actStack.set(id, []).get(id)!;
    stack.push(y);
  };
  const closeAct = (id: string, y: number): void => {
    const stack = actStack.get(id);
    if (!stack || stack.length === 0) return;
    const y1 = stack.pop()!;
    activations.push({ id, cx: cx(id), y1, y2: y, level: stack.length });
  };

  let y = HEADER_H + BODY_TOP_GAP;
  for (const event of diagram.events) {
    switch (event.kind) {
      case "message": {
        const selfLoop = event.from === event.to;
        messages.push({ from: event.from, to: event.to, text: event.text, line: event.line, head: event.head, y, selfLoop });
        if (event.activate) openAct(event.to, y);
        if (event.deactivate) closeAct(event.from, y);
        y += selfLoop ? SELF_H + 12 : ROW_H;
        break;
      }
      case "note": {
        const centers = event.participants.map(cx);
        const lo = Math.min(...centers);
        const hi = Math.max(...centers);
        const lines = Math.max(1, event.text.split("\n").length);
        const h = lines * NOTE_LINE_H + NOTE_PAD * 2;
        const textW = Math.round(event.text.length * CHAR_W) + PAD_X * 2;
        let x: number;
        let w: number;
        if (event.placement === "over") {
          w = Math.max(textW, hi - lo + LANE_MIN_W);
          x = (lo + hi) / 2 - w / 2;
        } else {
          w = Math.max(LANE_MIN_W, textW);
          x = event.placement === "left" ? lo - w - 10 : lo + 10;
        }
        notes.push({ text: event.text, x, y, w, h });
        y += h + 10;
        break;
      }
      case "activate":
        openAct(event.participant, y);
        break;
      case "deactivate":
        closeAct(event.participant, y);
        break;
      case "fragment-start":
        fragStack.push({ kind: event.fragKind, label: event.label, topY: y, depth: fragStack.length, dividers: [] });
        y += FRAG_HEADER;
        break;
      case "fragment-else":
        if (fragStack.length) {
          fragStack[fragStack.length - 1]!.dividers.push({ y, label: event.label });
          y += 8;
        }
        break;
      case "fragment-end": {
        const frag = fragStack.pop();
        if (!frag) break;
        const inset = frag.depth * FRAG_INSET;
        fragments.push({ kind: frag.kind, label: frag.label, x: allLeft - 12 + inset, y: frag.topY, w: Math.max(40, allRight - allLeft + 24 - inset * 2), h: y - frag.topY, dividers: frag.dividers });
        y += FRAG_PAD;
        break;
      }
    }
  }

  // Close any activations / fragments left open by malformed input.
  for (const [id, stack] of actStack) for (let i = stack.length - 1; i >= 0; i--) activations.push({ id, cx: cx(id), y1: stack[i]!, y2: y, level: i });
  for (const frag of fragStack) fragments.push({ kind: frag.kind, label: frag.label, x: allLeft - 12, y: frag.topY, w: Math.max(40, allRight - allLeft + 24), h: y - frag.topY, dividers: frag.dividers });

  return { lanes, messages, notes, activations, fragments, bottomY: y };
}

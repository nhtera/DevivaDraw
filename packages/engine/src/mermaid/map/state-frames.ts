/**
 * Turns composite states into frame elements — the state-diagram analogue of `subgraph-frames.ts`.
 * Each composite becomes a titled frame whose box is the padded union of its member node boxes plus
 * any child-composite frames (so nested composites nest visually). Members get `frameId` set to their
 * innermost frame. Frames are returned parents-first so outer frames render behind inner ones.
 */
import type { AnyElement } from "../../elements/element-types";
import { createFrameElement } from "../../elements/frame-element";
import type { LayoutBox } from "../layout/types";
import type { StateComposite, StateNode } from "../parse/state-ir";

const FRAME_PAD = 22;
const FRAME_HEADER = 10;

export interface StateFrameResult {
  frames: AnyElement[];
  frameOfNode: Map<string, string>;
}

export function createStateFrames(composites: StateComposite[], nodes: StateNode[], nodeBoxes: Map<string, LayoutBox>): StateFrameResult {
  if (composites.length === 0) return { frames: [], frameOfNode: new Map() };

  const byId = new Map(composites.map((c) => [c.id, c] as const));
  const membersOf = new Map<string, string[]>();
  for (const node of nodes) if (node.parent) (membersOf.get(node.parent) ?? membersOf.set(node.parent, []).get(node.parent)!).push(node.id);
  const childrenOf = new Map<string, StateComposite[]>();
  for (const c of composites) if (c.parent) (childrenOf.get(c.parent) ?? childrenOf.set(c.parent, []).get(c.parent)!).push(c);

  const boxMemo = new Map<string, LayoutBox | null>();
  const computeBox = (c: StateComposite): LayoutBox | null => {
    if (boxMemo.has(c.id)) return boxMemo.get(c.id)!;
    boxMemo.set(c.id, null); // guard cyclic parent refs
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const acc = (b: LayoutBox): void => {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    };
    for (const id of membersOf.get(c.id) ?? []) {
      const box = nodeBoxes.get(id);
      if (box) acc(box);
    }
    for (const child of childrenOf.get(c.id) ?? []) {
      const cb = computeBox(child);
      if (cb) acc(cb);
    }
    const box: LayoutBox | null =
      minX === Infinity
        ? null
        : { x: minX - FRAME_PAD, y: minY - FRAME_PAD - FRAME_HEADER, width: maxX - minX + 2 * FRAME_PAD, height: maxY - minY + 2 * FRAME_PAD + FRAME_HEADER };
    boxMemo.set(c.id, box);
    return box;
  };

  const depthOf = (c: StateComposite): number => {
    let depth = 0;
    let parent = c.parent;
    while (parent) {
      depth++;
      parent = byId.get(parent)?.parent;
    }
    return depth;
  };

  const frames: AnyElement[] = [];
  const frameById = new Map<string, string>();
  for (const c of [...composites].sort((a, b) => depthOf(a) - depthOf(b))) {
    const box = computeBox(c);
    if (!box) continue;
    const frame = createFrameElement({ ...box, name: c.title });
    frames.push(frame);
    frameById.set(c.id, frame.id);
  }

  const frameOfNode = new Map<string, string>();
  for (const node of nodes) {
    if (!node.parent) continue;
    const frameId = frameById.get(node.parent);
    if (frameId) frameOfNode.set(node.id, frameId);
  }
  return { frames, frameOfNode };
}

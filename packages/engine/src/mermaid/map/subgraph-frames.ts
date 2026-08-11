/**
 * Turns parsed subgraphs into frame elements. Each subgraph becomes a named frame whose box is the
 * padded union of its member node boxes plus any child-subgraph frames (so nested subgraphs nest
 * visually). Members get `frameId` set to their innermost frame. The layout keeps subgraph members
 * clustered (see `layout/order.ts`), so these boxes don't overlap for well-formed input. Frames are
 * returned parents-first so outer frames render behind inner ones and behind the nodes.
 */
import type { AnyElement } from "../../elements/element-types";
import { createFrameElement } from "../../elements/frame-element";
import type { LayoutBox } from "../layout/types";
import type { Flowchart, FlowSubgraph } from "../parse/flowchart-ir";

const FRAME_PAD = 22;
const FRAME_HEADER = 10; // extra top room for the frame's title label

export interface FrameResult {
  frames: AnyElement[];
  /** nodeId → frame id of its innermost subgraph, for setting `frameId` on the node's elements. */
  frameOfNode: Map<string, string>;
}

export function createSubgraphFrames(flow: Flowchart, nodeBoxes: Map<string, LayoutBox>): FrameResult {
  if (flow.subgraphs.length === 0) return { frames: [], frameOfNode: new Map() };

  const byId = new Map(flow.subgraphs.map((sg) => [sg.id, sg]));
  const childrenOf = new Map<string, FlowSubgraph[]>();
  for (const sg of flow.subgraphs) {
    if (sg.parentId) (childrenOf.get(sg.parentId) ?? childrenOf.set(sg.parentId, []).get(sg.parentId)!).push(sg);
  }

  const boxMemo = new Map<string, LayoutBox | null>();
  const computeBox = (sg: FlowSubgraph): LayoutBox | null => {
    if (boxMemo.has(sg.id)) return boxMemo.get(sg.id)!;
    boxMemo.set(sg.id, null); // guard against cyclic parent refs
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
    for (const id of sg.nodeIds) {
      const box = nodeBoxes.get(id);
      if (box) acc(box);
    }
    for (const child of childrenOf.get(sg.id) ?? []) {
      const cb = computeBox(child);
      if (cb) acc(cb);
    }
    const box: LayoutBox | null =
      minX === Infinity
        ? null
        : {
            x: minX - FRAME_PAD,
            y: minY - FRAME_PAD - FRAME_HEADER,
            width: maxX - minX + 2 * FRAME_PAD,
            height: maxY - minY + 2 * FRAME_PAD + FRAME_HEADER,
          };
    boxMemo.set(sg.id, box);
    return box;
  };

  const depthOf = (sg: FlowSubgraph): number => {
    let depth = 0;
    let parent = sg.parentId;
    while (parent) {
      depth++;
      parent = byId.get(parent)?.parentId;
    }
    return depth;
  };

  const frames: AnyElement[] = [];
  const frameById = new Map<string, string>();
  for (const sg of [...flow.subgraphs].sort((a, b) => depthOf(a) - depthOf(b))) {
    const box = computeBox(sg);
    if (!box) continue;
    const frame = createFrameElement({ ...box, name: sg.title ?? sg.id });
    frames.push(frame);
    frameById.set(sg.id, frame.id);
  }

  const frameOfNode = new Map<string, string>();
  for (const node of flow.nodes) {
    if (node.subgraphId === undefined) continue;
    const frameId = frameById.get(node.subgraphId);
    if (frameId) frameOfNode.set(node.id, frameId);
  }
  return { frames, frameOfNode };
}

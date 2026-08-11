/**
 * Virtual-node insertion (dagre stage 3). Every edge spanning more than one rank is split into
 * unit-length segments by inserting a near-zero-width dummy node on each intermediate rank. This turns
 * long edges into a chain the crossing-minimizer and coordinate stage can straighten, and gives the
 * router bend points. Each original edge keeps its full node chain (oriented low→high rank) for
 * routing; self-loops become single-node chains handled specially.
 */
import type { AcyclicResult } from "./acyclic";
import { DUMMY_SIZE, type EdgeChain, type LayoutInput, type LayoutNode } from "./types";

export interface DummyResult {
  nodes: Map<string, LayoutNode>;
  chains: EdgeChain[];
  maxRank: number;
}

export function insertDummies(input: LayoutInput, acyclic: AcyclicResult, rank: Map<string, number>): DummyResult {
  const nodes = new Map<string, LayoutNode>();
  let maxRank = 0;
  for (const node of input.nodes) {
    const r = rank.get(node.id) ?? 0;
    maxRank = Math.max(maxRank, r);
    nodes.set(node.id, { id: node.id, width: node.width, height: node.height, rank: r, order: 0, along: 0, isDummy: false });
  }

  const chains: EdgeChain[] = [];
  let dummySeq = 0;
  for (const edge of acyclic.edges) {
    const r0 = rank.get(edge.from)!;
    const r1 = rank.get(edge.to)!;
    const chainNodes = [edge.from];
    for (let r = r0 + 1; r < r1; r++) {
      const id = `__d${dummySeq++}`;
      nodes.set(id, { id, width: DUMMY_SIZE, height: DUMMY_SIZE, rank: r, order: 0, along: 0, isDummy: true });
      chainNodes.push(id);
    }
    chainNodes.push(edge.to);
    chains.push({ index: edge.index, nodes: chainNodes, reversed: edge.reversed, selfLoop: false });
  }

  const byIndex = new Map(input.edges.map((e) => [e.index, e]));
  for (const index of acyclic.selfLoops) {
    const edge = byIndex.get(index)!;
    chains.push({ index, nodes: [edge.from], reversed: false, selfLoop: true });
  }
  return { nodes, chains, maxRank };
}

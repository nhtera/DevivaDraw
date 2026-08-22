/**
 * Line dispatcher that assembles the full flowchart IR. Walks the source line by line, stripping
 * front-matter/comments, reading the header direction, tracking a subgraph stack, collecting styling
 * directives (`style`/`classDef`/`class`/`linkStyle`/`click`), and expanding every edge statement
 * (chained + `&` cartesian) into a flat, indexed edge list. Never throws: an unrecognized line is
 * tried as a bare node declaration and otherwise skipped.
 */
import type {
  FlowDirection,
  FlowEdge,
  FlowNode,
  Flowchart,
  FlowSubgraph,
  LinkStyle,
  StyleRule,
} from "./flowchart-ir";
import { parseStatement } from "./parse-edge";
import { extractInlineClasses, parseNodeToken, type NodeToken } from "./tokenize-node";

const DIRECTIONS = new Set(["TD", "TB", "BT", "LR", "RL"]);

/** Parses `fill:#f9f, stroke:#333` into `{ fill: "#f9f", stroke: "#333" }`. */
function parseProps(raw: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const colon = pair.indexOf(":");
    if (colon === -1) continue;
    props[pair.slice(0, colon).trim()] = pair.slice(colon + 1).trim();
  }
  return props;
}

class FlowchartBuilder {
  direction: FlowDirection = "TD";
  nodes = new Map<string, FlowNode>();
  edges: FlowEdge[] = [];
  subgraphs: FlowSubgraph[] = [];
  styles: StyleRule[] = [];
  classDefs = new Map<string, StyleRule>();
  linkStyles: LinkStyle[] = [];
  private stack: FlowSubgraph[] = [];
  private subgraphSeq = 0;

  private ensureNode(token: NodeToken, classes: string[]): void {
    const existing = this.nodes.get(token.id);
    const node: FlowNode =
      existing ?? { id: token.id, label: token.label ?? token.id, shape: "rectangle", classes: [] };
    if (token.label !== undefined) {
      node.label = token.label;
      node.shape = token.shape;
    }
    for (const cls of classes) if (!node.classes.includes(cls)) node.classes.push(cls);
    const top = this.stack[this.stack.length - 1];
    if (top && node.subgraphId === undefined) {
      node.subgraphId = top.id;
      if (!top.nodeIds.includes(node.id)) top.nodeIds.push(node.id);
    }
    this.nodes.set(token.id, node);
  }

  /** Registers each token in a group and returns their ids. */
  private groupIds(rawTokens: string[]): string[] {
    const ids: string[] = [];
    for (const raw of rawTokens) {
      const { base, classes } = extractInlineClasses(raw);
      const token = parseNodeToken(base);
      if (!token) continue;
      this.ensureNode(token, classes);
      ids.push(token.id);
    }
    return ids;
  }

  private addStatement(line: string): void {
    const parsed = parseStatement(line);
    if (!parsed) return;
    const idGroups = parsed.groups.map((tokens) => this.groupIds(tokens));
    for (let i = 0; i < parsed.connectors.length; i++) {
      const conn = parsed.connectors[i]!;
      for (const from of idGroups[i]!) {
        for (const to of idGroups[i + 1]!) {
          this.edges.push({
            from,
            to,
            label: conn.label,
            kind: conn.kind,
            startHead: conn.startHead,
            endHead: conn.endHead,
            minlen: conn.minlen,
            classes: [],
            index: this.edges.length,
          });
        }
      }
    }
  }

  private openSubgraph(rest: string): void {
    let id: string | undefined;
    let title: string | undefined;
    // `subgraph id[Title]` / `subgraph id [Title]` / `subgraph [Title]` — the title may be quoted.
    const withTitle = rest.match(/^(?:([A-Za-z0-9_-]+)\s*)?\[(.+)\]$/);
    if (withTitle) {
      id = withTitle[1];
      title = withTitle[2]!.replace(/^["']|["']$/g, "");
    } else if (/^[A-Za-z0-9_]+$/.test(rest)) {
      id = rest;
      title = rest;
    } else if (rest) {
      title = rest.replace(/^["']|["']$/g, "");
    }
    const sg: FlowSubgraph = {
      id: id ?? `__sg${this.subgraphSeq++}`,
      title,
      parentId: this.stack[this.stack.length - 1]?.id,
      nodeIds: [],
    };
    this.subgraphs.push(sg);
    this.stack.push(sg);
  }

  /** Handles a styling/meta directive. Returns true if the line was one. */
  private directive(line: string): boolean {
    const style = line.match(/^style\s+(\S+)\s+(.+)$/);
    if (style) return !!this.styles.push({ target: style[1]!, props: parseProps(style[2]!) });
    const classDef = line.match(/^classDef\s+([A-Za-z0-9_,-]+)\s+(.+)$/);
    if (classDef) {
      const props = parseProps(classDef[2]!);
      for (const name of classDef[1]!.split(",")) this.classDefs.set(name.trim(), { target: name.trim(), props });
      return true;
    }
    const classApply = line.match(/^class\s+([A-Za-z0-9_,\s]+?)\s+([A-Za-z0-9_-]+)$/);
    if (classApply) {
      for (const id of classApply[1]!.split(",")) {
        const node = this.nodes.get(id.trim());
        if (node && !node.classes.includes(classApply[2]!)) node.classes.push(classApply[2]!);
      }
      return true;
    }
    const link = line.match(/^linkStyle\s+(default|[\d,\s]+)\s+(.+)$/);
    if (link) {
      const props = parseProps(link[2]!);
      if (link[1] === "default") this.linkStyles.push({ index: "default", props });
      else for (const n of link[1]!.split(",")) this.linkStyles.push({ index: Number(n.trim()), props });
      return true;
    }
    const click = line.match(/^click\s+(\S+)\s+(?:\S+\s+)?["']([^"']+)["']/);
    if (click) {
      const node = this.nodes.get(click[1]!);
      if (node) node.link = click[2];
      return true;
    }
    return false;
  }

  dispatch(line: string): void {
    if (/^direction\s+/i.test(line)) {
      const dir = line.split(/\s+/)[1]?.toUpperCase();
      if (dir && DIRECTIONS.has(dir)) {
        const top = this.stack[this.stack.length - 1];
        if (top) top.direction = dir as FlowDirection;
        else this.direction = dir as FlowDirection;
      }
      return;
    }
    if (/^subgraph\b/i.test(line)) return this.openSubgraph(line.replace(/^subgraph\s*/i, "").trim());
    if (/^end$/i.test(line)) {
      this.stack.pop();
      return;
    }
    if (this.directive(line)) return;
    this.addStatement(line);
  }

  build(): Flowchart {
    return {
      direction: this.direction,
      nodes: [...this.nodes.values()],
      edges: this.edges,
      subgraphs: this.subgraphs,
      styles: this.styles,
      classDefs: this.classDefs,
      linkStyles: this.linkStyles,
    };
  }
}

/** Parses Mermaid flowchart source into the typed IR. */
export function parseFlowchart(source: string): Flowchart {
  const builder = new FlowchartBuilder();
  let inFrontMatter = false;
  const rawLines = source.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i]!.replace(/%%\{[^}]*\}%%/g, "").replace(/\s*%%.*$/, "").trim();
    if (line === "---" && (i === 0 || inFrontMatter)) {
      inFrontMatter = !inFrontMatter;
      continue;
    }
    if (inFrontMatter || !line) continue;
    const header = line.match(/^(?:graph|flowchart)\b\s*([A-Za-z]{2})?/i);
    if (header) {
      const dir = header[1]?.toUpperCase();
      if (dir && DIRECTIONS.has(dir)) builder.direction = dir as FlowDirection;
      line = line.slice(header[0].length).trim();
      if (!line) continue; // header-only line
    }
    for (const statement of line.split(";")) {
      const trimmed = statement.trim();
      if (trimmed) builder.dispatch(trimmed);
    }
  }
  return builder.build();
}

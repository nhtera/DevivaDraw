/**
 * Resolves Mermaid styling (`classDef`, inline `style`, `:::class`, `class`, `linkStyle`) into Deviva
 * element style fields. Node precedence follows Mermaid: `classDef`/`class` first, then inline `style`
 * on top. Edge styling derives from the link kind (dotted/thick/invisible) and any matching
 * `linkStyle` override. CSS-ish props (`fill`, `stroke`, `stroke-width`, `stroke-dasharray`) map to
 * `backgroundColor`/`strokeColor`/`strokeWidth`/`strokeStyle`.
 */
import type { FillStyle, StrokeStyle } from "../../elements/base-element";
import type { EdgeKind, Flowchart, FlowEdge, FlowNode, StyleRule } from "../parse/flowchart-ir";

export interface ResolvedNodeStyle {
  strokeColor?: string;
  backgroundColor?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  fillStyle?: FillStyle;
}

export interface ResolvedEdgeStyle {
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  opacity?: number;
}

/** Parses `stroke-width:2px` → 2; returns undefined for unparseable input. */
function parseWidth(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Turns a `{ fill, stroke, ... }` prop bag into element style fields. */
function propsToStyle(props: Record<string, string>, into: ResolvedNodeStyle): void {
  if (props.fill) {
    into.backgroundColor = props.fill;
    into.fillStyle = "solid"; // an explicit fill means a solid swatch, not hachure
  }
  if (props.stroke) into.strokeColor = props.stroke;
  const width = parseWidth(props["stroke-width"]);
  if (width !== undefined) into.strokeWidth = width;
  if (props["stroke-dasharray"]) into.strokeStyle = "dashed";
}

/** Resolves a node's final style from its classes (in order) then its inline `style` declaration. */
export function resolveNodeStyle(node: FlowNode, flow: Flowchart): ResolvedNodeStyle {
  const style: ResolvedNodeStyle = {};
  for (const cls of node.classes) {
    const def = flow.classDefs.get(cls);
    if (def) propsToStyle(def.props, style);
  }
  const inline: StyleRule | undefined = flow.styles.find((s) => s.target === node.id);
  if (inline) propsToStyle(inline.props, style);
  return style;
}

const KIND_WIDTH: Partial<Record<EdgeKind, number>> = { thick: 3 };
const KIND_STROKE: Partial<Record<EdgeKind, StrokeStyle>> = { dotted: "dotted" };

/** Resolves an edge's style from its kind and any matching `linkStyle` (index or `default`). */
export function resolveEdgeStyle(edge: FlowEdge, flow: Flowchart): ResolvedEdgeStyle {
  const style: ResolvedEdgeStyle = {
    strokeWidth: KIND_WIDTH[edge.kind],
    strokeStyle: KIND_STROKE[edge.kind],
    opacity: edge.kind === "invisible" ? 0 : undefined,
  };
  for (const link of flow.linkStyles) {
    if (link.index !== "default" && link.index !== edge.index) continue;
    if (link.props.stroke) style.strokeColor = link.props.stroke;
    const width = parseWidth(link.props["stroke-width"]);
    if (width !== undefined) style.strokeWidth = width;
    if (link.props["stroke-dasharray"]) style.strokeStyle = "dashed";
  }
  return style;
}

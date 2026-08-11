/**
 * Parser for Mermaid `classDiagram` source → typed IR. Handles class declarations with a `{ ... }`
 * member body (attributes vs. methods split by the `()` marker), out-of-body members (`Class : member`),
 * and the relation operators (inheritance `<|--`, composition `*--`, aggregation `o--`, association
 * `-->`, dependency `..>`, realization `..|>`, plain link) with optional `: label` and `"cardinality"`.
 * Never throws: unrecognized lines are skipped.
 */
import type { ClassDiagram, ClassEdge, ClassNode, ClassRelation } from "./class-ir";

/**
 * Splits the relation operator into its type, line style, and which side is the source (top rank).
 * For inheritance/realization/composition/aggregation the *marked* side (parent / whole) is the
 * source; for association/dependency the source is the side opposite the arrow (which points at the
 * target).
 */
function classifyRelation(op: string): { relation: ClassRelation; dashed: boolean; sourceIsLeft: boolean } {
  const dashed = op.includes(".");
  const left = op.match(/^[<|*o]+/)?.[0] ?? "";
  const right = op.match(/[>|*o]+$/)?.[0] ?? "";
  const marker = left || right;
  let relation: ClassRelation = "link";
  if (marker.includes("|")) relation = dashed ? "realization" : "inheritance";
  else if (marker.includes("*")) relation = "composition";
  else if (marker.includes("o")) relation = "aggregation";
  else if (left.includes("<") || right.includes(">")) relation = dashed ? "dependency" : "association";

  let sourceIsLeft: boolean;
  if (relation === "association" || relation === "dependency") {
    sourceIsLeft = !left.includes("<"); // arrow on the left (`<`) means the right side is the source
  } else {
    sourceIsLeft = left !== ""; // the marked side is the source
  }
  return { relation, dashed, sourceIsLeft };
}

const RELATION = /^([\w~]+)\s*(?:"[^"]*"\s*)?([-.<>|*o]{2,})\s*(?:"[^"]*"\s*)?([\w~]+)\s*(?::\s*(.+))?$/;

class ClassBuilder {
  nodes = new Map<string, ClassNode>();
  edges: ClassEdge[] = [];

  node(id: string): ClassNode {
    let node = this.nodes.get(id);
    if (!node) {
      node = { id, name: id, attributes: [], methods: [], hasBody: false };
      this.nodes.set(id, node);
    }
    return node;
  }

  addMember(node: ClassNode, raw: string): void {
    const member = raw.trim();
    if (!member) return;
    if (member.includes("(")) node.methods.push(member);
    else node.attributes.push(member);
  }

  build(): ClassDiagram {
    return { nodes: [...this.nodes.values()], edges: this.edges };
  }
}

export function parseClassDiagram(source: string): ClassDiagram {
  const builder = new ClassBuilder();
  let openClass: ClassNode | null = null;

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/%%\{[^}]*\}%%/g, "").replace(/\s*%%.*$/, "").trim();
    if (!line || /^classDiagram\b/i.test(line) || /^direction\s+/i.test(line)) continue;

    if (openClass) {
      if (line === "}") openClass = null;
      else builder.addMember(openClass, line);
      continue;
    }

    const classDecl = line.match(/^class\s+([\w~]+)\s*(\{)?/);
    if (classDecl) {
      const node = builder.node(classDecl[1]!);
      if (classDecl[2] === "{") {
        node.hasBody = true;
        openClass = node;
      }
      continue;
    }

    const relation = line.match(RELATION);
    if (relation) {
      const { relation: kind, dashed, sourceIsLeft } = classifyRelation(relation[2]!);
      const left = builder.node(relation[1]!).id;
      const right = builder.node(relation[3]!).id;
      builder.edges.push({
        from: sourceIsLeft ? left : right,
        to: sourceIsLeft ? right : left,
        relation: kind,
        dashed,
        label: relation[4]?.trim(),
        index: builder.edges.length,
      });
      continue;
    }

    // `Class : +member` — a member declared outside the body.
    const member = line.match(/^([\w~]+)\s*:\s*(.+)$/);
    if (member) builder.addMember(builder.node(member[1]!), member[2]!);
  }

  return builder.build();
}

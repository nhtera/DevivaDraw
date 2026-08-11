/**
 * Parser for Mermaid `stateDiagram` / `stateDiagram-v2` source → typed IR. Handles transitions
 * (`A --> B : label`), start/end pseudostates (`[*]`, scoped per composite), state declarations and
 * descriptions (`state "Long" as s`, `s : desc`), `<<choice>>`/`<<fork>>`/`<<join>>` specials, and
 * composite states (`state X { ... }`, nestable). Notes are skipped (best-effort). Never throws:
 * unrecognized lines are ignored.
 */
import type { FlowDirection } from "./flowchart-ir";
import type { StateComposite, StateDiagram, StateKind, StateNode } from "./state-ir";

class StateBuilder {
  nodes = new Map<string, StateNode>();
  composites: StateComposite[] = [];
  edges: StateDiagram["edges"] = [];
  direction: FlowDirection = "TB";

  node(id: string, kind: StateKind, parent: string | undefined, label?: string): StateNode {
    let node = this.nodes.get(id);
    if (!node) {
      node = { id, label: label ?? id, kind, parent };
      this.nodes.set(id, node);
    }
    return node;
  }

  /** Resolves a transition endpoint to a node id, minting a scoped start/end node for `[*]`. */
  endpoint(token: string, role: "source" | "target", scope: string | undefined): string {
    if (token === "[*]") {
      const id = `${role === "source" ? "::start" : "::end"}:${scope ?? ""}`;
      this.node(id, role === "source" ? "start" : "end", scope, "");
      return id;
    }
    const id = token.replace(/^"|"$/g, "");
    this.node(id, "state", scope);
    return id;
  }

  build(): StateDiagram {
    return { direction: this.direction, nodes: [...this.nodes.values()], composites: this.composites, edges: this.edges };
  }
}

const TRANSITION = /^(\[\*\]|"[^"]*"|[\w.-]+)\s*-->\s*(\[\*\]|"[^"]*"|[\w.-]+)\s*(?::\s*(.+))?$/;

export function parseStateDiagram(source: string): StateDiagram {
  const builder = new StateBuilder();
  const stack: string[] = []; // composite scope stack (innermost last)
  let inNote = false;

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/%%\{[^}]*\}%%/g, "").replace(/\s*%%.*$/, "").trim();
    if (!line || /^stateDiagram(-v2)?\b/i.test(line)) continue;

    if (inNote) {
      if (/^end\s+note$/i.test(line)) inNote = false;
      continue;
    }
    if (/^note\b/i.test(line)) {
      if (!line.includes(":")) inNote = true; // multi-line note block
      continue;
    }

    const dir = line.match(/^direction\s+(TB|TD|BT|LR|RL)$/i);
    if (dir) {
      builder.direction = dir[1]!.toUpperCase() as FlowDirection;
      continue;
    }

    if (line === "}") {
      stack.pop();
      continue;
    }
    const scope = stack[stack.length - 1];

    // Composite open: `state "Title" as id {` or `state id {`.
    const compAlias = line.match(/^state\s+"([^"]*)"\s+as\s+([\w.-]+)\s*\{$/);
    const comp = compAlias ? { id: compAlias[2]!, title: compAlias[1]! } : (() => {
      const m = line.match(/^state\s+([\w.-]+)\s*\{$/);
      return m ? { id: m[1]!, title: m[1]! } : null;
    })();
    if (comp) {
      builder.composites.push({ id: comp.id, title: comp.title, parent: scope });
      stack.push(comp.id);
      continue;
    }

    const transition = line.match(TRANSITION);
    if (transition) {
      builder.edges.push({
        from: builder.endpoint(transition[1]!, "source", scope),
        to: builder.endpoint(transition[2]!, "target", scope),
        label: transition[3]?.trim(),
        index: builder.edges.length,
      });
      continue;
    }

    const alias = line.match(/^state\s+"([^"]*)"\s+as\s+([\w.-]+)$/);
    if (alias) {
      builder.node(alias[2]!, "state", scope, alias[1]!);
      continue;
    }

    const special = line.match(/^state\s+(\w+)\s+<<(choice|fork|join)>>$/i);
    if (special) {
      builder.node(special[1]!, special[2]!.toLowerCase() as StateKind, scope, "");
      continue;
    }

    const decl = line.match(/^state\s+([\w.-]+)$/);
    if (decl) {
      builder.node(decl[1]!, "state", scope);
      continue;
    }

    const description = line.match(/^([\w.-]+)\s*:\s*(.+)$/);
    if (description) {
      builder.node(description[1]!, "state", scope).label = description[2]!.trim();
      continue;
    }

    const bare = line.match(/^([\w.-]+)$/);
    if (bare) builder.node(bare[1]!, "state", scope);
  }

  return builder.build();
}

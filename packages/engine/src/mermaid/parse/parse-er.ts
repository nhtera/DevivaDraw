/**
 * Parser for Mermaid `erDiagram` source → typed IR. Handles entity blocks with an attribute body
 * (`ENTITY { type name KEY }`) and relationships with cardinality + line style
 * (`A ||--o{ B : label`). Cardinality glyphs are translated to readable labels (`1`, `0..N`, …) since
 * the engine has no crow's-foot arrowheads. Never throws: unrecognized lines are skipped.
 */
import type { ERDiagram, EREntity } from "./er-ir";

/** Translates an ER cardinality token (`||`, `o{`, `}|`, …) to a readable label. */
function cardinalityLabel(card: string): string {
  if (card === "||") return "1";
  if (card === "|o" || card === "o|") return "0..1";
  if (card === "}o" || card === "o{") return "0..N";
  if (card === "}|" || card === "|{") return "1..N";
  return "";
}

const RELATION = /^([\w-]+)\s+([|}{o]{1,2}[-.]{2}[|}{o]{1,2})\s+([\w-]+)\s*(?::\s*(.+))?$/;

class ERBuilder {
  entities = new Map<string, EREntity>();
  edges: ERDiagram["edges"] = [];

  entity(id: string): EREntity {
    let entity = this.entities.get(id);
    if (!entity) {
      entity = { id, name: id, attributes: [], hasBody: false };
      this.entities.set(id, entity);
    }
    return entity;
  }

  build(): ERDiagram {
    return { entities: [...this.entities.values()], edges: this.edges };
  }
}

export function parseERDiagram(source: string): ERDiagram {
  const builder = new ERBuilder();
  let openEntity: EREntity | null = null;

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/%%\{[^}]*\}%%/g, "").replace(/\s*%%.*$/, "").trim();
    if (!line || /^erDiagram\b/i.test(line) || /^direction\s+/i.test(line)) continue;

    if (openEntity) {
      if (line === "}") openEntity = null;
      else openEntity.attributes.push(line);
      continue;
    }

    const relation = line.match(RELATION);
    if (relation) {
      const op = relation[2]!;
      const left = builder.entity(relation[1]!).id;
      const right = builder.entity(relation[3]!).id;
      builder.edges.push({
        from: left,
        to: right,
        label: relation[4]?.trim(),
        dashed: op.includes("."),
        startCard: cardinalityLabel(op.match(/^[|}{o]{1,2}/)?.[0] ?? ""),
        endCard: cardinalityLabel(op.match(/[|}{o]{1,2}$/)?.[0] ?? ""),
        index: builder.edges.length,
      });
      continue;
    }

    const entityDecl = line.match(/^([\w-]+)\s*\{$/);
    if (entityDecl) {
      const entity = builder.entity(entityDecl[1]!);
      entity.hasBody = true;
      openEntity = entity;
      continue;
    }

    const bare = line.match(/^([\w-]+)$/);
    if (bare) builder.entity(bare[1]!);
  }

  return builder.build();
}

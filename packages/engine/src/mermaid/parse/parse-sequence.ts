/**
 * Parser for Mermaid `sequenceDiagram` source → an ordered event stream + participant list. Handles
 * participant/actor declarations (with `as` alias), messages (`->`, `-->`, `->>`, `-->>`, `-x`, `-)`
 * and their activation `+`/`-` suffixes), notes (`Note left/right of`, `Note over A,B`), activate/
 * deactivate, and nestable fragments (`loop`/`alt`/`opt`/`par`/`break`/`critical` … `else`/`and` … `end`).
 * Participant order follows declaration, then first-use. Never throws: unknown lines are ignored.
 */
import type { FragmentKind, MessageHead, Participant, SeqEvent, SequenceDiagram } from "./sequence-ir";

// Message endpoints use `[\w.]` (no hyphen): a hyphen would be greedily swallowed from the `-`/`--`
// arrow itself (`B-->>A` must parse as B → A, not participant "B-"). Declarations/notes below DO allow
// hyphens, so a participant literally named `A-B` can be declared but must be referenced hyphen-free in
// messages — an accepted limitation of ASCII arrow syntax, not a parser bug.
const MESSAGE = /^([\w.]+)\s*(--?)([>x)]{1,2})\s*([+-]?)\s*([\w.]+)\s*:\s*(.*)$/;
const NOTE = /^note\s+(left of|right of|over)\s+([\w\s,.-]+?)\s*:\s*(.*)$/i;
const FRAGMENT_START = /^(loop|alt|opt|par|break|critical)\b\s*(.*)$/i;

class SequenceBuilder {
  order: string[] = [];
  labels = new Map<string, string>();
  actors = new Set<string>();
  events: SeqEvent[] = [];

  participant(id: string, label?: string, isActor = false): string {
    if (!this.order.includes(id)) {
      this.order.push(id);
      this.labels.set(id, label ?? id);
    } else if (label) {
      this.labels.set(id, label);
    }
    if (isActor) this.actors.add(id);
    return id;
  }

  build(): SequenceDiagram {
    const participants: Participant[] = this.order.map((id) => ({ id, label: this.labels.get(id) ?? id, isActor: this.actors.has(id) }));
    return { participants, events: this.events };
  }
}

export function parseSequenceDiagram(source: string): SequenceDiagram {
  const b = new SequenceBuilder();

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/%%\{[^}]*\}%%/g, "").replace(/\s*%%.*$/, "").trim();
    if (!line || /^sequenceDiagram\b/i.test(line) || /^(autonumber|title)\b/i.test(line)) continue;

    const decl = line.match(/^(participant|actor)\s+([\w-]+)(?:\s+as\s+(.+))?$/i);
    if (decl) {
      b.participant(decl[2]!, decl[3]?.trim(), decl[1]!.toLowerCase() === "actor");
      continue;
    }

    const message = line.match(MESSAGE);
    if (message) {
      // Marker semantics: `x` = cross, single `>` = no arrowhead (a plain line), `>>`/`)` = arrowhead.
      const marker = message[3]!;
      const head: MessageHead = marker.includes("x") ? "cross" : marker === ">" ? "none" : "arrow";
      b.events.push({
        kind: "message",
        from: b.participant(message[1]!),
        to: b.participant(message[5]!),
        text: message[6]!.trim(),
        line: message[2] === "--" ? "dashed" : "solid",
        head,
        activate: message[4] === "+",
        deactivate: message[4] === "-",
      });
      continue;
    }

    const note = line.match(NOTE);
    if (note) {
      const placement = note[1]!.toLowerCase() === "over" ? "over" : note[1]!.toLowerCase() === "left of" ? "left" : "right";
      const participants = note[2]!.split(",").map((p) => b.participant(p.trim()));
      b.events.push({ kind: "note", placement, participants, text: note[3]!.trim() });
      continue;
    }

    const activate = line.match(/^(de)?activate\s+([\w-]+)$/i);
    if (activate) {
      b.participant(activate[2]!);
      b.events.push(activate[1] ? { kind: "deactivate", participant: activate[2]! } : { kind: "activate", participant: activate[2]! });
      continue;
    }

    const fragStart = line.match(FRAGMENT_START);
    if (fragStart) {
      b.events.push({ kind: "fragment-start", fragKind: fragStart[1]!.toLowerCase() as FragmentKind, label: fragStart[2]!.trim() });
      continue;
    }
    const fragElse = line.match(/^(else|and|option)\b\s*(.*)$/i);
    if (fragElse) {
      b.events.push({ kind: "fragment-else", label: fragElse[2]!.trim() });
      continue;
    }
    if (/^end$/i.test(line)) b.events.push({ kind: "fragment-end" });
  }

  return b.build();
}

/** Render-agnostic IR for a Mermaid `sequenceDiagram`. Produced by `parse-sequence.ts`. */

export type MessageLine = "solid" | "dashed";
/** Arrowhead style at the message target: filled/open arrow, cross (x), or none. */
export type MessageHead = "arrow" | "cross" | "none";

export interface Participant {
  id: string;
  label: string;
  /** `actor X` renders as an actor; `participant X` (or implicit) renders as a box. */
  isActor: boolean;
}

/** The diagram body is an ordered event stream; layout walks it top-down assigning rows. */
export type SeqEvent =
  | { kind: "message"; from: string; to: string; text: string; line: MessageLine; head: MessageHead; activate: boolean; deactivate: boolean }
  | { kind: "note"; placement: "left" | "right" | "over"; participants: string[]; text: string }
  | { kind: "activate"; participant: string }
  | { kind: "deactivate"; participant: string }
  | { kind: "fragment-start"; fragKind: FragmentKind; label: string }
  | { kind: "fragment-else"; label: string }
  | { kind: "fragment-end" };

export type FragmentKind = "loop" | "alt" | "opt" | "par" | "break" | "critical";

export interface SequenceDiagram {
  participants: Participant[];
  events: SeqEvent[];
}

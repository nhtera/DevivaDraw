/**
 * Turns a single node token — `A[label]`, `A([stadium])`, `A(((double)))`, bare `A`, or the v11
 * typed form `A@{ shape: rounded, label: "x" }` — into `{ id, shape, label }`. Delimiter matching is
 * longest-first so `[[`, `[(`, `(((` win over their shorter prefixes, and the parallelogram/trapezoid
 * pairs are disambiguated by their *closing* delimiter. Never throws: an unparseable token yields the
 * id as a bare rectangle, or null when there is no id at all.
 */
import type { NodeShape } from "./flowchart-ir";

export interface NodeToken {
  id: string;
  shape: NodeShape;
  /** undefined when the token is a bare id reference (no explicit label/shape). */
  label?: string;
}

/** [open, close, shape], ordered so a longer/ambiguous wrapper is tested before its prefix. */
const DELIMITERS: [string, string, NodeShape][] = [
  ["(((", ")))", "double-circle"],
  ["[[", "]]", "subroutine"],
  ["[(", ")]", "cylinder"],
  ["([", "])", "stadium"],
  ["[/", "/]", "parallelogram"],
  ["[\\", "\\]", "parallelogram-alt"],
  ["[/", "\\]", "trapezoid"],
  ["[\\", "/]", "trapezoid-alt"],
  ["((", "))", "circle"],
  ["{{", "}}", "hexagon"],
  ["[", "]", "rectangle"],
  ["(", ")", "rounded"],
  ["{", "}", "diamond"],
];

const V11_SHAPE_MAP: Record<string, NodeShape> = {
  rect: "rectangle",
  rectangle: "rectangle",
  rounded: "rounded",
  stadium: "stadium",
  pill: "stadium",
  subroutine: "subroutine",
  subprocess: "subroutine",
  cylinder: "cylinder",
  cyl: "cylinder",
  database: "cylinder",
  db: "cylinder",
  circle: "circle",
  circ: "circle",
  "double-circle": "double-circle",
  doublecircle: "double-circle",
  diamond: "diamond",
  diam: "diamond",
  decision: "diamond",
  hexagon: "hexagon",
  hex: "hexagon",
  parallelogram: "parallelogram",
  lean_r: "parallelogram",
  "lean-r": "parallelogram",
  "lean_l": "parallelogram-alt",
  trapezoid: "trapezoid",
  trap_b: "trapezoid",
  trapezoid_alt: "trapezoid-alt",
};

/** Normalizes label text: `<br>` → newline, HTML tags stripped, markdown backticks removed, quotes trimmed. */
export function cleanLabel(raw: string): string {
  let text = raw.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .trim();
}

/** Parses the v11 `@{ shape: x, label: "y" }` attribute form. Returns null if it isn't that form. */
function parseTypedShape(id: string, body: string): NodeToken | null {
  const token: NodeToken = { id, shape: "rectangle" };
  for (const pair of body.split(",")) {
    const colon = pair.indexOf(":");
    if (colon === -1) continue;
    const key = pair.slice(0, colon).trim().toLowerCase();
    const value = cleanLabel(pair.slice(colon + 1));
    if (key === "shape") token.shape = V11_SHAPE_MAP[value.toLowerCase()] ?? "rectangle";
    else if (key === "label" || key === "title") token.label = value;
  }
  return token;
}

/** Matches the wrapped-label forms (`A[...]`, `A(...)`, ...) by longest-first open+close delimiter. */
function parseWrapped(id: string, rest: string): NodeToken | null {
  for (const [open, close, shape] of DELIMITERS) {
    if (rest.length >= open.length + close.length && rest.startsWith(open) && rest.endsWith(close)) {
      return { id, shape, label: cleanLabel(rest.slice(open.length, rest.length - close.length)) };
    }
  }
  return null;
}

export function parseNodeToken(raw: string): NodeToken | null {
  const token = raw.trim().replace(/:::[A-Za-z0-9_-]+$/, ""); // trailing `:::class` handled by caller
  const idMatch = token.match(/^([A-Za-z0-9_]+)/);
  if (!idMatch) return null;
  const id = idMatch[1]!;
  const rest = token.slice(id.length).trim();
  if (!rest) return { id, shape: "rectangle" };

  const typed = rest.match(/^@\{(.+)\}$/);
  if (typed) return parseTypedShape(id, typed[1]!);

  return parseWrapped(id, rest) ?? { id, shape: "rectangle" };
}

/** Extracts trailing `:::class` names from a node token, returning the base token and the classes. */
export function extractInlineClasses(raw: string): { base: string; classes: string[] } {
  const classes: string[] = [];
  let base = raw.trim();
  let match = base.match(/:::([A-Za-z0-9_-]+)\s*$/);
  while (match) {
    classes.unshift(match[1]!);
    base = base.slice(0, match.index).trim();
    match = base.match(/:::([A-Za-z0-9_-]+)\s*$/);
  }
  return { base, classes };
}

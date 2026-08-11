/**
 * Splits a flowchart statement into node groups and the connectors between them, so the caller can
 * cartesian-expand chained (`A --> B --> C`) and multi-target (`A & B --> C & D`) edges. The scanner
 * reads node tokens with balanced, quote-aware bracket matching — labels may contain `-`, `>`, `|`,
 * etc. without being mistaken for link syntax — then matches the connector operator (plain, pipe
 * `|label|`, or middle `-- label -->`) and derives its heads, kind, length, and label.
 */
import type { EdgeKind, Head } from "./flowchart-ir";
import { cleanLabel } from "./tokenize-node";

export interface Connector {
  startHead: Head;
  endHead: Head;
  kind: EdgeKind;
  label?: string;
  minlen: number;
}

export interface EdgeStatement {
  /** Each group is one `&`-separated set of raw node-token strings. */
  groups: string[][];
  /** Length is `groups.length - 1`. */
  connectors: Connector[];
}

const HEAD: Record<string, Head> = { ">": "arrow", "<": "arrow", o: "circle", x: "cross" };

const MIDDLE = /^\s*([<ox]?)([-.=~]+)[ \t]+([^|]+?)[ \t]+([-.=~]+)([>ox]?)\s*/;
const PIPE = /^\s*([<ox]?)([-.=~]+)([>ox]?)\s*\|([^|]*)\|\s*/;
const PLAIN = /^\s*([<ox]?)([-.=~]+)([>ox]?)\s*/;

/** Scans from an opening bracket to just past its matching close, tracking depth and quotes. */
function scanBalanced(s: string, i: number, openCh: string, closeCh: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === openCh) depth++;
    else if (c === closeCh && --depth === 0) return i + 1;
  }
  return s.length; // unbalanced → consume the rest
}

/** Reads one node token (id + optional shape wrapper) starting at `pos`. */
function readNodeToken(s: string, pos: number): { raw: string; end: number } | null {
  while (pos < s.length && /\s/.test(s[pos]!)) pos++;
  const idMatch = /^[A-Za-z0-9_]+/.exec(s.slice(pos));
  if (!idMatch) return null;
  let end = pos + idMatch[0].length;
  const open = s[end];
  if (open === "@" && s[end + 1] === "{") end = scanBalanced(s, end + 1, "{", "}");
  else if (open === "[") end = scanBalanced(s, end, "[", "]");
  else if (open === "(") end = scanBalanced(s, end, "(", ")");
  else if (open === "{") end = scanBalanced(s, end, "{", "}");
  // Absorb trailing inline classes (`:::hot`) so they don't sit between the node and its connector.
  const inlineClass = /^(?::::[A-Za-z0-9_-]+)+/.exec(s.slice(end));
  if (inlineClass) end += inlineClass[0].length;
  return { raw: s.slice(pos, end).trim(), end };
}

/** Reads a node group: one token, then any `& token` repetitions. */
function readGroup(s: string, pos: number): { tokens: string[]; end: number } | null {
  const first = readNodeToken(s, pos);
  if (!first) return null;
  const tokens = [first.raw];
  let end = first.end;
  for (;;) {
    let p = end;
    while (p < s.length && /\s/.test(s[p]!)) p++;
    if (s[p] !== "&") break;
    const next = readNodeToken(s, p + 1);
    if (!next) break;
    tokens.push(next.raw);
    end = next.end;
  }
  return { tokens, end };
}

function buildConnector(startHead: string, body: string, endHead: string, label?: string): Connector {
  const chars = body;
  const kind: EdgeKind = chars.includes("~")
    ? "invisible"
    : chars.includes(".")
      ? "dotted"
      : chars.includes("=")
        ? "thick"
        : startHead || endHead
          ? "arrow"
          : "open";
  const dashes = (body.match(/[-=]/g) ?? []).length;
  return {
    startHead: HEAD[startHead] ?? "none",
    endHead: HEAD[endHead] ?? "none",
    kind,
    label: label !== undefined ? cleanLabel(label) : undefined,
    minlen: Math.max(1, dashes - 1),
  };
}

/** Matches a connector operator at `pos`; returns the connector and the index after it. */
function matchConnector(s: string, pos: number): { conn: Connector; end: number } | null {
  const sub = s.slice(pos);
  const mid = MIDDLE.exec(sub);
  if (mid) return { conn: buildConnector(mid[1]!, mid[2]! + mid[4]!, mid[5]!, mid[3]), end: pos + mid[0].length };
  const pipe = PIPE.exec(sub);
  if (pipe) return { conn: buildConnector(pipe[1]!, pipe[2]!, pipe[3]!, pipe[4]), end: pos + pipe[0].length };
  const plain = PLAIN.exec(sub);
  if (plain) return { conn: buildConnector(plain[1]!, plain[2]!, plain[3]!), end: pos + plain[0].length };
  return null;
}

/** Parses a statement into node groups + connectors, or null if no node token is present. */
export function parseStatement(line: string): EdgeStatement | null {
  const first = readGroup(line, 0);
  if (!first) return null;
  const groups = [first.tokens];
  const connectors: Connector[] = [];
  let pos = first.end;
  for (;;) {
    const conn = matchConnector(line, pos);
    if (!conn) break;
    const group = readGroup(line, conn.end);
    if (!group) break;
    connectors.push(conn.conn);
    groups.push(group.tokens);
    pos = group.end;
  }
  return { groups, connectors };
}

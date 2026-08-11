/**
 * Detects a Mermaid diagram's type from its first meaningful keyword so `mermaidToElements` can route
 * to the right pipeline. Skips a leading YAML front-matter block and `%%` comments/init directives.
 *
 * Natively convertible types (→ editable shapes): flowchart, class, ER, sequence, state. A known set of
 * types we don't natively convert (pie, gantt, gitGraph, …) resolves to `"unsupported"` so the caller
 * can rasterize them via the lazy-loaded fallback instead of silently mangling them. Anything genuinely
 * unrecognized still falls back to `flowchart` (the most-common paste) for a best-effort render.
 */
export type DiagramType = "flowchart" | "class" | "er" | "sequence" | "state" | "unsupported";

/** Types Mermaid supports that Deviva does not natively convert — rendered as an image by the caller. */
const UNSUPPORTED = [
  "pie",
  "gantt",
  "gitGraph",
  "gitgraph",
  "mindmap",
  "journey",
  "quadrantChart",
  "timeline",
  "sankey-beta",
  "xychart-beta",
  "requirementDiagram",
  "block-beta",
  "packet-beta",
  "kanban",
  "architecture-beta",
  "zenuml",
  "C4Context",
  "C4Container",
  "C4Component",
  "C4Dynamic",
  "C4Deployment",
];

export function detectDiagramType(source: string): DiagramType {
  const lines = source.split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i]!.trim() !== "---") i++;
    i++; // skip the closing fence
  }
  for (; i < lines.length; i++) {
    const line = lines[i]!.replace(/%%\{[^}]*\}%%/g, "").replace(/\s*%%.*$/, "").trim();
    if (!line) continue;
    if (/^classDiagram\b/i.test(line)) return "class";
    if (/^erDiagram\b/i.test(line)) return "er";
    if (/^sequenceDiagram\b/i.test(line)) return "sequence";
    if (/^stateDiagram(-v2)?\b/i.test(line)) return "state";
    const keyword = line.match(/^[A-Za-z0-9-]+/)?.[0] ?? "";
    if (UNSUPPORTED.some((u) => u.toLowerCase() === keyword.toLowerCase())) return "unsupported";
    return "flowchart";
  }
  return "flowchart";
}

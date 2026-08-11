/**
 * Detects a Mermaid diagram's type from its first meaningful keyword so `mermaidToElements` can route
 * to the right pipeline. Skips a leading YAML front-matter block and `%%` comments/init directives.
 * Anything that isn't `classDiagram`/`erDiagram` falls back to flowchart (the default, most-common
 * paste), so unknown types still get a best-effort render rather than an error.
 */
export type DiagramType = "flowchart" | "class" | "er";

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
    return "flowchart";
  }
  return "flowchart";
}

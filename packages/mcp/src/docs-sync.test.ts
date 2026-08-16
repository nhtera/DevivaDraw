/**
 * Docs-vs-registry drift gate (the cheap CI check the plan calls for): the tool reference in
 * `docs/mcp.md` must name every registered tool, and must not document tools that don't exist.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allTools } from "./tools/index";

const docsPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "mcp.md");

describe("docs/mcp.md tool reference", () => {
  const docs = readFileSync(docsPath, "utf8");
  const registered = new Set(allTools.map((tool) => tool.name));

  it("documents every registered tool", () => {
    for (const name of registered) {
      expect(docs, `docs/mcp.md is missing tool "${name}"`).toContain(`\`${name}\``);
    }
  });

  it("does not document tools that are not registered", () => {
    // Backticked snake_case identifiers in the doc that look like tool names must all exist.
    const mentioned = [...new Set([...docs.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((match) => match[1]!))];
    for (const name of mentioned) {
      expect(registered, `docs/mcp.md mentions unknown tool "${name}"`).toContain(name);
    }
  });
});

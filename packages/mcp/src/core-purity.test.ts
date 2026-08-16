/**
 * Worker-safety guard for the `@deviva-draw/mcp/core` barrel: its ENTIRE package-local import
 * graph must stay free of `node:*` builtins and of the optional native canvas, or the Cloudflare
 * worker (which runs without `nodejs_compat`) breaks at deploy time. This static walk fails the
 * suite at the moment of the leak, not at the next worker deploy.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = dirname(fileURLToPath(import.meta.url));

/** Collects every package-local module reachable from `entry`, returning each file's forbidden imports. */
function walkImports(entry: string): Map<string, string[]> {
  const violations = new Map<string, string[]>();
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    const forbidden = [...source.matchAll(/from\s+"(node:[^"]+|@napi-rs\/[^"]+)"/g)].map((match) => match[1]!);
    if (forbidden.length > 0) violations.set(file, forbidden);
    for (const match of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
      queue.push(join(dirname(file), `${match[1]!}.ts`));
    }
  }
  expect(seen.size).toBeGreaterThan(5); // the walk actually traversed the graph
  return violations;
}

describe("@deviva-draw/mcp/core worker-safety", () => {
  it("keeps the core barrel's whole import graph free of node builtins and the native canvas", () => {
    const violations = walkImports(join(srcDir, "core.ts"));
    expect(Object.fromEntries(violations)).toEqual({});
  });
});

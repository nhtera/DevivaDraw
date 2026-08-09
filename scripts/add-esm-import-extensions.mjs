#!/usr/bin/env node
/**
 * tsc emits relative import/export specifiers exactly as written in source
 * (e.g. `from "./scene/scene"`) because the workspace's dev tsconfig uses
 * `moduleResolution: "bundler"`, which allows extensionless specifiers.
 * Plain Node ESM (what a published package's dist/ is loaded with) requires
 * an explicit file extension on relative specifiers, so this walks a build
 * output directory and appends ".js" to every relative import/export/
 * dynamic-import specifier that doesn't already end in a known extension.
 *
 * Runs against both .js (runtime) and .d.ts (types) output — TypeScript's
 * Node16/NodeNext-aware resolution maps a ".js" specifier in a .d.ts file
 * back to the sibling ".d.ts" file automatically, so the same rewrite is
 * correct for declarations too.
 *
 * Usage: node add-esm-import-extensions.mjs <dist-dir>
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const KNOWN_EXTENSIONS = /\.(m?js|cjs|json|node)$/i;
const SPECIFIER_PATTERN = /((?:from|import)\s*\(?\s*)(["'])(\.[^"'\n]+)\2/g;

function addExtensionIfMissing(specifier) {
  if (!specifier.startsWith(".")) return specifier; // only touch relative specifiers
  if (KNOWN_EXTENSIONS.test(specifier)) return specifier;
  return `${specifier}.js`;
}

function rewriteFile(filePath) {
  const original = readFileSync(filePath, "utf8");
  const rewritten = original.replace(
    SPECIFIER_PATTERN,
    (_match, prefix, quote, specifier) => `${prefix}${quote}${addExtensionIfMissing(specifier)}${quote}`,
  );
  if (rewritten !== original) {
    writeFileSync(filePath, rewritten, "utf8");
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath);
      continue;
    }
    const ext = extname(fullPath);
    const isDeclaration = fullPath.endsWith(".d.ts");
    if (ext === ".js" || isDeclaration) {
      rewriteFile(fullPath);
    }
  }
}

const targetDir = process.argv[2];
if (!targetDir) {
  console.error("Usage: node add-esm-import-extensions.mjs <dist-dir>");
  process.exit(1);
}
walk(targetDir);

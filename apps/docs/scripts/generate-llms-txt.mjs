/**
 * Emits dist/llms.txt (index) and dist/llms-full.txt (full content) per llmstxt.org
 * from the hand-written docs pages. Runs after `astro build` (see the build script).
 * The community Starlight plugin can't render pages containing framework islands
 * (our live canvas demos), so this stays a ~60-line script instead.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = 'https://docs-draw.deviva.app';

// Hand-curated order mirroring the sidebar; API reference is excluded (700 generated
// pages would drown the signal) and linked once instead.
const pages = [
  'src/content/docs/quick-start.mdx',
  'src/content/docs/installation.mdx',
  'src/content/docs/guides/react-component.mdx',
  'src/content/docs/guides/presenting.mdx',
  'src/content/docs/guides/touch-and-input.mdx',
  'src/content/docs/guides/engine.mdx',
  'src/content/docs/guides/collaboration.mdx',
  'src/content/docs/guides/mcp.mdx',
  'src/content/docs/guides/desktop.mdx',
  'src/content/docs/guides/export-embed.mdx',
];

function parse(file) {
  const raw = readFileSync(join(root, file), 'utf8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const frontmatter = Object.fromEntries(
    match[1]
      .split('\n')
      .map((line) => line.match(/^(\w+):\s*(.*)$/))
      .filter(Boolean)
      .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, '')]),
  );
  // Strip MDX imports and island/component tags from PROSE ONLY — fenced code blocks
  // must ship verbatim (a naive whole-body regex would gut the `import`/JSX example code).
  let inFence = false;
  const body = match[2]
    .split('\n')
    .filter((line) => {
      if (line.trimStart().startsWith('```')) {
        inFence = !inFence;
        return true;
      }
      if (inFence) return true;
      return !/^import .*$/.test(line) && !/^<\/?[A-Z][^>\n]*\/?>\s*$/.test(line);
    })
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();
  const url = `${site}/${file.replace('src/content/docs/', '').replace(/\.mdx$/, '/')}`;
  return { ...frontmatter, body, url };
}

const parsed = pages.map(parse);

const index = [
  '# Deviva Draw',
  '',
  '> Open-source infinite-canvas whiteboard SDK: a complete React component, a zero-dependency engine, E2E-encrypted collaboration, and an MCP server for AI agents. MIT licensed.',
  '',
  '## Docs',
  '',
  ...parsed.map((p) => `- [${p.title}](${p.url}): ${p.description}`),
  '',
  '## Reference',
  '',
  `- [API reference](${site}/api/react/readme/): generated from TypeScript source for @deviva-draw/react and @deviva-draw/engine`,
  `- [Live app](https://draw.deviva.app): the SDK running as a full product`,
  '',
].join('\n');

const full = [
  index,
  '',
  ...parsed.flatMap((p) => [`---`, ``, `# ${p.title}`, ``, p.body, ``]),
].join('\n');

const dist = join(root, 'dist');
if (!existsSync(dist)) {
  throw new Error('dist/ not found: run `astro build` before generate-llms-txt.mjs');
}
writeFileSync(join(dist, 'llms.txt'), `${index}\n`);
writeFileSync(join(dist, 'llms-full.txt'), `${full}\n`);
console.log(`wrote dist/llms.txt (${index.length}B) and dist/llms-full.txt (${full.length}B)`);

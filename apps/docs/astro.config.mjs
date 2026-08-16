// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import { createStarlightTypeDocPlugin } from 'starlight-typedoc';
import react from '@astrojs/react';

// One plugin instance per package so each gets its own entry points, tsconfig,
// output directory, and sidebar group.
const [reactTypeDoc, reactTypeDocSidebarGroup] = createStarlightTypeDocPlugin();
const [engineTypeDoc, engineTypeDocSidebarGroup] = createStarlightTypeDocPlugin();

// https://astro.build/config
export default defineConfig({
  site: 'https://docs-draw.deviva.app',
  integrations: [
    starlight({
      title: 'Deviva Draw',
      logo: { src: './src/assets/logo.svg', alt: '' },
      components: {
        // Adds the "Open App" header CTA in front of the social icon links.
        SocialIcons: './src/components/header-links.astro',
      },
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://docs-draw.deviva.app/og-default.png' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
      ],
      customCss: [
        '@fontsource-variable/geist',
        '@fontsource-variable/geist-mono',
        './src/styles/theme.css',
        './src/styles/canvas-demo.css',
      ],
      plugins: [
        starlightLinksValidator(),
        reactTypeDoc({
          entryPoints: ['../../packages/react/src/index.ts'],
          tsconfig: '../../packages/react/tsconfig.json',
          output: 'api/react',
          sidebar: { label: '@deviva-draw/react' },
        }),
        engineTypeDoc({
          entryPoints: ['../../packages/engine/src/index.ts'],
          tsconfig: '../../packages/engine/tsconfig.json',
          output: 'api/engine',
          sidebar: { label: '@deviva-draw/engine' },
        }),
      ],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/nhtera/DevivaDraw' },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Quick Start', slug: 'quick-start' },
            { label: 'Installation', slug: 'installation' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'The React Component', slug: 'guides/react-component' },
            { label: 'The Engine', slug: 'guides/engine' },
            { label: 'Collaboration', slug: 'guides/collaboration' },
            { label: 'MCP for AI Agents', slug: 'guides/mcp' },
            { label: 'Desktop App', slug: 'guides/desktop' },
            { label: 'Export & Share', slug: 'guides/export-embed' },
          ],
        },
        {
          label: 'API Reference',
          items: [reactTypeDocSidebarGroup, engineTypeDocSidebarGroup],
        },
      ],
    }),
    react(),
  ],
});

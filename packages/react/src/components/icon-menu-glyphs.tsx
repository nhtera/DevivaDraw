/**
 * Self-authored SVG glyphs for the menu / action icons that were previously Unicode *emoji* (a
 * colorful 🗑 🔒 👁 📊 📄 📂 💾 🖼 🔍 🔗 👥), so the whole chrome reads as one monochrome icon set
 * instead of mixing line icons with OS-rendered color emoji. Same clean-room, `currentColor`,
 * `viewBox="0 0 20 20"` contract as `icon-style-glyphs.tsx`/`icon-tool-glyphs.tsx`; `Icon` consults all
 * three maps. Remaining glyphs in `icon.tsx` (☰ ✕ ⋯ ⌘ ⧉ …) are already monochrome symbols and stay.
 */
import type { ReactNode } from "react";

export const MENU_GLYPHS: Record<string, ReactNode> = {
  // Undo/redo as clean rounded arc-arrows (replacing the earlier ↶/↷ Unicode glyphs, which rendered
  // as thin off-center hooks): a left-pointing arrowhead whose shaft curls down and around, mirrored
  // for redo — the same affordance tldraw's toolbar shows.
  undo: (
    <>
      <path d="M6.5 6 L3.5 9 L6.5 12" />
      <path d="M3.5 9 H11 A5 5 0 0 1 16 14" />
    </>
  ),
  redo: (
    <>
      <path d="M13.5 6 L16.5 9 L13.5 12" />
      <path d="M16.5 9 H9 A5 5 0 0 0 4 14" />
    </>
  ),
  // Theme picker glyphs: a sun (light), a crescent moon (dark), a monitor (follow system).
  "theme-light": (
    <>
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 3 V4.8 M10 15.2 V17 M3 10 H4.8 M15.2 10 H17 M5.05 5.05 L6.3 6.3 M13.7 13.7 L14.95 14.95 M14.95 5.05 L13.7 6.3 M6.3 13.7 L5.05 14.95" strokeLinecap="round" />
    </>
  ),
  "theme-dark": <path d="M15.5 11.3 A6 6 0 1 1 8.7 4.5 A4.6 4.6 0 0 0 15.5 11.3 Z" strokeLinejoin="round" />,
  "theme-system": (
    <>
      <rect x="3" y="4.5" width="14" height="9" rx="1.5" />
      <path d="M7.5 16.5 H12.5 M10 13.5 V16.5" strokeLinecap="round" />
    </>
  ),
  // A clean downward chevron — the custom dropdown indicator for the language <select>.
  "chevron-down": <path d="M5.5 8 L10 12.5 L14.5 8" strokeLinecap="round" strokeLinejoin="round" />,
  "chevron-up": <path d="M5.5 12 L10 7.5 L14.5 12" strokeLinecap="round" strokeLinejoin="round" />,
  // The GitHub mark, filled (the 24-unit official silhouette scaled into the shared 20-unit viewBox).
  github: (
    <g transform="scale(0.8333)" fill="currentColor" stroke="none">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </g>
  ),
  // A 2x2 grid of tiles — the "component library" mark.
  library: (
    <>
      <rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1" />
      <rect x="11" y="3.5" width="5.5" height="5.5" rx="1" />
      <rect x="3.5" y="11" width="5.5" height="5.5" rx="1" />
      <rect x="11" y="11" width="5.5" height="5.5" rx="1" />
    </>
  ),
  // Two interlocking chain links — the universal "hyperlink" mark.
  link: (
    <>
      <path d="M8.5 11.5 A2.5 2.5 0 0 1 8.5 8 L11 5.5 A2.5 2.5 0 0 1 14.5 9 L13.2 10.3" strokeLinecap="round" />
      <path d="M11.5 8.5 A2.5 2.5 0 0 1 11.5 12 L9 14.5 A2.5 2.5 0 0 1 5.5 11 L6.8 9.7" strokeLinecap="round" />
    </>
  ),
  // A box with an arrow leaving it — the "opens in a new tab" affordance for external links.
  "external-link": (
    <>
      <path d="M11 4 H5.5 A1.5 1.5 0 0 0 4 5.5 V14.5 A1.5 1.5 0 0 0 5.5 16 H14.5 A1.5 1.5 0 0 0 16 14.5 V9" />
      <path d="M12.5 4 H16 V7.5" />
      <path d="M16 4 L9.5 10.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 6 H16" />
      <path d="M8 6 V4.5 H12 V6" />
      <path d="M6 6 L6.7 16.5 H13.3 L14 6" />
      <path d="M9 9.5 V13.5 M11 9.5 V13.5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
      <path d="M7 9 V6.5 A3 3 0 0 1 13 6.5 V9" />
    </>
  ),
  "view-only": (
    <>
      <path d="M2.5 10 C5.5 5.5 14.5 5.5 17.5 10 C14.5 14.5 5.5 14.5 2.5 10 Z" />
      <circle cx="10" cy="10" r="2.3" />
    </>
  ),
  stats: (
    <>
      <path d="M4 4 V16 H16" />
      <rect x="6" y="10" width="2.4" height="4" fill="currentColor" stroke="none" />
      <rect x="9.8" y="7" width="2.4" height="7" fill="currentColor" stroke="none" />
      <rect x="13.6" y="11.5" width="2.4" height="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  file: (
    <>
      <path d="M6 3 H12 L15 6 V17 H6 Z" />
      <path d="M12 3 V6 H15" />
    </>
  ),
  "folder-open": <path d="M3 6 H8 L10 8 H16.5 V15.5 H3 Z" />,
  save: (
    <>
      <path d="M4.5 4 H13 L16 7 V16 H4.5 Z" />
      <path d="M7 4 V7.5 H12.5 V4" />
      <rect x="7" y="11" width="5.5" height="5" />
    </>
  ),
  // Both PNG and SVG export share the "picture" motif (they shared 🖼 before).
  "export-png": (
    <>
      <rect x="3" y="4.5" width="14" height="11" rx="1.5" />
      <circle cx="7.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M4 14 L8 10 L11 13 L13.5 10.5 L16 13" />
    </>
  ),
  "export-svg": (
    <>
      <rect x="3" y="4.5" width="14" height="11" rx="1.5" />
      <circle cx="7.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M4 14 L8 10 L11 13 L13.5 10.5 L16 13" />
    </>
  ),
  search: (
    <>
      <circle cx="9" cy="9" r="5" />
      <line x1="12.8" y1="12.8" x2="17" y2="17" />
    </>
  ),
  share: (
    <>
      <circle cx="6" cy="10" r="2.3" />
      <circle cx="14" cy="5.5" r="2.3" />
      <circle cx="14" cy="14.5" r="2.3" />
      <line x1="8" y1="8.9" x2="12" y2="6.6" />
      <line x1="8" y1="11.1" x2="12" y2="13.4" />
    </>
  ),
  users: (
    <>
      <circle cx="8" cy="7.5" r="2.4" />
      <path d="M3.5 16 C3.5 12.3 12.5 12.3 12.5 16" />
      <circle cx="14.5" cy="8" r="1.9" />
      <path d="M13.2 12.2 C16.6 12.2 16.8 14.3 16.8 16" />
    </>
  ),
};

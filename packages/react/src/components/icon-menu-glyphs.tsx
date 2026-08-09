/**
 * Self-authored SVG glyphs for the menu / action icons that were previously Unicode *emoji* (a
 * colorful 🗑 🔒 👁 📊 📄 📂 💾 🖼 🔍 🔗 👥), so the whole chrome reads as one monochrome icon set
 * instead of mixing line icons with OS-rendered color emoji. Same clean-room, `currentColor`,
 * `viewBox="0 0 20 20"` contract as `icon-style-glyphs.tsx`/`icon-tool-glyphs.tsx`; `Icon` consults all
 * three maps. Remaining glyphs in `icon.tsx` (☰ ✕ ⋯ ⌘ ⧉ …) are already monochrome symbols and stay.
 */
import type { ReactNode } from "react";

export const MENU_GLYPHS: Record<string, ReactNode> = {
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

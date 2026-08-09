/**
 * Self-authored SVG glyphs for the primary toolbar tools, replacing the earlier Unicode/emoji symbols
 * (a colorful ✋ hand and ✎ pencil looked out of place next to the monochrome geometric tools). Same
 * clean-room, `currentColor`, `viewBox="0 0 20 20"` contract as `icon-style-glyphs.tsx`; `Icon`
 * consults both maps. `text` stays a plain "T" letter (crisper than any traced glyph), so it is
 * deliberately absent here.
 */
import type { ReactNode } from "react";

export const TOOL_GLYPHS: Record<string, ReactNode> = {
  cursor: <path d="M5 4 L5 16 L8.5 12.5 L11 17 L13 16 L10.5 11.5 L15 11 Z" fill="currentColor" stroke="currentColor" strokeWidth="0.6" strokeLinejoin="round" />,
  // "Pan" reads clearest as a 4-way move glyph rather than a traced hand.
  hand: (
    <>
      <path d="M10 3 V17 M3 10 H17" strokeWidth="1.4" />
      <path d="M10 3 L8 5 M10 3 L12 5 M10 17 L8 15 M10 17 L12 15 M3 10 L5 8 M3 10 L5 12 M17 10 L15 8 M17 10 L15 12" strokeWidth="1.4" />
    </>
  ),
  rectangle: <rect x="3.5" y="5.5" width="13" height="9" rx="1.5" />,
  ellipse: <circle cx="10" cy="10" r="6.5" />,
  diamond: <path d="M10 3 L17 10 L10 17 L3 10 Z" />,
  line: <line x1="4" y1="15.5" x2="16" y2="4.5" />,
  arrow: (
    <>
      <line x1="3.5" y1="10" x2="15.5" y2="10" />
      <path d="M11.5 6 L16 10 L11.5 14" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 16 L4.5 12.5 L13 4 L16 7 L7.5 15.5 Z" />
      <line x1="11" y1="6" x2="14" y2="9" />
    </>
  ),
  // An angled eraser block sitting on the canvas line it's rubbing out.
  eraser: (
    <>
      <path d="M9 15.5 L4.5 11 L11 4.5 L15.5 9 Z" strokeLinejoin="round" />
      <line x1="7" y1="16.5" x2="16.5" y2="16.5" strokeWidth="1.4" />
    </>
  ),
  // A framed picture: a sun in the corner and a mountain range, the universal "image" mark.
  image: (
    <>
      <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" />
      <circle cx="7.5" cy="8" r="1.2" />
      <path d="M4 14 L8 10 L11 13 L13 11 L16 14" strokeLinejoin="round" />
    </>
  ),
  // A pointer beam: a filled dot with radiating rays, reading as a laser point.
  laser: (
    <>
      <circle cx="10" cy="10" r="2.4" fill="currentColor" stroke="none" />
      <path d="M10 3 V5.5 M10 14.5 V17 M3 10 H5.5 M14.5 10 H17 M5.4 5.4 L7.1 7.1 M12.9 12.9 L14.6 14.6 M14.6 5.4 L12.9 7.1 M7.1 12.9 L5.4 14.6" strokeLinecap="round" />
    </>
  ),
};

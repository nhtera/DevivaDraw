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
  triangle: <path d="M10 3.5 L16.5 16 L3.5 16 Z" strokeLinejoin="round" />,
  hexagon: <path d="M6 4 L14 4 L17.5 10 L14 16 L6 16 L2.5 10 Z" strokeLinejoin="round" />,
  star: <path d="M10 2.5 L12.2 7.8 L18 8.3 L13.6 12 L15 17.5 L10 14.4 L5 17.5 L6.4 12 L2 8.3 L7.8 7.8 Z" strokeLinejoin="round" />,
  cloud: <path d="M6 15 A3.2 3.2 0 0 1 6 8.7 A4 4 0 0 1 13.5 8 A3.3 3.3 0 0 1 14 15 Z" strokeLinejoin="round" />,
  heart: <path d="M10 16 C4 11.5 3.5 7.5 6.2 6 C8.2 4.9 10 6.5 10 7.8 C10 6.5 11.8 4.9 13.8 6 C16.5 7.5 16 11.5 10 16 Z" strokeLinejoin="round" />,
  "x-box": (
    <>
      <rect x="3.5" y="3.5" width="13" height="13" rx="1.5" />
      <path d="M6.5 6.5 L13.5 13.5 M13.5 6.5 L6.5 13.5" />
    </>
  ),
  "check-box": (
    <>
      <rect x="3.5" y="3.5" width="13" height="13" rx="1.5" />
      <path d="M6 10.2 L9 13 L14 6.5" strokeLinejoin="round" />
    </>
  ),
  // A folded-corner sticky note.
  note: (
    <>
      <path d="M4 4 H16 V12 L12 16 H4 Z" strokeLinejoin="round" />
      <path d="M16 12 H12 V16" strokeLinejoin="round" />
    </>
  ),
  "block-arrow-right": <path d="M3 8 H11 V5.5 L17 10 L11 14.5 V12 H3 Z" strokeLinejoin="round" />,
  "block-arrow-left": <path d="M17 8 H9 V5.5 L3 10 L9 14.5 V12 H17 Z" strokeLinejoin="round" />,
  "block-arrow-up": <path d="M8 17 V9 H5.5 L10 3 L14.5 9 H12 V17 Z" strokeLinejoin="round" />,
  "block-arrow-down": <path d="M8 3 V11 H5.5 L10 17 L14.5 11 H12 V3 Z" strokeLinejoin="round" />,
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
  // A tilted paint bucket tipping out a drop — the universal "fill" mark.
  bucket: (
    <>
      <path d="M4 9.5 L9.5 4 L15 9.5 L10.5 14 A2 2 0 0 1 8 14 Z" strokeLinejoin="round" />
      <line x1="7.2" y1="6.3" x2="9.5" y2="4" />
      <path d="M15.5 11 C16.5 12.5 16.8 13.6 15.9 14.3 C15.1 15 14 14.4 14.2 13.2 C14.3 12.4 15.5 11 15.5 11 Z" fill="currentColor" stroke="none" />
    </>
  ),
  // A pointer beam: a filled dot with radiating rays, reading as a laser point.
  laser: (
    <>
      <circle cx="10" cy="10" r="2.4" fill="currentColor" stroke="none" />
      <path d="M10 3 V5.5 M10 14.5 V17 M3 10 H5.5 M14.5 10 H17 M5.4 5.4 L7.1 7.1 M12.9 12.9 L14.6 14.6 M14.6 5.4 L12.9 7.1 M7.1 12.9 L5.4 14.6" strokeLinecap="round" />
    </>
  ),
  // A marker: an angled body like the pencil but with a broad chisel nib (the wide base line).
  highlighter: (
    <>
      <path d="M5 15 L5 12 L12.5 4.5 L15.5 7.5 L8 15 Z" strokeLinejoin="round" />
      <line x1="4.5" y1="16.5" x2="8.5" y2="16.5" strokeWidth="2.4" strokeLinecap="round" />
    </>
  ),
  // A dashed loop with a little tail — the lasso.
  lasso: (
    <>
      <path d="M10 4.5 C14.5 4.5 16.5 8 15 11 C13.5 14 6.5 14 5 11 C3.7 8.5 5.5 4.5 10 4.5 Z" strokeDasharray="2 2" />
      <path d="M6.2 12.8 L5.5 16.5" strokeLinecap="round" />
      <circle cx="5.5" cy="16.8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  // Corner brackets, the universal "frame" mark.
  frame: (
    <path
      d="M6 3.5 H3.5 V6 M14 3.5 H16.5 V6 M6 16.5 H3.5 V14 M14 16.5 H16.5 V14 M7.5 2 V18 M12.5 2 V18 M2 7.5 H18 M2 12.5 H18"
      strokeLinecap="round"
    />
  ),
  // A bordered grid with one interior column and row line: the table mark.
  table: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="1" />
      <path d="M3 9 H17 M9.5 4 V16" />
    </>
  ),
  // A speech bubble with a tail: the comment tool and every comment affordance in the chrome.
  comment: (
    <path
      d="M3.5 5 A1.5 1.5 0 0 1 5 3.5 H15 A1.5 1.5 0 0 1 16.5 5 V12 A1.5 1.5 0 0 1 15 13.5 H8.5 L5 17 V13.5 A1.5 1.5 0 0 1 3.5 12 Z"
      strokeLinejoin="round"
    />
  ),
  // A downward chevron: the "More tools" overflow toggle (the popover opens below the top toolbar).
  more: <path d="M5 8 L10 13 L15 8" strokeLinecap="round" strokeLinejoin="round" />,
};

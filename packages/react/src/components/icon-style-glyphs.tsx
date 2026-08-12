/**
 * Self-authored SVG glyphs for the properties-panel style controls (fill / stroke width / stroke
 * style / sloppiness / edges / arrowheads) — the cases where a Unicode symbol (`icon.tsx`'s glyph
 * table) can't legibly convey the choice: three line weights, a dashed vs dotted line, an increasingly
 * wavy stroke. Kept clean-room (drawn from scratch, not copied from any icon set) and in their own
 * module so `icon.tsx` stays a small table. Each entry is the SVG *inner* content; `Icon` wraps it in a
 * sized `<svg viewBox="0 0 20 20">` with `stroke="currentColor"` so every glyph inherits the button's
 * (theme-aware) text color. Per-glyph `strokeWidth`/`fill` overrides ride on the individual elements.
 */
import type { ReactNode } from "react";

export const STYLE_GLYPHS: Record<string, ReactNode> = {
  // Fill patterns
  "fill-hachure": (
    <>
      <path d="M4 12 L11 5" />
      <path d="M7 15 L15 7" />
      <path d="M11 16 L16 11" />
    </>
  ),
  "fill-cross-hatch": (
    <>
      <path d="M4 11 L11 4" />
      <path d="M8 16 L16 8" />
      <path d="M4 8 L12 16" />
      <path d="M9 5 L15 11" />
    </>
  ),
  "fill-solid": <rect x="4" y="4" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  "fill-zigzag": <path d="M4 13 L7 7 L10 13 L13 7 L16 13" />,
  // Stroke width
  "stroke-width-thin": <line x1="3" y1="10" x2="17" y2="10" strokeWidth="1.5" />,
  "stroke-width-bold": <line x1="3" y1="10" x2="17" y2="10" strokeWidth="3" />,
  "stroke-width-extra-bold": <line x1="3" y1="10" x2="17" y2="10" strokeWidth="5" />,
  // Stroke style
  "stroke-style-solid": <line x1="3" y1="10" x2="17" y2="10" strokeWidth="2" />,
  "stroke-style-dashed": <line x1="3" y1="10" x2="17" y2="10" strokeWidth="2" strokeDasharray="4 3" />,
  "stroke-style-dotted": <line x1="3" y1="10" x2="17" y2="10" strokeWidth="2.2" strokeDasharray="0.1 4" />,
  // Sloppiness (increasing wave amplitude)
  "sloppiness-architect": <path d="M3 10 Q7 9 10 10 T17 10" />,
  "sloppiness-artist": <path d="M3 10 Q6 6 9 10 T15 10" />,
  "sloppiness-cartoonist": <path d="M3 10 Q5 3 8 10 T13 10 T18 10" />,
  // Edges
  "edge-sharp": <path d="M5 15 L5 6 L15 6" strokeWidth="2" strokeLinejoin="miter" />,
  "edge-round": <path d="M5 15 L5 10 Q5 6 9 6 L15 6" strokeWidth="2" />,
  // Arrowheads
  "arrow-type-straight": <path d="M3 16 L17 4" />,
  "arrow-type-curved": <path d="M3 16 Q 10 4 17 4" />,
  "arrow-type-elbow": <path d="M3 16 H10 V4 H17" />,
  "arrowhead-none": <line x1="3" y1="10" x2="17" y2="10" strokeWidth="1.6" />,
  "arrowhead-arrow": (
    <>
      <line x1="3" y1="10" x2="17" y2="10" strokeWidth="1.6" />
      <path d="M12 6 L17 10 L12 14" />
    </>
  ),
  "arrowhead-triangle": (
    <>
      <line x1="3" y1="10" x2="11" y2="10" strokeWidth="1.6" />
      <path d="M11 6 L18 10 L11 14 Z" fill="currentColor" />
    </>
  ),
  "arrowhead-bar": (
    <>
      <line x1="3" y1="10" x2="16" y2="10" strokeWidth="1.6" />
      <line x1="16" y1="5" x2="16" y2="15" strokeWidth="1.6" />
    </>
  ),
  "arrowhead-dot": (
    <>
      <line x1="3" y1="10" x2="13" y2="10" strokeWidth="1.6" />
      <circle cx="16" cy="10" r="2.4" fill="currentColor" stroke="none" />
    </>
  ),
};

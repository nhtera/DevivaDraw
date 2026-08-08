/**
 * The chrome's icon set: a small self-authored glyph table (Unicode symbols, not custom SVG art) —
 * deliberately simple rather than a pixel-precise icon library, both for this phase's time budget and
 * to keep the chrome visually distinct from any other whiteboard app's icon set (clean-room
 * constraint: no copied iconography). Every `Action.icon` string maps to one entry here; an unknown
 * name renders a visible fallback glyph rather than silently rendering nothing, so a typo'd icon name
 * is obvious in the UI instead of invisible.
 */
const GLYPHS: Record<string, string> = {
  cursor: "⟡",
  hand: "✋",
  rectangle: "▭",
  ellipse: "◯",
  diamond: "◇",
  line: "╱",
  arrow: "→",
  pencil: "✎",
  text: "T",
  undo: "↶",
  redo: "↷",
  "select-all": "▤",
  copy: "⧉",
  paste: "⎘",
  duplicate: "⧉",
  trash: "🗑",
  "layer-front": "⤒",
  "layer-up": "↑",
  "layer-down": "↓",
  "layer-back": "⤓",
  "align-left": "⊢",
  "align-center-h": "⊥",
  "align-right": "⊣",
  "align-top": "⊤",
  "align-middle-v": "⊦",
  "align-bottom": "⊥",
  "distribute-h": "⇔",
  "distribute-v": "⇕",
  group: "⧈",
  ungroup: "⧇",
  lock: "🔒",
  "zoom-in": "+",
  "zoom-out": "−",
  "zoom-fit": "⤢",
  grid: "▦",
  theme: "◐",
  command: "⌘",
  zen: "◎",
  "view-only": "👁",
  stats: "📊",
  file: "📄",
  "folder-open": "📂",
  save: "💾",
  "export-png": "🖼",
  "export-svg": "🖼",
  "copy-image": "⎘",
  menu: "☰",
  close: "✕",
  search: "🔍",
  more: "⋯",
};

const FALLBACK_GLYPH = "?";

export interface IconProps {
  name: string;
  /** Font-size in px — the glyph scales as text, no fixed viewBox to manage. */
  size?: number;
}

export function Icon(props: IconProps) {
  const { name, size = 16 } = props;
  const glyph = GLYPHS[name] ?? FALLBACK_GLYPH;
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size, lineHeight: 1, width: size, height: size }}>
      {glyph}
    </span>
  );
}

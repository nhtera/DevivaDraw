/**
 * Pure formatter turning a normalized combo string (`@deviva-draw/engine`'s `normalizeCombo` output,
 * e.g. `"meta+shift+z"`) into a human-readable display string for tooltips/the shortcuts dialog —
 * platform-aware (⌘/⌥/⇧ on Mac, `Ctrl`/`Alt`/`Shift` elsewhere), with `isMac` passed in rather than
 * read from `navigator` directly so this stays a pure, fully unit-testable function.
 */
const MODIFIER_LABELS: Record<string, { mac: string; other: string }> = {
  ctrl: { mac: "⌃", other: "Ctrl" },
  meta: { mac: "⌘", other: "Ctrl" },
  alt: { mac: "⌥", other: "Alt" },
  shift: { mac: "⇧", other: "Shift" },
};

const KEY_LABELS: Record<string, string> = {
  "=": "+",
  "-": "−",
  " ": "Space",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  escape: "Esc",
  delete: "Del",
  backspace: "⌫",
};

function formatKeyToken(token: string): string {
  const lower = token.toLowerCase();
  if (KEY_LABELS[lower]) return KEY_LABELS[lower];
  return token.length === 1 ? token.toUpperCase() : token;
}

/**
 * `combo` is a `+`-joined lowercase token list, modifiers always ordered `ctrl, meta, alt, shift`
 * (see `normalizeCombo`'s own doc) with the literal key last. On Mac, `ctrl`+`meta` collapsing to the
 * same `⌃`/`⌘` glyph pair still reads unambiguously since the two are visually distinct symbols.
 */
export function formatShortcut(combo: string, isMac: boolean): string {
  const tokens = combo.split("+");
  const parts = tokens.map((token) => {
    const modifier = MODIFIER_LABELS[token];
    return modifier ? (isMac ? modifier.mac : modifier.other) : formatKeyToken(token);
  });
  return isMac ? parts.join("") : parts.join("+");
}

/** Detects Mac from a `navigator.platform`/`navigator.userAgent`-style string (injected for testability — real callers pass `navigator.platform`). */
export function detectIsMac(platformOrUserAgent: string | undefined): boolean {
  return /mac/i.test(platformOrUserAgent ?? "");
}

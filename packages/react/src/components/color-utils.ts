/**
 * Small, dependency-free color helpers for the color-picker popover: hex validation and a lightness
 * ramp ("shades") for the active color. Kept pure (no DOM) so they're unit-testable in the node vitest
 * environment. Only `#rgb`/`#rrggbb` are handled — the picker never deals in named colors except the
 * sentinel `"transparent"`, which callers special-case before reaching here.
 */

/** True for `#rgb` or `#rrggbb` (case-insensitive). */
export function isValidHex(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

/** Expands `#rgb` to `#rrggbb`; returns other valid hex unchanged and invalid input as-is. */
export function normalizeHex(value: string): string {
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const [, r, g, b] = value;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return value.toLowerCase();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!isValidHex(hex)) return null;
  const full = normalizeHex(hex);
  return { r: parseInt(full.slice(1, 3), 16), g: parseInt(full.slice(3, 5), 16), b: parseInt(full.slice(5, 7), 16) };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h / 6, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const SHADE_LIGHTNESS = [0.85, 0.68, 0.52, 0.38, 0.24] as const;

/**
 * A fixed 5-step lightness ramp of `hex`'s hue/saturation — the "shades" strip a picker shows for the
 * active color. Returns an empty array for `"transparent"` or any non-hex input (nothing to ramp).
 */
export function generateShades(hex: string): string[] {
  const rgb = hexToRgb(hex);
  if (!rgb) return [];
  const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return SHADE_LIGHTNESS.map((l) => hslToHex(h, s === 0 ? 0 : Math.max(s, 0.15), l));
}

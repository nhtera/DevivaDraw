/**
 * QR encoding for the share dialog, wrapped so the rest of the app imports THIS module rather than
 * the encoder directly — the one seam that lets the dependency be swapped for an in-house encoder
 * later without touching a component.
 *
 * Encoded locally, never through a QR-image web service: a share URL carries the scene's decryption
 * key in its fragment, so handing that URL to a third party to render would leak the very secret
 * the share link's client-side encryption exists to protect.
 *
 * The output is SVG path data rather than the library's own `createSvgTag()` markup string: a path
 * renders through JSX as ordinary elements (no `dangerouslySetInnerHTML`) and stays crisp at any
 * size. The caller supplies the colors, and deliberately does NOT theme them — see
 * `components/share-dialog.tsx`'s `ShareQrCode`.
 */
import qrcode from "qrcode-generator";

/** Quiet-zone width in modules. Four is the QR specification's minimum for reliable scanning. */
const QUIET_ZONE_MODULES = 4;

/**
 * Error-correction levels tried in order, most redundancy first. A higher level costs capacity, so a
 * long URL that will not fit at "M" is retried at "L" rather than failing — a scannable code with
 * less redundancy beats no code at all.
 */
const ERROR_CORRECTION_LEVELS = ["M", "L"] as const;

export interface QrCodeSvg {
  /** SVG path data covering every dark module, for a `viewBox` of `0 0 size size`. */
  path: string;
  /** Width/height of the code in modules, quiet zone included — use as the `viewBox` extent. */
  size: number;
}

/**
 * `text` as SVG path data, or `null` when it cannot be encoded at all (beyond even the largest
 * symbol's capacity, or an encoder failure). Callers render nothing in that case rather than
 * breaking the dialog around them — the copyable link is always the primary affordance, the QR is
 * an accelerator.
 */
export function encodeQrCodeSvg(text: string): QrCodeSvg | null {
  if (text.length === 0) return null;

  for (const level of ERROR_CORRECTION_LEVELS) {
    try {
      // Type number 0 asks the encoder to pick the smallest symbol version the data fits in.
      const code = qrcode(0, level);
      code.addData(text);
      code.make();
      return { path: pathDataFor(code), size: code.getModuleCount() + QUIET_ZONE_MODULES * 2 };
    } catch {
      // Capacity overflow at this level — fall through and retry with less redundancy.
    }
  }
  // Every level failed. Expected only for input beyond the largest symbol's capacity, but this also
  // catches an encoder integration breaking — logged so that shows up as a diagnosable event rather
  // than QR codes silently vanishing from the dialog for every link.
  console.warn(`deviva-draw: could not encode a QR code for a ${text.length}-character link`);
  return null;
}

/** One `M x y h1 v1 h-1 z` subpath per dark module, offset by the quiet zone. */
function pathDataFor(code: { getModuleCount(): number; isDark(row: number, col: number): boolean }): string {
  const count = code.getModuleCount();
  const parts: string[] = [];
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (code.isDark(row, col)) parts.push(`M${col + QUIET_ZONE_MODULES} ${row + QUIET_ZONE_MODULES}h1v1h-1z`);
    }
  }
  return parts.join("");
}

import { describe, expect, it, vi } from "vitest";
import qrcode from "qrcode-generator";
import { encodeQrCodeSvg } from "./qr-code";

/** Re-decodes the module grid from the produced path data, so assertions are about the CODE, not the string. */
function darkModulesFrom(path: string): Set<string> {
  const modules = new Set<string>();
  for (const match of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) modules.add(`${match[1]},${match[2]}`);
  return modules;
}

describe("encodeQrCodeSvg", () => {
  it("returns null for empty input rather than an empty symbol", () => {
    expect(encodeQrCodeSvg("")).toBeNull();
  });

  it("encodes a share-link-shaped URL into a square symbol with a quiet zone", () => {
    const url = "https://draw.deviva.app/#share=abc123def456,key=9f8e7d6c5b4a39281706";
    const result = encodeQrCodeSvg(url);

    expect(result).not.toBeNull();
    // Quiet zone is 4 modules a side, so the padded size exceeds the module count by exactly 8 —
    // and the smallest QR symbol is 21 modules, so anything at/below 21+8 means nothing was encoded.
    expect(result!.size).toBeGreaterThan(21 + 8 - 1);
    expect(result!.path.length).toBeGreaterThan(0);
  });

  it("matches the encoder's own module grid exactly, offset by the quiet zone", () => {
    const url = "https://draw.deviva.app/#share=abc123";
    const result = encodeQrCodeSvg(url)!;

    const reference = qrcode(0, "M");
    reference.addData(url);
    reference.make();

    const produced = darkModulesFrom(result.path);
    const count = reference.getModuleCount();
    let expectedDark = 0;
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (!reference.isDark(row, col)) continue;
        expectedDark += 1;
        expect(produced.has(`${col + 4},${row + 4}`), `module ${row},${col} missing from the path`).toBe(true);
      }
    }
    expect(produced.size).toBe(expectedDark); // no extra modules either
    expect(result.size).toBe(count + 8);
  });

  it("every dark module stays inside the viewBox the size reports", () => {
    const result = encodeQrCodeSvg("https://draw.deviva.app/#share=boundscheck")!;
    for (const key of darkModulesFrom(result.path)) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      expect(x).toBeGreaterThanOrEqual(4);
      expect(y).toBeGreaterThanOrEqual(4);
      expect(x).toBeLessThan(result.size - 4);
      expect(y).toBeLessThan(result.size - 4);
    }
  });

  it("falls back to lower error correction rather than failing on a very long URL", () => {
    // Longer than "M" can hold at any symbol version, still within "L" — the retry path.
    const long = `https://draw.deviva.app/#share=${"a".repeat(2400)}`;
    const result = encodeQrCodeSvg(long);

    expect(result).not.toBeNull();
    expect(result!.path.length).toBeGreaterThan(0);
  });

  it("returns null for input beyond even the largest symbol's capacity, and says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(encodeQrCodeSvg("x".repeat(10_000))).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1); // a diagnosable event, not a silent disappearance
    warn.mockRestore();
  });

  it("is deterministic — the same input always produces the same path", () => {
    const url = "https://draw.deviva.app/#share=deterministic";
    expect(encodeQrCodeSvg(url)).toEqual(encodeQrCodeSvg(url));
  });
});

import { describe, expect, it } from "vitest";
import { base64UrlToBytes, bytesToBase64Url } from "./base64url-bytes";

describe("bytesToBase64Url / base64UrlToBytes", () => {
  it("round-trips arbitrary byte sequences", () => {
    const original = new Uint8Array([0, 1, 2, 255, 254, 128, 127, 16, 32]);
    expect(base64UrlToBytes(bytesToBase64Url(original))).toEqual(original);
  });

  it("round-trips an empty byte array", () => {
    expect(base64UrlToBytes(bytesToBase64Url(new Uint8Array()))).toEqual(new Uint8Array());
  });

  it("produces no '+', '/', or '=' characters (safe to embed in a URL fragment unescaped)", () => {
    // 256 sequential byte values exercises every possible byte, and therefore every base64 alphabet
    // character the encoder could ever emit.
    const bytes = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) bytes[index] = index;
    const encoded = bytesToBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("round-trips random 32-byte keys and 12-byte IVs (the exact sizes encrypt-scene.ts produces)", () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    expect(base64UrlToBytes(bytesToBase64Url(key))).toEqual(key);
    expect(base64UrlToBytes(bytesToBase64Url(iv))).toEqual(iv);
  });
});

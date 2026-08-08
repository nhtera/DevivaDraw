import { describe, expect, it } from "vitest";
import { decryptEnvelope, encryptEnvelope, generateRoomKey, importRoomKey } from "./message-codec";

describe("generateRoomKey / importRoomKey", () => {
  it("produces a usable AES-GCM key round trip", async () => {
    const keyBase64Url = await generateRoomKey();
    const key = await importRoomKey(keyBase64Url);
    const envelope = await encryptEnvelope(key, "presence", { hello: "world" }, { compress: false });
    const decrypted = await decryptEnvelope(key, envelope, { compress: false });
    expect(decrypted).toEqual({ ok: true, payload: { hello: "world" } });
  });

  it("generates a different key on every call", async () => {
    const a = await generateRoomKey();
    const b = await generateRoomKey();
    expect(a).not.toBe(b);
  });
});

describe("encryptEnvelope / decryptEnvelope", () => {
  it("round trips a JSON payload through compression", async () => {
    const key = await importRoomKey(await generateRoomKey());
    const payload = { element: { id: "abc", version: 3, versionNonce: 42 } };
    const envelope = await encryptEnvelope(key, "element-delta", payload);
    expect(envelope.type).toBe("element-delta");
    const decrypted = await decryptEnvelope(key, envelope);
    expect(decrypted).toEqual({ ok: true, payload });
  });

  it("never reuses an IV across many encryptions with the same key", async () => {
    const key = await importRoomKey(await generateRoomKey());
    const ivs = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const envelope = await encryptEnvelope(key, "presence", { i });
      ivs.add(envelope.iv!);
    }
    expect(ivs.size).toBe(200);
  });

  it("fails closed when decrypting with the wrong key", async () => {
    const keyA = await importRoomKey(await generateRoomKey());
    const keyB = await importRoomKey(await generateRoomKey());
    const envelope = await encryptEnvelope(keyA, "element-delta", { x: 1 });
    const decrypted = await decryptEnvelope(keyB, envelope);
    expect(decrypted).toEqual({ ok: false });
  });

  it("fails closed when the ciphertext has been tampered with (auth tag rejects it)", async () => {
    const key = await importRoomKey(await generateRoomKey());
    const envelope = await encryptEnvelope(key, "element-delta", { x: 1 });
    const tampered = { ...envelope, ciphertext: envelope.ciphertext!.slice(0, -4) + "AAAA" };
    const decrypted = await decryptEnvelope(key, tampered);
    expect(decrypted).toEqual({ ok: false });
  });

  it("fails closed on a missing iv or ciphertext instead of throwing", async () => {
    const key = await importRoomKey(await generateRoomKey());
    await expect(decryptEnvelope(key, { type: "snapshot-request" })).resolves.toEqual({ ok: false });
  });

  it("fails closed when compress option mismatches between sides", async () => {
    const key = await importRoomKey(await generateRoomKey());
    const envelope = await encryptEnvelope(key, "presence", { a: 1 }, { compress: true });
    const decrypted = await decryptEnvelope(key, envelope, { compress: false });
    expect(decrypted).toEqual({ ok: false });
  });
});

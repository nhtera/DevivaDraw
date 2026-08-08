/**
 * Per-message AES-GCM encryption for the live collab channel. Generalizes `@deviva-draw/engine`'s
 * share-link crypto (a fresh key *per share*) to a single room key reused across every message for the
 * lifetime of a session, with a fresh random IV on every individual call — AES-GCM's one hard rule is
 * that an IV must never repeat under the same key (a repeat leaks the XOR of both plaintexts and can
 * fully compromise the key), so `encryptEnvelope` always draws a new random IV rather than deriving one
 * from a counter or timestamp. The collab-server relay never holds this key; it only ever sees
 * `{type, iv, ciphertext}` and cannot decrypt any of it (see `apps/collab-server`'s room modules).
 */
import { base64UrlToBytes, bytesToBase64Url, gzipCompress, gzipDecompress } from "@deviva-draw/engine";

const AES_KEY_LENGTH_BITS = 256;
/** NIST SP 800-38D's recommended AES-GCM IV length — see `@deviva-draw/engine`'s `encrypt-scene.ts` for why this exact length is not made configurable. */
const GCM_IV_LENGTH_BYTES = 12;

/** The wire shape a room message travels in — `iv`/`ciphertext` are absent only for a bare `snapshot-request` signal, which carries no payload. */
export interface RoomEnvelope {
  type: string;
  iv?: string;
  ciphertext?: string;
}

/** Generates a fresh random room key, base64url-encoded for a room URL's fragment — called once by whichever peer starts a session (`room-url.ts`'s `buildRoomUrl`). */
export async function generateRoomKey(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: AES_KEY_LENGTH_BITS }, true, ["encrypt", "decrypt"]);
  const raw = await crypto.subtle.exportKey("raw", key);
  return bytesToBase64Url(new Uint8Array(raw));
}

/** Imports a base64url room key (from a room URL's fragment or `generateRoomKey`) into a reusable `CryptoKey` good for the whole session. */
export async function importRoomKey(keyBase64Url: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(keyBase64Url);
  return crypto.subtle.importKey("raw", raw as Uint8Array<ArrayBuffer>, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export interface EnvelopeCodecOptions {
  /** Gzip the plaintext before encrypting — worthwhile for element deltas/snapshots, skipped for presence (small, frequent, latency-sensitive; compression overhead isn't worth it there). Defaults to `true`. */
  compress?: boolean;
}

/** Encrypts `payload` (any JSON-serializable value) into a wire envelope tagged `type`. */
export async function encryptEnvelope(key: CryptoKey, type: string, payload: unknown, options: EnvelopeCodecOptions = {}): Promise<RoomEnvelope> {
  const compress = options.compress ?? true;
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const plaintext = compress ? await gzipCompress(json) : json;
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_LENGTH_BYTES));
  // See `@deviva-draw/engine`'s `gzip-codec.ts` for why this cast is always safe here: both branches
  // above produce a fresh, exactly-`ArrayBuffer`-backed `Uint8Array`.
  const ciphertextBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext as Uint8Array<ArrayBuffer>);
  return { type, iv: bytesToBase64Url(iv), ciphertext: bytesToBase64Url(new Uint8Array(ciphertextBuffer)) };
}

export type DecryptEnvelopeResult = { ok: true; payload: unknown } | { ok: false };

/**
 * Decrypts a wire envelope back to its JSON payload — never throws. A wrong/rotated key, tampered
 * ciphertext (AES-GCM's built-in authentication tag rejects any bit-flip), a missing `iv`/`ciphertext`,
 * or a `compress` mismatch between sender and receiver all surface as `{ ok: false }` uniformly: every
 * caller treats an inbound message as untrusted regardless of *why* it failed to decode.
 */
export async function decryptEnvelope(key: CryptoKey, envelope: RoomEnvelope, options: EnvelopeCodecOptions = {}): Promise<DecryptEnvelopeResult> {
  if (!envelope.iv || !envelope.ciphertext) return { ok: false };
  try {
    const iv = base64UrlToBytes(envelope.iv);
    const ciphertext = base64UrlToBytes(envelope.ciphertext);
    const decryptedBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer> }, key, ciphertext as Uint8Array<ArrayBuffer>);
    const compress = options.compress ?? true;
    const bytes = compress ? await gzipDecompress(new Uint8Array(decryptedBuffer)) : new Uint8Array(decryptedBuffer);
    return { ok: true, payload: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false };
  }
}

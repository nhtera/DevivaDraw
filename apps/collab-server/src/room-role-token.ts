/**
 * Room role tokens: the unforgeable half of "this link joins read-only".
 *
 * A client-side read-only flag is decoration — anyone can open devtools and send an `element-delta`
 * anyway — so the relay is what enforces the role, and the relay needs a way to know a connection's
 * role that the connection itself cannot lie about. A token is an HMAC-SHA256 over `{roomId}|{role}`
 * with a Worker-side secret: a client can present one but cannot mint one, and verification needs no
 * storage at all (recompute and compare), so a room stays a pure Durable Object with no side table.
 *
 * This is the ONLY file in this Worker that touches key material, and the key it touches has nothing
 * to do with the end-to-end encryption of scene data: `ROOM_TOKEN_SECRET` signs a *relay write
 * permission*, while the room's decryption key never leaves the URL fragment and never reaches this
 * server at all. Verifying a token therefore does not weaken (or even interact with) the property that
 * this relay is structurally incapable of reading what it relays.
 */
export type RoomRole = "editor" | "viewer";

export const ROOM_ROLES: readonly RoomRole[] = ["editor", "viewer"];

/** The query parameter a room WebSocket URL carries its token in. A query parameter, not the fragment: a fragment is never sent to a server, which is exactly why the decryption key lives there and this token cannot. */
export const ROLE_TOKEN_PARAM = "t";

function base64UrlEncode(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

/** Signs `{roomId}|{role}`. Both fields are inside the MAC so a viewer token minted for one room cannot be replayed against another, and a viewer cannot promote themselves by editing the role prefix. */
export async function mintRoleToken(secret: string, roomId: string, role: RoomRole): Promise<string> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${roomId}|${role}`));
  return `${role}.${base64UrlEncode(signature)}`;
}

/**
 * The role `token` proves for `roomId`, or `null` if it proves nothing.
 *
 * The claimed role is read from the prefix and then *verified*, never trusted: the MAC is recomputed
 * for that exact claim, so a token whose prefix says `editor` only verifies if it was actually minted
 * as an editor token for this room. An unknown prefix is rejected before any crypto runs.
 */
export async function verifyRoleToken(secret: string, roomId: string, token: string): Promise<RoomRole | null> {
  const separator = token.indexOf(".");
  if (separator === -1) return null;
  const claimed = token.slice(0, separator);
  if (!ROOM_ROLES.includes(claimed as RoomRole)) return null;
  const expected = await mintRoleToken(secret, roomId, claimed as RoomRole);
  return timingSafeEqual(expected, token) ? (claimed as RoomRole) : null;
}

/**
 * Length-then-content comparison that does not return early on the first differing character.
 *
 * The length check does leak the length, which is fine: every token here is a known role prefix plus a
 * fixed-size SHA-256 MAC, so the length carries no secret. What matters is that comparing the bytes takes the same time
 * whether the guess is wrong in the first position or the last — otherwise a caller could recover a
 * valid token one character at a time from response timings.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

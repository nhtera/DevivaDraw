/**
 * The optional capability a host application supplies to let this editor **host** a collaboration room
 * on the local network instead of relaying through a server on the internet.
 *
 * Only the desktop app can provide it — hosting means listening on a TCP port, which a web page cannot
 * do — so it is an injected capability rather than something this package implements. The web build
 * passes nothing and renders no hosting UI at all: absent capability, absent feature, no dead controls.
 *
 * What crosses this boundary is deliberately not a URL. The host mints the room id and its role tokens
 * (the relay's signing secret lives in the host process and must stay there), while the room's
 * *encryption* key is generated in this layer and must never leave it — so the two halves of a join
 * link are assembled here, and the hosting side never holds a complete one. That is the same trust
 * boundary the hosted relay has, preserved across a very different transport: the machine doing the
 * relaying cannot read what it relays.
 */

/** One address the host machine could publish, as reported by the host application. */
export interface LanHostAddress {
  /** Dotted-quad IPv4, ready for a URL's host position. */
  address: string;
  /** The OS's interface name (`en0`, `Wi-Fi`, …) — what tells two private addresses apart to a human. */
  interface: string;
}

/** A room minted by the host process, with the tokens its relay will accept. */
export interface LanHostRoom {
  /** The port actually bound, which may differ from the one requested. */
  port: number;
  roomId: string;
  editorToken: string;
  viewerToken: string;
}

export interface LanHostController {
  /** Private addresses this machine currently holds, best candidate first. Empty means it is on no local network, which the UI reports rather than showing a dead link. */
  addresses(): Promise<LanHostAddress[]>;
  /** Starts the relay and mints one room on it, on `port` when given. Rejects with a machine-readable reason (see `LanHostErrorReason`). */
  start(port?: number): Promise<LanHostRoom>;
  /** Stops the relay, closing every connection. Safe to call when nothing is running. */
  stop(): Promise<void>;
}

/**
 * Why hosting failed, as a code rather than prose — same contract as `CollabErrorReason`, so the UI
 * picks a translated message instead of displaying whatever the host process happened to say.
 * `permission-denied` is its own case because it is not a bug: macOS asks for local-network access the
 * first time, and a denial needs an answer about system settings, not a retry button.
 */
export type LanHostErrorReason = "already-hosting" | "port-in-use" | "permission-denied" | "no-network" | "start-failed";

const KNOWN_REASONS: LanHostErrorReason[] = ["already-hosting", "port-in-use", "permission-denied", "no-network"];

/** Maps whatever a rejected `start()` threw onto a reason this package has a message for. */
export function lanHostErrorReason(caught: unknown): LanHostErrorReason {
  const text = typeof caught === "string" ? caught : caught instanceof Error ? caught.message : "";
  return KNOWN_REASONS.find((reason) => text.includes(reason)) ?? "start-failed";
}

/** The relay's default port, offered as the starting value in the hosting UI so a host who has done this before can predict the URL. Mirrors `DEFAULT_LAN_PORT` in the Rust host. */
export const DEFAULT_LAN_PORT = 7373;

/** The relay's base URL for one published address. `http`, because a LAN relay has no certificate anyone could validate — see `docs/collab-relay-protocol.md` on why the transport carries nothing that needs protecting. */
export function lanRelayBaseUrl(address: string, port: number): string {
  return `http://${address}:${port}`;
}

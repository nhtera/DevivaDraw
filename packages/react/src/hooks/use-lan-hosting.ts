/**
 * Hosting state for a room served from this machine — the React side of `lan-host-controller.ts`.
 *
 * Lives above the collaboration dialog rather than inside it because hosting outlives the dialog: the
 * host closes it and keeps drawing, and a relay whose lifetime was tied to a modal would take the room
 * down with the modal. The dialog reads this state and dispatches into it; nothing here renders.
 *
 * Two things always happen together and are therefore one action each: starting the relay and joining
 * the room it hosts, and leaving the room and stopping the relay. A half-state — a relay with nobody
 * on it, or a session pointing at a relay that has stopped — is not a state anybody wants to be able
 * to reach from a button.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MintedRoom } from "@deviva-draw/collab-client";
import { lanHostErrorReason, lanRelayBaseUrl } from "../browser/lan-host-controller";
import type { LanHostAddress, LanHostController, LanHostErrorReason, LanHostRoom } from "../browser/lan-host-controller";

export interface UseLanHostingOptions {
  /** Absent in every host but the desktop app; the whole feature then reports itself unsupported. */
  lanHost?: LanHostController;
  hostSession(relayBaseUrl: string, room: MintedRoom): Promise<void>;
  leaveSession(): void;
}

export interface UseLanHostingResult {
  supported: boolean;
  /** Addresses this machine can publish, best first. Refreshed when `refresh` is called, not polled. */
  addresses: LanHostAddress[];
  /** `false` until the first read finishes. Distinguishes "not asked yet" from "asked, and there is no local network" — without it the UI states the second while the first is still true. */
  addressesRead: boolean;
  isHosting: boolean;
  error: LanHostErrorReason | null;
  /** Re-reads the machine's addresses — worth doing when the hosting UI becomes visible, since a laptop's network changes without telling anyone. */
  refresh(): Promise<void>;
  /** Starts the relay and joins the room it mints, publishing `address` in the links. `port` falls back to the host's default. */
  start(address: string, port?: number): Promise<void>;
  /** Leaves the room and stops the relay. */
  stop(): Promise<void>;
}

export function useLanHosting(options: UseLanHostingOptions): UseLanHostingResult {
  const { lanHost, hostSession, leaveSession } = options;
  const [addresses, setAddresses] = useState<LanHostAddress[]>([]);
  const [addressesRead, setAddressesRead] = useState(false);
  const [isHosting, setIsHosting] = useState(false);
  const [error, setError] = useState<LanHostErrorReason | null>(null);
  // Read by the unmount cleanup, which must not re-run every time hosting toggles.
  const hostRef = useRef(lanHost);
  hostRef.current = lanHost;
  const hostingRef = useRef(false);
  hostingRef.current = isHosting;

  const refresh = useCallback(async () => {
    if (!lanHost) return;
    try {
      setAddresses(await lanHost.addresses());
    } catch {
      // A machine that cannot enumerate its own interfaces reports as being on no network, which is
      // the same thing as far as anyone trying to join is concerned.
      setAddresses([]);
    } finally {
      setAddressesRead(true);
    }
  }, [lanHost]);

  const start = useCallback(
    async (address: string, port?: number) => {
      if (!lanHost) return;
      setError(null);
      let room: LanHostRoom;
      try {
        room = await lanHost.start(port);
      } catch (caught) {
        setError(lanHostErrorReason(caught));
        return;
      }
      try {
        await hostSession(lanRelayBaseUrl(address, room.port), room);
        setIsHosting(true);
      } catch {
        // The relay came up but the session did not — leaving it listening would be a room nobody is
        // in, on a port the host has no UI to release.
        await lanHost.stop().catch(() => {});
        setError("start-failed");
      }
    },
    [lanHost, hostSession],
  );

  const stop = useCallback(async () => {
    leaveSession();
    setIsHosting(false);
    await lanHost?.stop().catch(() => {});
  }, [lanHost, leaveSession]);

  // Closing the app while hosting must not leave the port bound. The relay lives in the host process,
  // so nothing else would ever release it.
  useEffect(() => {
    return () => {
      if (hostingRef.current) void hostRef.current?.stop().catch(() => {});
    };
  }, []);

  return { supported: Boolean(lanHost), addresses, addressesRead, isHosting, error, refresh, start, stop };
}

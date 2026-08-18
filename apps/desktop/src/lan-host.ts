/**
 * Desktop implementation of the editor's `LanHostController` capability — the shell half of hosting a
 * collaboration room on the local network. The relay itself is Rust (`src-tauri/src/lan_relay/`); this
 * is the three `invoke` calls that reach it.
 *
 * Nothing here decides anything. The reason it exists at all is that `@deviva-draw/react` must not
 * import Tauri: the same editor builds for the web, where hosting is impossible, and a capability the
 * shell injects is how the desktop adds an ability without the library gaining a dependency it cannot
 * satisfy everywhere.
 *
 * A rejected `start` carries the Rust side's reason code (`port-in-use`, `permission-denied`, …)
 * through unchanged, because the editor maps codes to translated messages and would have nothing to
 * do with a sentence in English from a process.
 */
import { invoke } from "@tauri-apps/api/core";
import type { LanHostAddress, LanHostController, LanHostRoom } from "@deviva-draw/react";

export const lanHost: LanHostController = {
  addresses: () => invoke<LanHostAddress[]>("lan_host_addresses"),
  start: (port) => invoke<LanHostRoom>("start_lan_relay", { port: port ?? null }),
  stop: () => invoke<void>("stop_lan_relay"),
};

# @deviva-draw/desktop

Deviva Draw as a desktop app — a [Tauri v2](https://v2.tauri.app) shell around the exact same
`@deviva-draw/react` editor the web app hosts. Fully offline; localStorage autosave persists per-app
across relaunches. Real `.devivadraw` file semantics (open/save-in-place, file association, recents)
land in later phases of `plans/260816-1921-offline-desktop-app/`.

## Prerequisites

Unlike the rest of the monorepo, this package needs a Rust toolchain:

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # installs rustup + stable
```

macOS additionally needs the Xcode Command Line Tools (`xcode-select --install`).
Linux needs the WebKitGTK dev packages — see https://v2.tauri.app/start/prerequisites/.

## Develop

```sh
pnpm --filter @deviva-draw/desktop dev     # vite dev server + native window, hot reload
```

## Build a local bundle

```sh
pnpm --filter @deviva-draw/desktop build   # dmg/nsis/appimage+deb per host OS (unsigned locally)
```

## Hosting a room on your own network

Collaborate -> **Host on this network** runs the relay inside this app instead of on a server, so a
workshop, classroom, or air-gapped team can draw together with no internet at all. The app binds a
port (default `7373`), mints the room and its editor/viewer links, and publishes one of the machine's
private addresses; a second Deviva Draw desktop app on the same network joins by pasting that link.

Three things are worth knowing before the first attempt:

- **Peers join from the desktop app.** A page served over HTTPS cannot open the unencrypted socket a
  LAN room uses, so a web browser cannot join one. Opening the link in a browser returns a page
  saying exactly that rather than failing silently.
- **The OS will ask.** macOS prompts for local-network access on first host, and Windows raises a
  firewall dialog. A denial surfaces in the dialog as a permission error, not as a hang.
- **Nothing is stored.** The relay keeps the room in memory only, never writes scene bytes to disk,
  and its token secret is random per hosting session. Stopping hosting closes every connection and
  ends the room; the durable copy of the board is the host's own document, as always.

The host machine relays ciphertext it cannot read: the room's encryption key lives in the link's
fragment and never reaches the relay, exactly as with the hosted server. The relay implements the
same numbered decisions as the Worker relay - see
[Collab Relay Protocol](../../docs/collab-relay-protocol.md) - and lives in
`src-tauri/src/lan_relay/`.

## Security model (why there is no `fs` capability)

The WebView gets **no JS-side filesystem grant at all**. Every path-based read/write goes through
Rust commands that validate the target against an explicit per-path allowlist
(`src-tauri/src/file_io.rs`); paths enter that allowlist only via native dialog choices,
file-association launches, or the app's own recents index. The WebView also never navigates off the
app origin — external links go through a confirm dialog to the system browser (`src-tauri/src/main.rs`).

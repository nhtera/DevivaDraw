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

## Security model (why there is no `fs` capability)

The WebView gets **no JS-side filesystem grant at all**. Every path-based read/write goes through
Rust commands that validate the target against an explicit per-path allowlist
(`src-tauri/src/file_io.rs`); paths enter that allowlist only via native dialog choices,
file-association launches, or the app's own recents index. The WebView also never navigates off the
app origin — external links go through a confirm dialog to the system browser (`src-tauri/src/main.rs`).

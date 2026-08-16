# Desktop Release Runbook

How a Deviva Draw desktop version ships. The npm/worker release (`release.yml`) and the desktop
release (`release-desktop.yml`) share the same `v*` tag trigger and run independently.

## One-time setup — COMPLETE as of v0.8.0 (2026-08-17)

Nothing below needs to be repeated for a normal release; it exists so the setup can be rebuilt
(new repo, new Mac, cert renewal). Repo secrets audit (v0.8.0): **all 10 secrets are used, none
redundant** — 8 for the desktop pipeline (rows below), 2 for the MCP worker deploy
(`CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN`, unrelated to desktop).

| Setup item | Where | Status |
|---|---|---|
| Developer ID Application cert | login keychain (`TIEN NGUYEN HONG (QCLXRD7V9M)`) | done |
| Single-identity legacy `.p12` → `APPLE_CERTIFICATE`(+`_PASSWORD`) | repo secrets | done |
| `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID` | repo secrets | done |
| Updater keypair | `~/.tauri/deviva-draw-updater.key(.pub)`; pubkey baked in `tauri.conf.json`; private key → `TAURI_SIGNING_PRIVATE_KEY` (+empty `_PASSWORD`) | done |
| notarytool keychain profile `deviva` (local notarizations only) | maintainer Mac keychain | done |

The only per-release "setup" is the version bump + tag (normal flow below); everything else is
automatic.

## Troubleshooting — real failures from the v0.8.0 release

Each of these burned a CI run; check here first when the macOS job goes red.

1. **`certificate from APPLE_CERTIFICATE "…" does not match provided identity`** — the `.p12`
   contains more than one identity (a raw `security export -t identities` bundles ALL of them;
   Tauri then picks the wrong cert). Fix: repack a p12 holding ONLY the Developer ID Application
   identity (see signing matrix row).
2. **`SecKeychainItemImport: MAC verification failed during PKCS12 import (wrong password?)`** —
   the password is fine; the p12 was packed with OpenSSL 3 defaults (AES/PBES2), which macOS
   `security import` cannot read. Repack with `openssl pkcs12 -export -legacy`.
3. **`HTTP status code: 401. Invalid credentials` at the "Notarizing …app" step** —
   `APPLE_PASSWORD` is not a valid **app-specific password**. Generate one at account.apple.com →
   Sign-In & Security → App-Specific Passwords. (Signing already succeeded at this point — only
   the notary upload is failing.)

Recovery is cheap: fix the secret, then `gh run rerun <run-id> --failed` — the tag's run re-runs
just the failed job and the green Windows/Linux jobs are kept.

Verify a fix locally before spending a CI cycle:
`security create-keychain -p x t.keychain && security import cert.p12 -k t.keychain -P <pwd>`
must print `1 identity imported`; then `security delete-keychain t.keychain`.

## The normal flow

1. Bump versions (`apps/desktop/package.json` + `src-tauri/tauri.conf.json` + `Cargo.toml` stay in
   lockstep with the workspace release version), update `CHANGELOG.md`, commit. NB: `v0.7.0` is
   already taken by the npm release — the first desktop tag must be a later version.
2. `git tag v0.x.0 && git push origin main --tags`.
3. `release-desktop.yml` gates (typecheck/lint/unit) then builds: macOS universal dmg (signed +
   notarized), Windows nsis, Linux AppImage + deb. In practice `release.yml` creates the
   **published** GitHub Release for the tag first, and tauri-action attaches the installers +
   `latest.json` to it (the draft setting only applies if no release exists yet). Installed apps
   poll `releases/latest/download/latest.json` for updates as soon as assets land.
4. Verify the shipped artifact, not the local build: download the dmg from the release, mount it,
   then `spctl -a -t exec -vv "<mount>/Deviva Draw.app"` → expect
   `accepted … Notarized Developer ID`. (The dmg *container* is unstapled — Tauri notarizes and
   staples the `.app`, which is what Gatekeeper checks at launch.)

## Signing matrix

| Secret | Purpose |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD` if set) | **REQUIRED** — updater artifact signatures; the matching pubkey is baked into `tauri.conf.json`, so builds fail without it. Keypair lives at `~/.tauri/deviva-draw-updater.key(.pub)` on the maintainer machine. |
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` | Developer ID Application cert as base64 `.p12`. **Must contain exactly ONE identity** (Tauri errors on multi-identity bundles like a full `security export`), and **must use legacy PKCS12 ciphers** — OpenSSL 3 defaults (AES/PBES2) fail `security import` on the runner with "MAC verification failed". Export from Keychain Access GUI (select only the Developer ID cert + key), or repack via `openssl pkcs12 -export -legacy`. Verify before uploading: `security import cert.p12 -k <temp-keychain> -P <pwd>` must print "1 identity imported". Then `base64 -i cert.p12` → secret. |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: TIEN NGUYEN HONG (QCLXRD7V9M)` |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | notarytool: Apple ID email, an **app-specific password** (account.apple.com → Sign-In & Security — NOT the Apple ID password, NOT a keychain item; a wrong value 401s at the notarize step after a successful codesign), team id. |

Apple secrets are optional: absent ⇒ unsigned macOS artifacts (beta strategy below).

Set with `gh secret set NAME < file` (never paste secrets into shells with history).

## Local signed build + notarization (maintainer Mac)

```sh
# Signed build (Developer ID cert must be in the login keychain):
APPLE_SIGNING_IDENTITY="Developer ID Application: TIEN NGUYEN HONG (QCLXRD7V9M)" \
  pnpm --filter @deviva-draw/desktop build

# One-time: store notary credentials in the keychain (prompts, nothing echoed):
xcrun notarytool store-credentials deviva --apple-id <apple-id-email> --team-id QCLXRD7V9M

# Notarize + staple the dmg:
xcrun notarytool submit "apps/desktop/src-tauri/target/release/bundle/dmg/Deviva Draw_<v>_universal.dmg" \
  --keychain-profile deviva --wait
xcrun stapler staple "apps/desktop/src-tauri/target/release/bundle/dmg/Deviva Draw_<v>_universal.dmg"
spctl -a -t open --context context:primary-signature -v "…dmg"   # expect: accepted
```

## App icon convention

Platform conventions differ: **macOS icons need Apple's grid** — an 824×824 rounded tile
(≈185px corner radius) centered on a transparent 1024×1024 canvas with a subtle shadow — while
**Windows/Linux icons are full-bleed** edge-to-edge. So `icons/icon.icns` is built from the
padded master `icons/icon-macos.png`, and everything else (`icon.ico`, the pngs) comes from the
full-bleed `icons/icon.png`. A full-bleed icns renders oversized next to other Dock icons.
Rebuild the icns after artwork changes:
`mkdir i.iconset; for s in 16 32 128 256 512; do sips -z $s $s icon-macos.png --out i.iconset/icon_${s}x${s}.png; sips -z $((s*2)) $((s*2)) icon-macos.png --out i.iconset/icon_${s}x${s}@2x.png; done; iconutil -c icns i.iconset -o icon.icns`

## Beta strategy (validation decision #1)

Unsigned releases ship as **pre-releases** with install notes: macOS right-click → Open (or
`xattr -dr com.apple.quarantine "/Applications/Deviva Draw.app"`), Windows SmartScreen → More
info → Run anyway. Signing promotes later releases to stable; the updater activates with the
first release that has updater signatures.

## Update UX contract

Check on launch (5s delay, silent on failure/offline) + Help → "Check for Updates…". Install is
user-prompted; the restart path calls the app's single unsaved-changes close guard — an update
never relaunches over unsaved work.

## Cert renewal notes

- Developer ID Application certs last 5 years; renewal = new cert in Keychain + re-export `.p12`
  secret. Team ID stays stable.
- App-specific passwords survive until revoked; regenerate if the Apple ID password changes.
- The updater keypair must NEVER rotate casually: installed apps only accept updates signed by the
  baked-in pubkey. Rotating requires shipping a release signed by the OLD key whose new version
  carries the NEW pubkey.

# Desktop Release Runbook

How a Deviva Draw desktop version ships. The npm/worker release (`release.yml`) and the desktop
release (`release-desktop.yml`) share the same `v*` tag trigger and run independently.

## The normal flow

1. Bump versions (`apps/desktop/package.json` + `src-tauri/tauri.conf.json` + `Cargo.toml` stay in
   lockstep with the workspace release version), update `CHANGELOG.md`, commit. NB: `v0.7.0` is
   already taken by the npm release — the first desktop tag must be a later version.
2. `git tag v0.x.0 && git push origin main --tags`.
3. `release-desktop.yml` gates (typecheck/lint/unit) then builds: macOS universal dmg, Windows
   nsis, Linux AppImage + deb — into a **draft** GitHub Release.
4. Review the draft, edit notes, publish. Publishing makes
   `releases/latest/download/latest.json` live, which is what installed apps poll for updates.

## Signing matrix

| Secret | Purpose |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD` if set) | **REQUIRED** — updater artifact signatures; the matching pubkey is baked into `tauri.conf.json`, so builds fail without it. Keypair lives at `~/.tauri/deviva-draw-updater.key(.pub)` on the maintainer machine. |
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` | Developer ID Application cert as base64 `.p12` (export from Keychain Access → certificate + private key → .p12; `base64 -i cert.p12 \| pbcopy`). |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: TIEN NGUYEN HONG (QCLXRD7V9M)` |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | notarytool: Apple ID email, an **app-specific password** (account.apple.com → Sign-In & Security), team id. |

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

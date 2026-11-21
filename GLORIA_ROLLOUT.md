# GloriaSetup rollout for Lumina

Lumina is an Electron app (electron-vite + electron-builder). CI now runs `electron-builder --dir`, copies
`release/win-unpacked` to `app-dist/` and packs it with `projectGloria/GloriaSetup@v0.1.0`.

## Please check

- **Quick Note integration is lost.** The old NSIS script (`resources/installer.nsh`) created the "Lumina Quick Note"
  shortcuts and the file associations / "Open with" verbs. GloriaSetup does not run NSIS scripts, so these are no
  longer registered. `Lumina Quick Note.exe` is still shipped in the install folder. Decide whether GloriaSetup
  should support this or the app should register them itself on first run.
- **Data folders.** The manifest lists `%APPDATA%\lumina` (Vault: from the package.json name, since no `productName`
  or `setName` is set for it) and `%APPDATA%\lumina-quicknote` (Quick Note, set in `src/main/index.ts`). I did not run
  the app, so please confirm the Vault folder name on a machine with a packaged install.
- **Icon.** There is no `Lumina.ico` in the root, so `resources/icon.ico` (the app's own icon) is used.
- **Version.** `gloria.toml` says `1.0.0` (package.json); the tag overrides it at release time.
- **Old installer steps dropped.** The NSIS build, `verify:release` and the separate ubuntu release job are gone;
  the action attaches the setup. `electron-builder.yml` still has its NSIS settings, left untouched for local `build:win`.
- **Legacy name.** `legacy_names = ["Lumina"]` for earlier electron-builder NSIS installs (same as `name`).
- **Signing.** Uses `WINDOWS_PFX_BASE64` / `WINDOWS_PFX_PASSWORD`; the old `CSC_LINK` secrets are no longer used.
  Without them the setup is unsigned.
- **Speech packs** (`resources/speech`) are not fetched in CI, as before, so the setup ships without them.
- Nothing was built or tested locally. `workflow_dispatch` builds and packs but attaches nothing (no tag).

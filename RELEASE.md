# Windows Release Checklist

Lumina’s public Windows artifacts must be Authenticode-signed. Configure the certificate outside the repository through electron-builder’s signing environment (for example, `CSC_LINK` and `CSC_KEY_PASSWORD`), then run:

```powershell
npm ci
npm test
npm run typecheck
npm run release
```

`npm run release` builds the NSIS installer and portable executable, then verifies that both artifacts:

- exist for the version in `package.json`;
- have a valid trusted-publisher signature;
- have SHA-256 hashes available for release notes;
- contain the main, preload, renderer, and package manifest inside `app.asar`.

The verification step intentionally fails for unsigned executables. For local packaging diagnostics only, set `LUMINA_ALLOW_UNSIGNED=1` before running `npm run verify:release`; never use that override for published artifacts.

Expected outputs are `release/Lumina-<version>-x64.exe`, `release/Lumina-<version>-portable.exe`, and the installer blockmap. Test the installer on a clean Windows user profile, confirm the publisher shown by Windows, and verify that `.md`, `.markdown`, and `.mdx` files offer Lumina under **Open with**.

Do not commit certificate files, passwords, or signing-service credentials.

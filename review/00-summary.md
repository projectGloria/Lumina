# Codebase review — Lumina

Reviewed 14 September 2026, against the working tree at `C:\Users\Nihil\Desktop\projectGloria\Lumina`
(branch `main`, clean). No commit SHA: `git` is not on `PATH` in this environment, so the tree could not be
pinned to a revision.

Lumina is a local-first Electron notes app — React 19, CodeMirror 6, Zustand — of roughly 27 300 lines across a
vault application and a separate Quick Note application sharing one repository.

## Scope and method

**Read in full:** the entire main process (`src/main`, 5 080 lines, every file); the preload bridge; `src/shared`
`clip.ts`, `channels.ts`, `markdown-parse.ts` (partially — the hot functions); and in the renderer `App.tsx`,
all seven Zustand stores, `lib/actions.ts`, `lib/render.ts`, `editor/Editor.tsx`, `editor/extensions.ts`,
`editor/ReadView.tsx`, `editor/wikilink.ts`, `components/FileTree.tsx`, `GraphView.tsx`, `SearchPanel.tsx`,
`StatusBar.tsx`, `Workspace.tsx`, `ContextMenu.tsx`, `useModalTrap.ts`, `PathIcon.tsx`, `CommandPalette.tsx`,
`QuickSwitcher.tsx`. `editor/livePreview.ts` (42 KB) was read in the regions that matter — the widgets, both
decoration builders, the state field and the view plugin. `src/quicknote/main.ts` read to line ~345.

**Skimmed with targeted greps:** `SettingsModal.tsx` (62 KB — read the profiles tab and the modal shell), the
five stylesheets (~127 KB, checked for focus/motion/outline patterns rather than read), the remaining Home
widgets, `recorder.ts`/`voice.ts`/`readAloud.ts`/`musicPlayer.ts` (checked for resource leaks only).

**Not assessed:** `extension/` (the browser clipper), `resources/`, `scripts/fetch-speech-packs.ps1`.

**Tools run:** `npm ci` (clean), `npm run typecheck` (**passes**, both projects), `npm test` (**18/18 pass**,
1.8 s), `npm audit --omit=dev` (**0 vulnerabilities**). No linter is configured. One finding
(`.lumina/previews`) was reproduced empirically with a standalone Node script rather than reasoned about.

## Verdict

This is well-built software. The Electron hardening is correct and complete, path traversal is guarded in one
place that every filesystem call routes through, the clip server's threat model is explicitly reasoned and
correctly implemented, and the module comments explain *why* rather than *what* — several of them correctly
anticipate the bug they exist to prevent. Typecheck and tests are green.

Two things undercut it. First, the test suite covers 172 lines against 27 300, and all of it tests Quick Note —
the modules that were explicitly restructured to be testable (`clip.ts` names a `tests/clip.test.ts` that was
never written; `clipServer.ts`, `paths.ts`, `markdown-parse.ts`) have no tests at all. Second, there is a cluster
of "this runs far more often than it needs to" defects: every star toggle rebinds a global shortcut, rewrites a
Windows registry key, re-parses the user stylesheet and restarts an HTTP server; every keystroke serialises the
whole document twice and word-counts it twice.

The Critical finding is a three-way directory-name mismatch that makes link-preview thumbnails fail 100 % of the
time, silently, since the failure is swallowed by a bare `catch`.

## Top issues

| Severity | Finding | File | Category |
|---|---|---|---|
| **Critical** | Link-preview images written to a directory that is never created — feature silently 100% broken | `src/main/linkPreview.ts:83-88` | [bugs](01-bugs.md) |
| **High** | Vault switch leaves the editor live while the root moves; an autosave can write one vault's note into another | `src/main/ipc.ts:293-322` | [bugs](01-bugs.md) |
| **High** | Imported settings preset can point the speech binary at any executable, which is then spawned | `src/main/transcribe.ts:106`, `ipc.ts:670` | [security](03-security.md) |
| **High** | Every settings write tears down and rebinds the clipper HTTP server | `src/main/ipc.ts:552` | [bugs](01-bugs.md) |
| **High** | Four full-document passes per keystroke; typing latency scales with note size | `StatusBar.tsx:26`, `Editor.tsx:187` | [performance](02-performance.md) |
| **High** | Block-decoration field walks the entire syntax tree on every keystroke and caret move | `livePreview.ts:678`, `:735` | [performance](02-performance.md) |
| **High** | File explorer is the one primary surface with no keyboard access | `FileTree.tsx:332-515` | [ux](04-ux.md) |
| **High** | 172 lines of tests for 27 300 lines of source, all covering Quick Note | `tests/` | [architecture](05-architecture.md) |
| **Medium** | Applying an imported preset can silently enable the clipper with a known token | `src/main/ipc.ts:552` | [security](03-security.md) |
| **Medium** | Link previews fetch private-network and loopback URLs and surface the results | `src/main/net.ts:15-22` | [security](03-security.md) |
| **Medium** | External deletion orphans colour/custom-icon overrides; a new note at that path inherits them | `App.tsx:167-169` | [bugs](01-bugs.md) |
| **Medium** | Custom colour picker commits the wrong colour and closes on first drag | `FileTree.tsx:305` | [bugs](01-bugs.md) |
| **Medium** | Graph resets pan and restarts the simulation on every note click and every autosave | `GraphView.tsx:274-280` | [bugs](01-bugs.md) |
| **Medium** | `mailto:` links are silently dead in read mode | `ReadView.tsx:151`, `ipc.ts:914` | [bugs](01-bugs.md) |

## Counts

| Category | Critical | High | Medium | Low |
|---|---|---|---|---|
| Bugs | 1 | 2 | 5 | 5 |
| Performance | 0 | 2 | 6 | 3 |
| Security | 0 | 1 | 2 | 2 |
| UX / accessibility | 0 | 1 | 1 | 4 |
| Architecture | 0 | 1 | 3 | 3 |
| **Total** | **1** | **7** | **17** | **17** |

Each finding is counted once. `04-ux.md` additionally cross-references five interaction defects (four Medium,
one Low) that are written up in full in `01-bugs.md` and counted there. The "Checked and found sound" section of
`03-security.md` and the "Worth keeping" section of `05-architecture.md` are not findings and are not counted.

## Suggested order

1. Fix the link-preview directory name — one constant, ten minutes, restores a whole feature.
2. Add a generation guard to `CH.noteWrite` so a write cannot land in the wrong vault.
3. Make `syncClipServer`, `bindQuickNoteShortcut` and `applyLoginItem` early-return when nothing changed.
4. Memoise the word count and drop `buffer` from the `Editor.tsx:194` dependency array — the two cheapest
   fixes on the typing path.
5. Write `tests/clip.test.ts`, `tests/clipServer.test.ts`, `tests/paths.test.ts`. The files were shaped for it.
6. Validate or strip `voice.binaryPath` on settings import.

## Blind spots

Being explicit about what this review does **not** cover:

- **No runtime observation.** The app was never launched. Everything here is static analysis plus one isolated
  Node reproduction. Performance findings are reasoned from code shape and complexity, not profiled — the
  per-keystroke claims in `02-performance.md` describe work that provably happens, but I have not measured the
  resulting latency in milliseconds, and CodeMirror or V8 may absorb more of it than I expect.
- **The PDF data-URL size limit** is marked *Needs check* rather than Verified; I did not determine the exact
  threshold at which `loadURL` fails in Electron 43.
- **No packaged build was produced.** `electron-builder.yml`, `installer.nsh`, code signing, the NSIS installer,
  file associations, and `scripts/verify-release.ps1` were read but never exercised. Packaged-app behaviour
  (`process.resourcesPath`, `app.isPackaged` branches, tray icon loading, the login item) is untested here — and
  `docs/quicknote.md:62` already notes that packaged identity and cold-start timing are unverified.
- **`extension/` was not reviewed.** The browser clipper is the other half of the clip trust boundary; I read
  only its README. The server side is covered.
- **`SettingsModal.tsx` was not read end to end** (62 KB). I read the shell and the profiles tab, which is where
  the import finding came from. Other tabs may hold similar issues.
- **The five stylesheets (~127 KB) were not read**, only grepped for focus, outline and motion patterns. Visual
  regressions, layout bugs at unusual window sizes, and theme-token gaps in the dark palette are unassessed.
- **No macOS or Linux verification.** Several findings are Windows-specific (`setLoginItemSettings` registry
  writes, case-folded path comparison, reserved filenames); the mac/Linux paths in `vaultApp.ts` and
  `quickNote.ts` were read but not reasoned about as carefully.
- **Multi-profile, large-vault and network-share behaviour** — the conditions under which several findings turn
  from latent to visible — could not be exercised.

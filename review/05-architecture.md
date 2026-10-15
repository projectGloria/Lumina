# Architecture and maintainability

The structure is good and the reasoning behind it is unusually well documented — the module headers explain
*why*, not *what*, and several of them correctly anticipate the failure mode they exist to prevent. The findings
below are where that discipline has gaps, not where it is absent.

---

### [High] 27 000 lines of source, 172 lines of tests, and all of them cover the 5% of the codebase that is Quick Note

**Where:** `tests/` (2 files, 18 cases) against `src/` (~27 300 lines)
**Detail:** Line counts by area:

| Area | Lines | Tested |
|---|---|---|
| `src/renderer` | 17 042 | no |
| `src/main` | 5 080 | `noteWriter` only |
| `src/shared` | 3 449 | the four `quicknote*` modules only |
| `src/quicknote` | 1 476 | via the shared modules |
| `tests` | 172 | — |

There are 98 exported functions in `src/shared` and 129 in `src/main`. The suite imports seven modules:
`shared/quicknoteSession`, `shared/quicknoteSettings`, `shared/quicknoteShortcuts`, `shared/quicknoteTheme`,
`main/quicknote/cache`, `main/quicknote/config`, `main/noteWriter`.

Untested, despite being pure, exported, and explicitly designed for testability:

- `src/shared/clip.ts` — the header states: *"the whole point of keeping it here is that `tests/clip.test.ts` can
  hammer it without standing up a server."* **`tests/clip.test.ts` does not exist.** This is the validator for
  the only untrusted input the application accepts over a socket.
- `src/main/clipServer.ts` — *"The parsing and predicate half is exported and pure, because that is the half
  worth testing and the half that is easy to get subtly wrong."* `tokenMatches`, `isLoopbackHost` and
  `isExtensionOrigin` — the three functions the clip server's security rests on — have no tests.
- `src/main/paths.ts` — `safeJoin`, `safePathUnder`, `isIgnored`, `fileArgsFrom`, `vaultContaining`. The
  traversal guard for every filesystem operation in the app.
- `src/shared/markdown-parse.ts` — 18 KB of link resolution, tag extraction, frontmatter parsing and code
  masking, shared by the indexer and the editor precisely so the two cannot disagree. Nothing pins that contract.
- `src/shared/homeLayout.ts` — `normalizeLayout`/`compact`, described in `homeStore.ts:129-131` as the thing that
  makes a hand-edited `home.json` safe.
- `src/main/openFile.ts` — written without an `electron` import specifically so it stays testable
  (`transcribe.ts:11-13` says the same of itself).

**Impact:** Several modules were shaped — at real cost to their structure — to be testable, and then not tested.
That is the worst of both: the indirection is paid for and the benefit is not collected. Two of this review's
findings (the `.lumina/previews` path mismatch, the missing `removeColorOverrides` call) are exactly the kind a
handful of unit tests would have caught, and the security-critical predicates have no regression net at all.
**Fix:** Start with the three files that name their own missing tests: `clip.ts`, `clipServer.ts`, `paths.ts`.
They are pure, they need no Electron, and the existing `vitest.config.ts` already resolves `@shared`.
**Confidence:** Verified.

---

### [Medium] `SettingsModal.tsx` is a 62 KB single component file

**Where:** `src/renderer/src/components/settings/SettingsModal.tsx` (62 001 bytes, ~1 500 lines)
**Detail:** It is the largest file in the repo by 11 %, and it holds the tab shell plus every tab body —
appearance, editor, daily notes, hotkeys, snippets, voice, clipper, music, home, profiles — in one module with
locally-defined subcomponents (`SettingsProfilesTab` at `:1233`, and others). Three tabs have been extracted
(`ThemeEditor`, `SpeechPacks`, `MicTester`), which shows the seam exists and was simply not followed through.
**Impact:** Merge conflicts, slow editor tooling, and a file nobody reads end to end — which is how the
"apply an imported preset without showing what it changes" gap in `03-security.md` survives.
**Fix:** One file per tab under `components/settings/`, matching the three already split out.
**Confidence:** Verified.

---

### [Medium] Path-cleanup logic is duplicated across two call sites and has already drifted

**Where:** `src/renderer/src/lib/actions.ts:444-457` vs `src/renderer/src/App.tsx:163-171`
**Detail:** Deleting a note has to forget it from five path-keyed settings maps plus the editor, the tab strip
and history. In-app deletion does five; the watcher path does three. The rename path is a *third* copy —
`promptRename` (`:399-406`) and `movePath` (`:425-432`) each call the same seven rebase functions in the same
order, inline.
**Impact:** The delete copies have already diverged (that is the Medium bug in `01-bugs.md`). Three inline
copies of a seven-call sequence means the next widget or settings map that stores a path will be wired into
some of them and not others.
**Fix:** `forgetPath(path)` and `rebasePath(from, to)` in `actions.ts`, called from all sites. The board already
solves this properly via `WidgetPathHooks` — the same idea applied one level up.
**Confidence:** Verified.

---

### [Medium] `ipc.ts` mixes channel wiring with substantial business logic

**Where:** `src/main/ipc.ts` (32 KB), specifically `:798-870`
**Detail:** The file's job is registering handlers, and for ~90 % of it that is what it does. Then
`registerIpc` contains a MIME-type table (`:798-808`), a size constant (`:809`), and `embedLocalImages`
(`:811-870`) — a 60-line function doing regex HTML rewriting, candidate path resolution and base64 encoding,
declared *inside* the registration function so it is re-created on every call and cannot be imported or tested.
**Impact:** The one genuinely algorithmic piece of the export pipeline is the one piece that is unreachable from
a test, and it is where both export bugs in this review live (the `$&` replacement bug and the O(N²) splice).
**Fix:** Move it to `src/main/export.ts` alongside the MIME table and export it.
**Confidence:** Verified.

---

### [Low] Three spellings of one directory name, which is what caused the Critical bug

**Where:** `src/main/linkPreview.ts:35`, `:38`, `:83`, and `src/main/ipc.ts:842`
**Detail:** `linkpreviews` (mkdir), `linkpreviews` (returned path), `previews` (write target), `previews`
(export resolver). Four occurrences, two spellings, no shared constant — and `.lumina/linkpreviews` is not
declared anywhere alongside the other `.lumina` paths in `settings.ts:296-302`, where `settingsFile`, `themeFile`,
`workspaceFile`, `homeFile`, `cacheFile` and `snippetsDir` all live.
**Impact:** Directly caused the broken-thumbnails bug. `HOME_COVER_DIR` (`shared/homeCovers.ts`) shows the
project's own correct pattern for this.
**Fix:** Add `previewDir`/`previewRel` to the group in `settings.ts` and derive all four uses from it.
**Confidence:** Verified.

---

### [Low] No linter is configured, and several findings here are lint-catchable

**Where:** `package.json:8-21` — `typecheck`, `test`, build scripts; no `lint`. `AGENTS.md:25` states this is
deliberate ("no formatter or linter is configured").
**Detail:** TypeScript strict mode is on and `npm run typecheck` passes clean on both projects, which catches a
lot. But the findings it structurally cannot catch include:

- `Editor.tsx:180` carries `// eslint-disable-next-line react-hooks/exhaustive-deps` — a suppression for a rule
  that is not running. The adjacent effect at `:194` has the over-broad dependency array that causes the
  per-keystroke `doc.toString()` in `02-performance.md`; `react-hooks/exhaustive-deps` plus review would have
  surfaced it.
- `useModalTrap`'s unstable-dependency bug (`SpeechSetup.tsx:26`) is the classic case for that same rule.
- `jsx-a11y/no-static-element-interactions` and `click-events-have-key-events` would flag every `FileTree` row.

**Impact:** Three distinct findings in this review trace to two ESLint rules that are standard for a React
codebase.
**Fix:** `eslint` with `typescript-eslint`, `eslint-plugin-react-hooks` and `eslint-plugin-jsx-a11y`, at warning
level to start. The existing eslint-disable comment suggests this was once intended.
**Confidence:** Verified.

---

### [Low] `applyChanges` is fire-and-forget, so two watcher batches can interleave

**Where:** `src/main/ipc.ts:310` (`(changes) => void applyChanges(changes)`), `:358-382`
**Detail:** Each invocation awaits per-file indexing, then `readTree()` and `getIndex()`, then sends. Two
overlapping batches can complete out of order and push a staler tree after a fresher one. The codebase already
has the idiom for this — `settings.ts:269-275` and `:277-290` serialise app-state writes behind
`appStateUpdates`, and `homeStore`/`workspaceStore`/`settingsStore` each keep a `persistChain`.
**Impact:** Latent. The tree is re-read fresh each time, so the window for a visibly wrong result is small, but
nothing prevents it.
**Fix:** Chain it the way the stores already do.
**Confidence:** Verified.

---

## Worth keeping

Noting these so they are not "simplified away" by someone who has not read the comments:

- **Commands as data** (`lib/commands.ts`) genuinely pays off: one registry feeds the palette, the global
  keydown handler, the settings rebind UI, the slash-command surface and the CodeMirror keymap
  (`extensions.ts:99-131`), and the editor/global dispatch split at `App.tsx:324` is correct.
- **The widget path-hook registry** (`actions.ts:629-656`, `home/widgets/index.ts:69`) is the right call. The
  inversion is unusual, but the comment explains precisely why the import cannot go the other way, and it means
  a new widget declares its own path fields instead of someone remembering to edit a rename handler.
- **The split-bundle Quick Note dispatcher** (`main/index.ts`) — synchronous, pre-`ready`, separate rollup inputs
  so the vault app's privileged-scheme registration is preserved. Subtle and correct.
- **Vault-generation guards** (`editorStore.ts:34`, `homeStore.ts:68`) are the right pattern for async reads
  racing a vault switch. The gap is that main-process writes have no equivalent — see the High bug in
  `01-bugs.md`.
- **`toPlainText`/`maskCode` shared between indexer and editor** so link resolution cannot diverge. Sound; it
  just needs tests and a cheaper word count.

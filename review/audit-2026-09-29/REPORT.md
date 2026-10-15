# Lumina code audit — 29 September 2026

## Summary

The main risks are lost or misdirected edits, followed by indexing cost. Passing unit tests currently gives little assurance about editor lifecycle, vault switching, external changes, or shutdown.

This review identifies **20 findings** below. Each includes the trigger, consequence, evidence, and a suggested fix. High means possible loss/corruption of user content or a substantial responsiveness problem. Medium means a broken feature, state inconsistency, or a scaling problem with narrower impact. Findings marked **reproduced** were exercised against the current implementation; **code trace** means the control flow is clear but the complete user workflow was not run.

No application source was changed. Review files and isolated reproductions were added in this directory; the production build regenerated `out/`. The existing `review/00-summary.md` predates this audit and contains findings that have since been fixed.

## Validation and scope

- Existing tests: **173 passed across 10 files**.
- TypeScript: **both projects passed**.
- ESLint: **0 errors, 16 warnings**, mostly accessibility, plus one hook dependency warning.
- Production build: **passed**. Vite reports ineffective dynamic imports where modules are also imported statically. The main renderer entry is about **2.42 MB uncompressed**; this is an observation, not a measured startup regression.
- Added isolated checks: **12 passed across 5 files**, covering store races, external conflicts/deletion, split buffer ownership, settings removal, export markup, link resolution, phrase search, network address filtering, shutdown acknowledgement, dictation span corruption, and the resolver benchmark.
- Actual Electron/Chromium runtime: loaded the built Quick Note UI in a hidden window with a mocked bridge and an isolated temporary profile. Confirmed cross-document undo and replacement at stale offsets. No user notes were loaded or saved.
- Measured link resolution with synthetic vault paths; timings are local microbenchmarks, not end-to-end application latency.

The review covered the main process, preload interfaces, both editors, persistence stores, shared parsing/search/link logic, profile flows, voice and music flows, Home state/widgets, browser extension, export, and build/installer configuration. Persistence and editing paths received the deepest inspection. Smaller UI components, styles, settings controls, and ancillary scripts received targeted inspection rather than a complete visual or platform audit. Vendored Readability was treated as a dependency.

Not exercised: a real user vault, packaged installation/uninstallation, actual microphone/Whisper hardware, browser-extension installation, network-share failures, and macOS/Linux behavior. This directory has no Git repository, so there is no commit SHA to pin the review to.

## High-priority correctness findings

### 1. Failed saves do not prevent quitting or switching vaults

**High · reproduced timeout behavior; traced callers**

**Locations:** `src/main/ipc.ts:265`, `src/main/vaultApp.ts:98`, `src/main/vaultApp.ts:270`, `src/renderer/src/App.tsx:193`.

The renderer deliberately withholds `appFlushed` when saving fails or buffers remain dirty. However, `flushRenderer()` resolves through the same `done()` function after three seconds, even with no acknowledgement. Window close then destroys the renderer; application quit calls `app.exit(0)`; vault opening proceeds and resets outgoing buffers.

**Trigger:** make a note unwritable, disconnect its drive, or leave enough saves/index work pending to exceed the timeout, then close or switch vaults. The error toast does not stop the operation and unsaved text has no recovery journal.

**Fix:** return a distinct failure/timeout result and abort the transition. Offer retry or an explicit discard choice; persist recoverable drafts. Keep the editor frozen or perform a final revision check during a successful transition. Use request IDs for flush acknowledgements.

### 2. An external-edit conflict is announced, then autosave overwrites it

**High · reproduced**

**Locations:** `src/renderer/src/store/editorStore.ts:249`, `src/renderer/src/store/editorStore.ts:112`, `src/main/vault.ts:173`.

When a dirty note changes externally, `externalChange()` shows a toast and returns. Its existing autosave timer is still armed. The write API takes no expected mtime/content revision, so the local buffer overwrites the external version after the debounce expires.

The reproduction delivers a conflict and advances the timer: `notes.write('Note.md', 'local edit', ...)` still runs.

**Fix:** mark the buffer conflicted, suspend autosave, retain both versions, and require a resolution. Add a disk-version check to the write operation. A notification alone is not conflict handling.

### 3. External deletion or rename discards unsaved buffers immediately

**High · reproduced**

**Locations:** `src/renderer/src/App.tsx:161`, `src/renderer/src/lib/actions.ts:425`, `src/renderer/src/store/editorStore.ts:202`.

Watcher `unlink`/`unlinkDir` events call `forgetPath()`, which closes buffers, cancels autosave timers, and removes tabs without checking dirty state. Renaming a file externally produces deletion/addition events and has the same risk.

**Trigger:** type into a note, then remove or rename it through Explorer or a sync process before autosave. The unsaved version disappears from memory without a prompt or recovery copy.

**Fix:** preserve dirty buffers as missing/conflicted documents and let users restore or save them elsewhere. Separate external deletion from a user-confirmed in-app delete.

### 4. Quick Note Undo can replace one document with another document's text

**High · reproduced in Electron**

**Location:** `src/quicknote/main.ts:235`.

Tab switching replaces the shared textarea content through `document.execCommand('insertText')`. That records the tab switch in the textarea's single native undo stack. Undo therefore crosses document boundaries.

**Observed:** B contained `BRAVO document`; switching to A showed `ALPHA document`; pressing Undo changed A to `BRAVO document`, and its title became `*C:/audit/A.md - Quick Note`. Saving would overwrite A with B's text.

**Fix:** use an editor state/history per document. Clearing native history during tab swaps is a safer interim measure than recording the swap as an edit.

### 5. Quick Note Replace uses stale match offsets after typing

**High · reproduced in Electron**

**Locations:** `src/quicknote/main.ts:706`, `src/quicknote/findReplace.ts:346`.

Typing calls `renderHighlights()` but does not recalculate `matches`. `replaceCurrent()` trusts the old offsets and the previous selection flag.

**Observed:** search/select `dog` in `cat dog`, insert `XX` at the beginning, and replace the selected match with `fox`. The result is `XXcafoxog`, rather than `XXcat fox`.

**Fix:** recompute or map matches after every document edit; invalidate the selected-match flag; check that the current source range still matches before replacing. Reuse one compiled search expression per query where possible.

### 6. Live dictation overwrites manual edits at stale offsets

**High · reproduced with real CodeMirror state and mocked transcription**

**Location:** `src/renderer/src/lib/voice.ts:64`.

The interim span stores raw `{from,to}` positions. Despite the comment promising transaction mapping and content verification, validity only checks bounds. Inserting text before the provisional transcript shifts it, but the next transcript overwrites the old range.

**Observed:** `prefix guess` → manually insert `NEW ` → final transcription produces `NEW prefinal  uess`, corrupting surrounding prose.

**Fix:** keep the provisional range in a CodeMirror state field and map it through every change. Invalidate it when its content is edited. Attach callbacks to a specific vault, document, and phrase generation; current live callbacks also lack a phrase identifier.

### 7. Vault switching does not isolate old watchers and metadata writes

**High · code trace**

**Locations:** `src/main/ipc.ts:320`, `src/main/ipc.ts:399`, `src/main/ipc.ts:602`, `src/main/ipc.ts:814`, `src/main/ipc.ts:828`.

`openVault()` changes the global root before building the new index, and replaces the old watcher only after the build. Queued change batches carry relative paths without a vault identity. An outgoing vault's deletion can consequently call `forgetNote()` or `forgetPath()` against the incoming vault. In-flight indexing also writes into one global notes map.

Meanwhile, the old UI remains usable during the new build. Settings, workspace, theme, and Home writes use the main process's current root without an expected-vault argument. A layout/settings change after the initial flush can therefore be persisted into the incoming vault. `openVault()` itself is not serialized against another open request.

**Fix:** make switching a serialized transaction: freeze outgoing mutations; successfully flush; stop/drain old watchers; build vault-specific state; activate and publish it together. Stamp every request, watcher batch, index result, and response with a vault generation. Checking only note writes is insufficient.

### 8. A clip can start in one vault and finish in another

**High · code trace**

**Location:** `src/renderer/src/lib/clipToNote.ts:227`.

`clipToNote()` reads A's clipper settings and waits for image downloads, then calls `notes.create()` without `forVault`. Switch to B during those downloads and the note is created in B while downloaded images may already be in A. Both the note's destination and its attachment links become wrong.

Other asynchronous creators (`ensureNote`, `createFromLink`, `ensureDailyNote`) also omit the available vault argument. Attachment and voice operations carry paths without stable vault ownership.

**Fix:** capture the vault at operation start and keep it through all reads, downloads, creates, and UI updates. Either finish against that explicit vault or cancel and preserve the pending operation when the vault changes.

### 9. Quick Note restores stale file contents without checking disk

**High · code trace**

**Locations:** `src/quicknote/main.ts:865`, `src/quicknote/main.ts:findByPath/openResults`, `src/main/quicknote/files.ts:writeDocument`.

Session restore treats cached `text` and `savedText` as authoritative even for clean file-backed tabs. It does not read those files again. Opening the same file explicitly focuses the cached tab and deliberately ignores the newly read document. There is no mtime/hash conflict check before a save.

**Trigger:** close Quick Note with a file tab open, edit the file elsewhere, restart Quick Note, make a small edit, and save. The save replaces the external changes with the older cached document plus the new edit.

**Fix:** reload clean file-backed buffers on restore; reconcile dirty drafts against current disk content; store and check a disk fingerprint before overwriting. Explicit reload should be available.

## Other correctness findings

### 10. Late save completion modifies a new vault's same-name buffer

**Medium · reproduced**

**Location:** `src/renderer/src/store/editorStore.ts:147`.

Loads capture `vaultGeneration`, but saves do not. A save started for A can complete after `reset()` and update B's `Note.md` buffer to `saved: 'A edited'`. The reproduction leaves B's actual content unchanged but incorrectly marks it dirty. If contents happen to match, it can instead report a buffer clean on the strength of a different vault's save. Finalizers can also clear a newer save indicator.

**Fix:** guard save completion/finalization with generation plus buffer/save identity, and drain or invalidate outstanding saves before reset.

### 11. Local image embedding generates invalid export HTML

**Medium · reproduced**

**Location:** `src/main/export.ts:122`.

`IMG_RE` captures the attributes following `<img`, but the replacement treats the capture as if it contains `<img` and calls `prefix.slice(4)`.

**Observed:** `<img src="image.png" alt="example">` becomes `<img="data:image/png;base64,AQID" alt="example">`. Ordinary local image exports consequently lose their image element. Both HTML and PDF export use this function.

**Fix:** preserve `prefix` intact, preferably transform with a parser, and test actual output elements. Also move the global regex into the function: its mutable `lastIndex` is currently shared across calls that await filesystem work.

### 12. Icon/color/custom-image overrides cannot be removed

**Medium · reproduced for icons; same implementation for other maps**

**Locations:** `src/renderer/src/store/settingsStore.ts:148`, `src/renderer/src/lib/actions.ts:595`.

Removal constructs a map without the key and passes it to `patch()`. Recursive merging merges that map into the old one, retaining omitted keys. Renaming a map entry likewise adds the new key without removing the old one. The external-delete cleanup therefore still leaves these overrides behind despite calling the cleanup helpers.

**Fix:** define these dictionaries as replacement fields, or add explicit delete operations. Review hotkey reset paths using the same merge semantics.

### 13. Closing a tab releases a note still displayed in split view

**Medium · reproduced at store/action level**

**Location:** `src/renderer/src/lib/actions.ts:124`.

`wanted()` checks tab references and widget holds but ignores `useWorkspace.getState().splitPath`. Open A in split view, leave the primary pane on B, and close A's tab. A's buffer is released even though its split editor remains mounted. Its loading effect depends only on `path`, so it does not reload the removed buffer.

**Fix:** treat the split pane as a buffer owner and release its hold on closure or path changes. Use a shared ownership policy for tabs, split panes, and widgets.

### 14. Explicit relative links resolve to the wrong document

**Medium · reproduced**

**Location:** `src/shared/markdown-parse.ts:408`.

Normalization removes leading `./` before the resolver checks whether the target was relative. A root-level match then wins over the source folder. The `../` branch strips extensions before matching, so it can select `.md` when `.mdx` was explicitly requested.

**Observed:** `./Thing.md` from `Folder/Source.md` resolves to root `Thing.md` even when `Folder/Thing.md` exists; `../Thing.mdx` resolves to `Thing.md` when both extensions exist.

**Fix:** preserve relative intent until resolution is complete and honor explicit extensions before extensionless fallback. Add tests distinguishing wiki shorthand from ordinary Markdown relative paths.

### 15. Exact-phrase search can report no results when a match exists

**Medium · reproduced**

**Location:** `src/main/search.ts:122`.

The result limit is applied to term-search candidates before exact-phrase filtering. High-ranking notes containing separated terms consume the limit, excluding lower-ranked true phrase matches. The test uses a limit of one to show the behavior; the UI's limit of 60 has the same problem with more distractors.

**Fix:** scan candidates until enough exact matches are found, with bounded disk-read concurrency. Phrase options also currently bypass `titleOnly`; combine filters explicitly.

### 16. Private-network fetch protection can be bypassed

**Medium · reproduced address bypass; redirect path identified by code trace**

**Locations:** `src/main/netGuard.ts:50`, `src/main/netGuard.ts:83`, `src/main/net.ts:27`.

The mapped IPv6 check recognizes only dotted IPv4 tails. URL parsing canonicalizes `http://[::ffff:127.0.0.1]/` into a hexadecimal IPv6 hostname, which the function accepts as public. The same is true for mapped `192.168.1.1`.

Separately, the code validates only the original URL and then lets the fetch follow redirects; redirect destinations are not passed through the guard. DNS checking is also separate from the actual connection.

**Fix:** normalize/inspect IPv6 bytes, including mapped forms; validate every redirect hop; enforce the address policy at connection time where possible. Keep a strict redirect limit. The isolated reproduction only evaluated the guard and sent no network probe.

## Performance findings

### 17. Every saved note triggers potentially quadratic link resolution

**High · measured**

**Locations:** `src/main/indexer.ts:54`, `src/shared/markdown-parse.ts:438`, `src/main/ipc.ts:519`.

Every successful note save reindexes the note and awaits `getIndex()`. Snapshot rebuilding resolves every link across all notes. Each `resolveLink()` scans paths and repeatedly normalizes strings. Missing links and many shorthand links cost O(number of notes) each, making the complete pass O(links × notes).

Synthetic measurements on this machine, with one missing link per note:

| Notes | Links | Resolution time |
| --- | --- | --- |
| 1,000 | 1,000 | 661 ms |
| 2,000 | 2,000 | 2,454 ms |
| 4,000 | 4,000 | 13,085 ms |

These timings measure the resolver loop, excluding disk reads, IPC serialization, and UI work. The final combined validation run measured 626 / 2,400 / 11,649 ms respectively; the scaling problem persisted. The real rebuild yields every 500 notes, which helps scheduling but does not remove the cost; a batch can still block main-process work for a substantial interval. Save acknowledgements wait for this indexing work, compounding finding 1.

**Fix:** build maps for exact paths, source-folder names, shallowest basename candidates, and aliases once per index generation. Recompute link resolution only when names/aliases/link sets change. A disk-save acknowledgement should not wait for full-vault graph reconstruction. Send index deltas where possible.

### 18. The main editor still performs redundant document-wide work while typing

**Medium · code trace, not a latency measurement**

**Locations:** `src/renderer/src/editor/extensions.ts:177`, `src/renderer/src/editor/Editor.tsx:192`, `src/renderer/src/editor/livePreview.ts:675`, `src/renderer/src/components/Workspace.tsx:88`.

- The update listener serializes the document into the store on every edit.
- The content-sync effect serializes it again. For an ordinary local edit the view already has the new content, so its length equals the buffer length and the claimed length fast path still reaches `toString()`.
- Block decorations walk the parsed syntax tree for every document change; restricting caret-only rebuilds to line transitions does not fix the typing path.
- `WordCountBar` calculates word count even when its display setting is false, because the early return occurs after the calculation. The status bar independently calculates the same count. Deferred rendering changes scheduling, not the total work.

**Fix:** distinguish local editor transactions from external buffer updates; map/update block decorations incrementally; share or lazily calculate counts. Benchmark representative long notes, including tables, links, and fenced blocks, before choosing thresholds.

### 19. Quick Note rebuilds the entire line gutter several times per keystroke

**Medium · code trace, not a latency measurement**

**Locations:** `src/quicknote/main.ts:93`, `src/quicknote/main.ts:706`, `src/quicknote/main.ts:717`, `src/quicknote/main.ts:723`.

`metrics()` splits the whole document, builds every line number, replaces the gutter text, and splits the prefix up to the caret. Input, keyup, selection, and click each invoke it. Even a caret move through a long file rebuilds an unchanged gutter. The accepted file limit is 16 MB, and the textarea/gutter are not virtualized.

Draft persistence also clones and serializes every open document, including its last-saved text, on each persistence event rather than only changed buffers.

**Fix:** separate position tracking from document metrics; update gutter only when line count changes; coalesce work per frame; use incremental line tracking/virtualization for larger files. Persist changed buffers without copying every clean document on each cursor-related save.

### 20. Clipping a page starts an unbounded number of image downloads

**Medium · code trace**

**Location:** `src/renderer/src/lib/clipToNote.ts:173`.

Every distinct image URL is sent concurrently through `Promise.all()`. Per-image limits do not bound total concurrency or aggregate memory. A gallery/full-page clip can create hundreds of IPC calls, fetches, response buffers, and filesystem writes while the user is editing.

**Fix:** use a small download pool, an image-count/aggregate-byte budget, and cancellation tied to the clip/vault operation. Prefer progressive completion over holding the entire clip behind unrestricted downloads.

## Additional observations

These are follow-up areas, not included in the 20 findings above:

- `buildIndex()` walks/stats notes to list them, then checks them again sequentially. This is likely expensive on a network drive; measure before choosing read concurrency.
- Self-write suppression drops *all* events for a path for 1.5 seconds (`vault.ts:69`, `watcher.ts:25`), including genuine external edits/deletes in that interval. A content/revision-based comparison is safer.
- Main-editor unmount cleanup clears/destroys `view.current` before the later cleanup can remember its session. Verify undo restoration when moving from a note to Home, or toggling split layout, as distinct from switching between note tabs.
- Search results do not refresh when the index changes unless a query/filter dependency also changes. Read-mode rendered links similarly cache index-dependent resolution without depending on the index.
- Settings normalization is a recursive merge, not schema validation. Values such as `editor: null` or `starred: null` survive and can break rendering after importing or manually editing a settings file.
- The extension's Enter handler calls `clip()` while an earlier clip is pending; disabling the button does not guard the function. Repeated Enter can produce duplicate captures. Extension requests also lack an explicit timeout.
- Quick Note drops `onOpenFiles` events outright while `busy` rather than queuing them.
- Voice cancellation/startup, phrase-final/interim ordering, and switching focused split panes deserve dedicated integration tests. The current interim bookkeeping assumes more stable document/phrase ownership than the code enforces.

## Recommended implementation order

1. **Protect text:** make failed flushes block transitions; add conflict/recovery state; preserve dirty externally deleted notes.
2. **Isolate document state:** separate Quick Note histories, refresh find matches, map dictation spans, and reconcile restored files with disk.
3. **Make vault ownership explicit:** serialize transitions and stamp all asynchronous work, including watchers, settings, attachments, and clip jobs.
4. **Remove the main-process bottleneck:** indexed link lookup and disk-save acknowledgement independent of full index rebuilding.
5. **Fix bounded feature defects:** export markup, map deletion, split ownership, relative links, phrase search, network guard.
6. **Profile typing and capture workloads:** reduce repeated scans and limit image concurrency.

## Reproductions

Run from the project root:

```powershell
npx vitest run --config review/audit-2026-09-29/vitest.config.ts
npm run build
node node_modules/electron/cli.js review/audit-2026-09-29/quicknote-runtime.cjs
```

The audit tests assert **the observed defective behavior** so they are repeatable evidence. They are intentionally outside the normal `tests/` suite. When fixing a finding, convert its reproduction into a regression test that expects the corrected behavior. The benchmark has a 60-second timeout because the current resolver exceeds Vitest's default timeout at 4,000 notes.

The Electron runner uses mock documents and a mock persistence bridge. It creates an isolated temporary Chromium profile; it does not launch the normal app against your stored profile or vaults.

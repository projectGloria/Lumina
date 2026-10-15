# Correctness bugs

Ranked by severity. Every finding names a line and a trigger.

---

### [Critical] Link-preview thumbnails are written to a directory that is never created, so the feature is silently 100% broken

**Where:** `src/main/linkPreview.ts:35`, `:38`, `:83-88`
**Trigger:** Turn on Settings → Editor → "Fetch link previews", open any note containing a bare http(s) link. Every time.
**Detail:** Three different paths are used for one folder:

```ts
const previewDir = (vault) => path.join(luminaDir(vault), 'linkpreviews')  // :35  — what gets mkdir'd
const previewRel = (name) => `.lumina/linkpreviews/${name}`                 // :38  — what is returned
const previewTarget = path.join('.lumina', 'previews', name)                // :83  — where the write goes
```

`cacheImage` resolves `safeTarget` from `.lumina/previews/…`, then creates `.lumina/linkpreviews/`, then writes to
`.lumina/previews/…` — whose parent does not exist. `fs.writeFile` throws `ENOENT`, the bare `catch` at
`:89` swallows it, and the function returns `undefined`.

I reproduced the exact sequence against a temp directory: `WRITE FAILED: ENOENT`, with `.lumina` containing only
`linkpreviews`.

Even if the write succeeded, `previewRel` points the renderer at `.lumina/linkpreviews/<name>` while the bytes
would be in `.lumina/previews/<name>`, so the `lumina://vault/…` request would 404. Two independent faults on
the same path. Note that `src/main/ipc.ts:842` (the HTML/PDF export image resolver) uses `.lumina/previews`,
which suggests that is the intended name and `previewDir`/`previewRel` are the stale pair.

**Impact:** Link banners never show a thumbnail or favicon. No error surfaces anywhere — the card just renders
without an image, which is indistinguishable from "this page publishes no og:image". The bytes are downloaded
over the network and discarded on every open of every note, since nothing is ever cached.
**Fix:** Pick one constant. Replace all three with a single `PREVIEW_DIR = 'previews'` and derive the absolute,
relative and mkdir paths from it; mkdir `path.dirname(safeTarget)` rather than a separately-computed directory.
**Confidence:** Verified (reproduced).

---

### [High] A vault switch leaves the editor live while the main process moves the vault root, so an autosave can write one vault's note into another vault

**Where:** `src/main/ipc.ts:293-322` (`openVault`), `src/renderer/src/store/editorStore.ts:106-120` (`setContent` autosave), `src/renderer/src/App.tsx:386-414`
**Trigger:** Type in a note, then switch vaults (recent vault, `vault:open`, or a profile switch) and type one
more character while the new vault is indexing.
**Detail:** `openVault` runs:

```ts
if (getRoot()) await flushRenderer()   // :296  — 3s timeout, then proceeds regardless
await setRoot(dir)                     // :298  — the root moves here
…
const stats = await buildIndex()       // :307  — seconds on a large vault
…
send(CH.vaultOpened, payload)          // :314  — only now does the renderer reset() its buffers
```

Between `:298` and `:314` the renderer still holds the *old* vault's buffers with their autosave timers armed
(`Math.max(120, autosaveDelay)`, default 400 ms). Nothing blocks the editor: `useVault.loading` is set by
`pickVault`, but `App.tsx` renders `<Workspace/>` on `vault` alone and `Editor.tsx` never consults `loading`
(grep for `s.loading` shows it gating only `Welcome`, `TasksWidget`, `TagsWidget`, `RecentWidget`).

A timer firing in that window calls `window.lumina.notes.write(rel, content)`, and `writeNote` resolves `rel`
against `requireRoot()` — now the **new** vault. `writeNote` finishes with `fs.rename(tmp, abs)`, which
overwrites silently.

The 3-second `flushRenderer` timeout widens this further: a slow flush lets main proceed while writes are still
queued.

**Impact:** The old vault's text overwrites a same-named note in the new vault (data loss in the new vault), and
the edit is lost from the old one. The renderer's own `reset()` guard (`editorStore.ts:180-195`) is documented
as protecting against exactly this, but it only runs once `vaultOpened` arrives — after the window has closed.
**Fix:** Stamp writes with the vault they were composed against. Have `openVault` capture a generation counter,
pass it (or the vault path) with `CH.noteWrite`, and reject a write whose generation no longer matches. Blocking
editor input for the duration is a weaker fix — it narrows the window without closing it.
**Confidence:** Verified (code path traced end to end; the timing window is wide on any vault that takes more
than a few hundred ms to index).

---

### [High] Every settings write tears down and rebinds the web-clipper HTTP server

**Where:** `src/main/ipc.ts:536-555` (`CH.settingsSet` → `syncClipServer`), `src/main/ipc.ts:132-150`, `src/main/clipServer.ts:200-227`
**Trigger:** Star a note, pin a note, change an icon colour, change the sort order — anything that calls
`useSettings.patch`. Happens ~250 ms later, every time, while the clipper is enabled.
**Detail:** `syncClipServer` has no "is this already the running configuration?" check:

```ts
clipStartError = await startClipServer({ port, token, onClip })   // ipc.ts:139
```

and `startClipServer` begins with `await stopClipServer()` (`clipServer.ts:201`). The socket is closed and
re-`listen`ed on the same port.

The chain that gets there from a star toggle is: `actions.ts:508 toggleStar` → `settingsStore.ts:222 patch` →
`commit` → `persist` (250 ms debounce) → `window.lumina.settings.set` → `ipc.ts:552 syncClipServer`.

**Impact:** Three consequences, in ascending order of annoyance:
1. A clip arriving during the teardown window is refused — the browser extension reports "Could not reach Lumina".
2. `server.close()` does not wait for the listening socket to be fully released before `listen` is called on the
   next tick; a rapid sequence of settings changes can produce a spurious `EADDRINUSE`, which surfaces in the
   settings panel as "Port 41999 is already in use" with no port actually taken.
3. `clipStartError` is overwritten on every save, so a real error can be cleared by an unrelated preference change.

**Fix:** Keep the last-applied `{port, token, enabled}` in `syncClipServer` and return early when nothing that
the server depends on has changed.
**Confidence:** Verified.

---

### [Medium] Deleting a note outside the app leaves its colour and custom-icon overrides behind, and a later note at the same path inherits them

**Where:** `src/renderer/src/App.tsx:163-171` vs `src/renderer/src/lib/actions.ts:444-457`
**Trigger:** Delete a note from Explorer/Finder, or via git, while Lumina is running. Then create a new note at
the same path.
**Detail:** In-app deletion cleans up five settings maps:

```ts
removeStarredPaths(path); removeIconOverrides(path); removeColorOverrides(path)
removeCustomIcons(path);  removePinnedPaths(path)        // actions.ts:452-456
```

The watcher-driven path cleans up three:

```ts
removeStarredPaths(change.path)
removeIconOverrides(change.path)
removePinnedPaths(change.path)                            // App.tsx:167-169
```

`removeColorOverrides` and `removeCustomIcons` are missing.
**Impact:** `settings.colorOverrides` and `settings.customIcons` accumulate dead entries in `settings.json`
indefinitely. More visibly: a new note created at a deleted note's path silently picks up the old note's colour
and uploaded icon, which reads as a bug with no discoverable cause. The orphaned `.lumina/icons/*` image files
are never swept either.
**Fix:** Call all five from both sites. Better: collect them into one `forgetPath(path)` in `actions.ts` and call
that from both — the two lists have already drifted once.
**Confidence:** Verified.

---

### [Medium] The custom icon-colour picker commits the wrong colour and closes itself on the first pointer movement

**Where:** `src/renderer/src/components/FileTree.tsx:290-310` (`pickCustomColor`)
**Trigger:** Right-click a file or folder → Change color… → Custom…, then drag inside the OS colour picker.
**Detail:**

```ts
input.oninput = () => finish(input.value)   // :305
input.onblur  = () => finish(null)          // :306
```

`finish` is one-shot (`settled`) and calls `input.remove()`, which closes the native picker. For
`<input type="color">` Chromium fires `input` **continuously** as the user moves within the picker and fires
`change` only on confirmation. So the first intermediate colour under the cursor wins, is applied, and the dialog
is torn out of the DOM before the user can choose.

`onblur = () => finish(null)` is also suspect: opening the native picker moves focus away from the input in some
Chromium configurations, which cancels the interaction outright.

**Impact:** "Custom…" is effectively unusable — it either applies a colour the user did not pick or does nothing.
**Fix:** Resolve on `change`, not `input`; drop the `blur` handler or replace it with the `cancel` event (which
`pickImageFile` at `actions.ts:720` already uses correctly for the file input).
**Confidence:** Verified.

---

### [Medium] `mailto:` links in read mode do nothing at all

**Where:** `src/renderer/src/editor/ReadView.tsx:151-154`, `src/main/ipc.ts:913-916`
**Trigger:** Open a note containing `[mail me](mailto:someone@example.com)` in read mode and click it.
**Detail:** `ReadView` routes both schemes to the same IPC call:

```ts
if (/^(?:https?|mailto):/i.test(href)) {
  void window.lumina.files.openExternal(href)   // ReadView.tsx:151-152
```

but the handler only honours http(s):

```ts
ipcMain.handle(CH.openExternal, (_e, url: string) => {
  if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
  return Promise.resolve()                      // ipc.ts:914-915
})
```

The click is `preventDefault`ed at `ReadView.tsx:150`, so the browser's own handling is suppressed too.
`render.ts:229` explicitly allows `mailto` through `safeExportUrl`, so the renderer believes the link is live.

**Impact:** Silent dead link — no mail client, no toast, no console message. The user cannot tell whether the
link is broken or the app is.
**Fix:** Allow `mailto:` in the `openExternal` handler (it is the one other scheme `safeExportUrl` already
sanctions), or stop routing it there and let the anchor behave natively.
**Confidence:** Verified.

---

### [Medium] The speech-setup modal steals focus back to its first button on every re-render, and loses the element to restore focus to

**Where:** `src/renderer/src/components/useModalTrap.ts:17-68` (effect deps), `src/renderer/src/components/SpeechSetup.tsx:21-26`
**Trigger:** Open the first-run speech setup and start installing a pack. Progress events re-render the modal
several times a second.
**Detail:** `useModalTrap`'s effect depends on `[options.onClose]`. Most callers pass a stable Zustand action
(`useUi((s) => s.closeModal)`), so the effect runs once. `SpeechSetup` does not:

```ts
const done = (): void => { patch({ voice: { setupPrompted: true } }); close() }   // :21-24
const trapRef = useModalTrap({ onClose: done })                                   // :26
```

`done` is a fresh closure each render, so the effect tears down and re-runs on every render. Each re-run:
- overwrites `previousActiveElement.current` with whatever is focused *inside* the modal (`:18`), so the
  "restore focus on close" target at `:66` becomes a node that is about to be unmounted;
- re-focuses the container's first focusable element (`:25-27`), yanking focus out of wherever the user is.

**Impact:** During a pack install the user cannot keep focus on anything; tab order restarts constantly, and
closing the modal returns focus to nothing rather than to the control that opened it.
**Fix:** Wrap `done` in `useCallback`, or make the hook robust by holding `onClose` in a ref and giving the
effect an empty dependency array.
**Confidence:** Verified.

---

### [Medium] Graph view resets the user's pan and restarts the whole force simulation on every note switch and every autosave

**Where:** `src/renderer/src/components/GraphView.tsx:147` (`draw` deps), `:247-280` (simulation effect), `:67-132` (`graph` memo)
**Trigger:** Open the graph (Ctrl+G), pan/zoom to somewhere useful, then click a node — or just keep typing in a
note with the graph open.
**Detail:** The simulation effect depends on `draw`:

```ts
}, [graph, size.w, size.h, perf, draw])     // :280
```

and `draw` is a `useCallback` over `[size, activeNote, perf, mode]` (`:244`). Clicking a node calls `openNote`,
which changes `activeNote`, which gives `draw` a new identity, which re-runs the simulation effect. That effect
calls `sim.current?.stop()`, builds a brand-new `forceSimulation`, and resets the viewport:

```ts
view.current = { x: size.w / 2, y: size.h / 2, k: view.current.k }   // :274
```

Separately, `graph` is memoised on `index` (`:132`), and `index` is replaced wholesale on every
`CH.indexUpdated` — which `ipc.ts:461` sends after **every note write**. So each autosave rebuilds the node and
link arrays and restarts the simulation too.

In global scope neither event changes the graph's *content*; only which node is highlighted.

**Impact:** The graph re-scatters and re-settles, and the pan jumps back to centre, every time the user clicks a
node or pauses typing. On a large vault that is also a burst of CPU each time.
**Fix:** Split highlight-only state out of `draw`'s dependencies (read `activeNote` from a ref), and key the
`graph` memo on something that actually changes — e.g. a structural signature of nodes/links rather than index
identity.
**Confidence:** Verified.

---

### [Low] HTML/PDF export corrupts an image tag whose attributes contain `$&` or `$'`

**Where:** `src/main/ipc.ts:863-866`
**Trigger:** Export a note containing `<img src="a.png" alt="$&">` (or any `$`-sequence in the tag) to HTML or PDF.
**Detail:** `result = result.replace(item.full, replacement)` — `String.replace` with a string pattern treats `$&`,
`` $` ``, `$'` and `$n` in the *replacement* as substitution patterns. `replacement` is built from `item.suffix`,
which is raw attribute text from the note.
**Impact:** The exported tag contains the matched source text spliced into itself. Cosmetic corruption of the
export only; base64 data URIs cannot trigger it (`+ / =` alphabet contains no `$`).
**Fix:** `result.replace(item.full, () => replacement)`.
**Confidence:** Verified.

---

### [Low] `freePort()` releases the port before `whisper-server` binds it

**Where:** `src/main/whisperServer.ts:59-69`, used at `:129-145`
**Trigger:** Starting live dictation while another process is opening ephemeral ports.
**Detail:** The probe server binds port 0, reads the assigned port, closes, and only then is the port passed to
`spawn`. Classic TOCTOU — anything can claim it in between.
**Impact:** `whisper-server` fails to bind; `waitForReady` polls until the 90-second timeout and reports "Speech
server did not start in time". Rare, and the failure is reported rather than silent.
**Fix:** Let `whisper-server` bind port 0 itself and parse the port from its output, or retry once on failure.
**Confidence:** Verified.

---

### [Low] `writeExclusive` records up to 1000 nonexistent paths as self-writes

**Where:** `src/main/noteWriter.ts:20-36` (`markSelfWrite(candidate)` at `:23`, inside the retry loop)
**Trigger:** Creating a note whose name already exists many times over (`Untitled`, `Untitled 1`, …).
**Detail:** `markSelfWrite` is called for every candidate, including the ones that fail with `EEXIST`. Entries in
`vault.ts`'s `selfWrites` map are only evicted lazily, inside `wasSelfWrite` (`vault.ts:43-52`), which is only
called for paths the watcher actually reports. Candidates that were never created are never reported, so they
stay in the map for the life of the process.
**Impact:** Slow unbounded growth of a `Map<string, number>` in the main process. Not user-visible in practice.
**Fix:** Call `markSelfWrite` only immediately before the write that succeeds, or sweep expired entries on a timer.
**Confidence:** Verified.

---

### [Low] A context menu wider than the window is clipped off the left edge

**Where:** `src/renderer/src/components/ContextMenu.tsx:13-18`
**Trigger:** Narrow the window, then right-click a file (its menu has ten items, one of which is a long path label).
**Detail:** `Math.min(menu.x, window.innerWidth - rect.width - 8)` has no lower bound, so the computed `x` goes
negative when `rect.width > window.innerWidth - 8`.
**Impact:** The left part of the menu, including item labels, is off-screen and unreachable.
**Fix:** `Math.max(8, Math.min(...))` on both axes.
**Confidence:** Verified.

---

### [Low] Renaming anything rewrites the icon, colour and custom-icon maps even when nothing changed

**Where:** `src/renderer/src/lib/actions.ts:568-575`, `:597-603`, `:669-675`
**Trigger:** Rename any note in a vault that has ever had an icon or colour override set.
**Detail:** `renameStarredPaths` (`:520-524`) and `renamePinnedPaths` (`:546-550`) guard with a change check
before calling `patch`. The three map-based siblings do not — they call `patch` unconditionally.
**Impact:** Every rename queues a settings write (and therefore, per the clip-server finding above, a socket
rebind and a login-item registry write) even when no override was affected. `Object.fromEntries` also silently
drops a key if two paths ever rebase onto the same target.
**Fix:** Add the same "did anything actually change?" guard the other two have.
**Confidence:** Verified.

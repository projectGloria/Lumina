# Performance

The two High findings compound: they are both on the per-keystroke path, and both scale with note length rather
than with the size of the edit.

---

### [High] Four full-document passes run on every keystroke, so typing latency grows with note size

**Where:** `src/renderer/src/components/StatusBar.tsx:26`, `src/renderer/src/editor/Editor.tsx:184-194`, `src/renderer/src/editor/extensions.ts:177-179`, `src/renderer/src/components/Workspace.tsx:86-97`
**Trigger:** Type one character in any note. Cost is proportional to the whole document, not the edit.
**Detail:** One keystroke sets off, in order:

1. `extensions.ts:178` — `opts.onChange(update.state.doc.toString())`. Full rope-to-string of the document.
2. `editorStore.setContent` stores it, creating a new `buffers` object and a new buffer object.
3. `Editor.tsx:184-194` — the sync effect has `buffer` (the object) in its dependency list, so it re-runs and
   calls `instance.state.doc.toString()` again at `:187` purely to compare against what it just received.
   A second full serialisation.
4. `StatusBar.tsx:26` — `countWords(buffer.content)`, unmemoised, on a component that is always mounted.
   `countWords` calls `toPlainText` (`markdown-parse.ts:479-492`), which is **eleven chained regex `replace`
   calls over the whole document**, each allocating a new string, followed by a global
   `/[\p{L}\p{N}'’-]+/gu` match that allocates an array of every word.
5. `Workspace.tsx:92` — `WordCountBar` does `countWords` a *second* time when "show word count" is on.

For a 200 KB note that is roughly 2.2 MB of intermediate string allocation plus a ~30 000-element array, twice,
per keypress — on top of two full document serialisations.

**Impact:** Noticeable input lag and GC pressure in long notes. This is the single most user-visible performance
issue in the app.
**Fix:** Three independent wins, cheapest first:
- Drop `buffer` from the `Editor.tsx:194` dependency array (`buffer?.content` and `buffer?.loading` already
  cover it); that removes serialisation #3 on the common path.
- Memoise the word count — `useMemo` on `content` in both `StatusBar` and `WordCountBar`, or better, compute it
  once in a selector and share it.
- Debounce the status-bar word count (it is decorative; 300 ms is imperceptible) or compute it incrementally.
**Confidence:** Verified.

---

### [High] The block-decoration state field walks the entire syntax tree on every keystroke *and* every caret move

**Where:** `src/renderer/src/editor/livePreview.ts:659-724` (`buildBlockDecorations`), `:726-745` (`blockPreviewField.update`)
**Trigger:** Press any arrow key in a long note.
**Detail:** The inline decoration plugin correctly bounds its walk to the viewport:

```ts
for (const visible of view.visibleRanges) {       // :812
  tree.iterate({ from: visible.from, to: visible.to, … })
```

The block field does not — `syntaxTree(state).iterate({ enter … })` at `:678` has no `from`/`to`, so it visits
every node in the document. And it re-runs on a very broad trigger:

```ts
if (tr.docChanged || tr.selection || reparsed || tr.effects.some(e => e.is(refreshPreview))) {
  return buildBlockDecorations(tr.state)          // :735-742
}
```

`tr.selection` means every cursor movement. Inside the walk, each `Table`/`Link`/`URL`/`Autolink` node costs two
`state.doc.lineAt()` lookups, and `activeLines` (`:64-72`) is rebuilt from scratch each time.

The comment at `:729-734` justifies recomputing on reparse (a table below the fold must eventually render) —
that is sound, but it does not require a whole-tree walk on every arrow-key press.

**Impact:** On a document with thousands of syntax nodes, caret movement and typing both pay a full-tree walk.
Combines with the finding above.
**Fix:** Separate the two concerns. Recompute the full walk only when `reparsed` or `refreshPreview` fires; on
`tr.selection` / `tr.docChanged` alone, map the existing `DecorationSet` through the transaction and only
re-derive the ranges that intersect the changed or newly-active lines.
**Confidence:** Verified.

---

### [Medium] Every settings change re-parses the user stylesheet and forces a document-wide style recalculation

**Where:** `src/renderer/src/store/settingsStore.ts:271-330` (`applyTheme`), called from `commit` at `:205`
**Trigger:** Star a note, pin a note, change sort order, set an icon — anything routed through `patch`.
**Detail:** `applyTheme` is called on every `commit`, not only on theme changes. Each call:
- iterates `Array.from(root.style)` and removes every `--lum-*` custom property (`:283-285`), then re-sets ~15
  of them — each `setProperty` on `:root` invalidates style for the whole tree;
- **replaces `snippetStyleEl.textContent` wholesale** (`:324-327`), which forces the browser to discard and
  re-parse the entire user stylesheet and recompute style for every element;
- calls `syncTitleBar()` (`:329`), which schedules a `requestAnimationFrame` that does `getComputedStyle` and
  then an IPC round trip to the main process to repaint the native window buttons.

**Impact:** A visible hitch on every star/pin toggle, scaling with how much CSS the user has in
`.lumina/snippets/`. The IPC + `setTitleBarOverlay` call is pure waste when the theme did not change.
**Fix:** Split `applyTheme` into `applyTokens` (cheap, idempotent) and `applySnippets`; only rewrite
`snippetStyleEl.textContent` when the snippet list or the enable-map actually changed, and only call
`syncTitleBar` when `mode` or the relevant tokens changed.
**Confidence:** Verified.

---

### [Medium] Every settings change unbinds and rebinds the global shortcut and rewrites the Windows login-item registry key

**Where:** `src/main/vaultApp.ts:170-189` (`applyQuickNote`), `src/main/quickNote.ts:37-53` (`bindQuickNoteShortcut`), `:67-72` (`applyLoginItem`)
**Trigger:** Same as above — any `settings.set`.
**Detail:** `ipc.ts:553` calls `onSettingsSaved?.(settings)`, wired at `vaultApp.ts:218` to
`applyQuickNote(settings.quickNote, true)`. That unconditionally:

```ts
globalShortcut.unregister(registered); registered = ''    // quickNote.ts:39-40
… globalShortcut.register(wanted, onTrigger)              // :46
… app.setLoginItemSettings({ openAtLogin, args: [HIDDEN_FLAG] })   // :71
```

with no comparison against what is already bound.

**Impact:** Two things. `setLoginItemSettings` is a registry write on Windows, so starring a note writes to
`HKCU\…\Run`. And there is a real (if narrow) window between `unregister` and `register` in which the global
quick-note shortcut is bound to nothing — a press in that window is dropped.
**Fix:** Early-return from `bindQuickNoteShortcut` when `accelerator.trim() === registered`, and from
`applyLoginItem` when the setting matches `app.getLoginItemSettings().openAtLogin`.
**Confidence:** Verified.

---

### [Medium] Full-text search re-reads up to 60 note files from disk per query

**Where:** `src/main/search.ts:94-125` (`search`), `:66-92` (`lineMatches`)
**Trigger:** Any search from the search panel.
**Detail:** MiniSearch returns matches from memory, then:

```ts
const hits = await Promise.all(
  top.map(async (r) => ({ …, matches: await lineMatches(r.id, terms, phrase) }))   // :114-121
)
```

`lineMatches` calls `readNote` — a full `fs.readFile` plus `fs.stat` — for each of up to 60 results, then splits
the whole file into lines to find the first five matches.

The UI debounces at 160 ms (`SearchPanel.tsx:36-51`), which is the right mitigation and keeps this off the
per-keystroke path, but each *settled* query is still ~120 filesystem operations on the main process.

**Impact:** On a spinning disk, a network share, or with aggressive antivirus, search feels sluggish and the
main process is blocked in between `await`s. The snippet extraction also reads the entire file when it stops
after five matches.
**Fix:** Lower the snippet limit below the result limit (snippets are only needed for results actually rendered
— Virtuoso shows ~15), or cache the last N note bodies. Reading line-by-line rather than whole-file would also
let it stop early.
**Confidence:** Verified.

---

### [Medium] HTML/PDF export is quadratic in the number of images, and PDF export then stuffs the whole thing into a `data:` URL

**Where:** `src/main/ipc.ts:811-870` (`embedLocalImages`), `:899` (`printer.loadURL`)
**Trigger:** Export a note with several embedded images.
**Detail:** Each image is spliced in with `result = result.replace(item.full, replacement)` (`:865`) — a linear
scan of `result`, which grows by ~1.33× the size of each image as base64 data URIs are inserted. With N images
of size S the total work is O(N² · S). `MAX_IMAGE_EMBED_BYTES` is 25 MB per image (`:809`), so a note with ten
2 MB images produces a ~27 MB string re-scanned ten times, on the main process, synchronously between awaits.

PDF export then does:

```ts
await printer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(embeddedHtml)}`)   // :899
```

`encodeURIComponent` inflates the base64 payload further (every `+` and `/` becomes three characters).

**Impact:** The app freezes for the duration of an image-heavy export. For PDF specifically I expect the
`loadURL` to fail outright past a certain size — Chromium caps data-URL navigations — which would surface as the
generic `{ ok: false, error }` at `:907`.
**Fix:** Build the output with a single pass — split on the regex and join the pieces — instead of N `replace`
calls. For PDF, write the HTML to a temp file and `loadFile` it rather than encoding it into a URL.
**Confidence:** Verified for the O(N²) behaviour and the main-process blocking. Needs check for the exact
data-URL size at which `loadURL` fails in Electron 43.

---

### [Medium] The graph calls `getComputedStyle` and reads eight CSS tokens inside its per-frame draw

**Where:** `src/renderer/src/components/GraphView.tsx:153-164`, called from `:266-268` on every simulation tick
**Trigger:** Open the graph; this runs once per animation frame until the simulation settles.
**Detail:**

```ts
const style = getComputedStyle(document.documentElement)          // :153
const token = (name) => style.getPropertyValue(`--lum-${name}`).trim()
const colors = { bg: token('bg'), node: token('graph-node'), … }  // :155-164
```

`getComputedStyle` on the document element forces a style recalculation if anything is pending, and this sits
directly inside the `requestAnimationFrame` callback.
**Impact:** Avoidable layout/style work every frame while the graph animates.
**Fix:** Resolve the palette once per `draw` identity change (it already depends on `mode`) and close over it,
rather than reading it inside the frame.
**Confidence:** Verified.

---

### [Medium] Filesystem change batches are indexed strictly one file at a time

**Where:** `src/main/ipc.ts:358-382` (`applyChanges`)
**Trigger:** `git checkout` a branch, sync a folder, or paste many notes into the vault at once.
**Detail:** The watcher batches events over 120 ms (`watcher.ts:33-38`) — good — but the handler then does:

```ts
for (const change of changes) {
  if (change.type === 'add' || change.type === 'change') {
    await indexNote(change.path)      // :363 — sequential read + parse per file
```

Each `indexNote` is a `readFile` + `stat` + `parseNote`. Five hundred changed files means five hundred
round trips in series before the renderer hears anything.

`applyChanges` is also invoked as fire-and-forget (`void applyChanges(changes)` at `:310`), so two overlapping
batches can interleave their `readTree()` and `getIndex()` calls and send results out of order.

**Impact:** The file tree and index lag visibly behind a bulk external change. The interleaving is a latent
correctness risk rather than an observed bug.
**Fix:** Chunk the reads with `Promise.all` (bounded concurrency, ~8), and serialise `applyChanges` behind a
promise chain the way `settings.ts:269-275` already does for app state.
**Confidence:** Verified.

---

### [Low] Folder rows recompute a recursive note count on every render

**Where:** `src/renderer/src/components/FileTree.tsx:337-342` (`noteCount`), called at `:359`
**Trigger:** Any re-render of a visible folder row — which includes every settings change, since the row
subscribes to `pinned`, `iconOverrides` and `colorOverrides`.
**Detail:** `noteCount` walks the entire subtree with `reduce` and is called unmemoised in the component body.
Virtuoso limits this to visible rows, so the cost is bounded by viewport height — but a top-level folder
containing the whole vault walks every node.
**Impact:** Small but entirely avoidable; contributes to the settings-change hitch above.
**Fix:** `useMemo` on `node.children`, or precompute counts once when the tree is flattened.
**Confidence:** Verified.

---

### [Low] The index cache is serialised with a synchronous `JSON.stringify` of the whole vault on the main process

**Where:** `src/main/indexer.ts:233-249` (`saveCache`), `src/main/search.ts:30-32` (`serializeSearch`)
**Trigger:** Four seconds after any note write (`scheduleCacheSave`), and again on quit.
**Detail:** `Object.fromEntries(notes)` plus `JSON.stringify(mini)` for the entire MiniSearch index, then
`JSON.stringify(value, null, 2)` inside `writeJson` (`settings.ts:174`) — all synchronous, all on the main
process event loop.
**Impact:** For a large vault this is a stall of hundreds of milliseconds that blocks IPC, the clip server and
window events. The 4 s debounce keeps it off the typing path, which is why this is Low rather than Medium.
**Fix:** Drop the `null, 2` pretty-printing for the cache file specifically (it is machine-written and
rebuildable), and consider writing it from a worker.
**Confidence:** Verified.

---

### [Low] Deleting or renaming a folder rebuilds the entire index

**Where:** `src/main/ipc.ts:488`, `:498`
**Detail:** `if (!isMarkdownPath(from)) await buildIndex()` — a full `listNotes()` walk plus a `stat` per note.
`forgetNotesUnder` (`indexer.ts:143-153`) already exists and handles the delete case incrementally; the rename
case genuinely needs re-resolution but not a full re-read.
**Impact:** A pause proportional to vault size when reorganising folders. Mitigated by the mtime cache, so it is
a stat-storm rather than a re-parse.
**Fix:** Use `forgetNotesUnder` for delete. For rename, rebase the in-memory keys and call `rebuildSnapshot`
rather than `buildIndex`.
**Confidence:** Verified.

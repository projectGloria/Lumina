# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Lumina is a local-first Obsidian-style note app: an Electron shell around a
CodeMirror 6 editor, styled after the Claude interface. A vault is an ordinary
folder of `.md` files chosen by the user; nothing is stored anywhere else.

## Commands

```
npm run dev                        # run the app with hot reload
npm test                           # all tests
npx vitest run tests/paths.test.ts # one file
npx vitest run -t "resolveLink"    # one describe/it by name
npm run typecheck                  # both tsconfigs (node + web)
npm run build                      # bundle main, preload, renderer into out/
npm run build:dir                  # package to release/win-unpacked (no installer)
npm run build:win                  # NSIS installer + portable exe
npm run release                    # build:win, then verify:release
```

`npm run typecheck` covers two separate projects — `tsconfig.node.json`
(main, preload, shared, tests) and `tsconfig.web.json` (renderer, shared,
preload). A change to `src/shared` must satisfy both. Both set
`noUnusedLocals`, so a leftover import fails the typecheck even when nothing
else is wrong.

Tests run in vitest's `node` environment: they cover `src/shared`,
`src/main/paths.ts`, `src/main/openFile.ts` and the starter vault, and there is
no jsdom, so React components and CodeMirror have no test harness.
`tests/open-file.test.ts` and the `safeVaultPath` cases in `tests/paths.test.ts`
build real directory trees (and symlinks) under `os.tmpdir()`, because which
vault a note belongs to, and whether a path escapes one, are questions about
what is on disk. Keep `openFile.ts` free of `electron` imports or it stops being
testable — that is why `luminaDir` lives in `paths.ts` rather than `settings.ts`.
Note that `tests/starter-vault.test.ts` asserts that every wikilink in
`src/main/starter.ts` resolves and every tag is one the notes meant — editing the
starter notes can turn the suite red for reasons that have nothing to do with the
parser.

The `@shared/*` and `@/*` aliases are declared in four places —
`electron.vite.config.ts` (once per bundle), `tsconfig.node.json`,
`tsconfig.web.json` and `vitest.config.ts`. A new alias has to be added to all
of them or something (usually the tests, usually last) breaks.

`RELEASE.md` covers the signed Windows release; `npm run verify:release`
(`scripts/verify-release.ps1`, pwsh) refuses unsigned artifacts unless
`LUMINA_ALLOW_UNSIGNED=1`, which is for local diagnostics only.

### Running the app against a vault without clicking through the dialog

The vault picker is a native dialog, so for scripted verification seed the app
state instead. `%APPDATA%/lumina/lumina.json` holds `lastVault`, `recentVaults`
and `windowBounds`; the app reopens `lastVault` on launch. Per-vault UI state
lives in `<vault>/.lumina/{settings,theme,workspace}.json`, so you can force a
theme, a panel, or a window size by writing those files and restarting. Pointing
at an empty folder seeds it with the starter notes from `src/main/starter.ts`.

Renderer `console.*` output and errors are forwarded to the dev-server terminal
in development (`src/main/window.ts`), which is usually faster than opening
devtools.

## Architecture

```
main process (Node)                    preload            renderer (React)
──────────────────────                 ───────            ────────────────
vault.ts    read/write/rename/delete   contextBridge      Zustand stores
watcher.ts  chokidar -> fs events  ──►  window.lumina ──► CodeMirror 6 editor
indexer.ts  links, tags, titles         (typed, no        sidebars and panels
search.ts   MiniSearch                   node access)     command registry
settings.ts settings, theme
snippets.ts vault CSS, hot-reloaded
```

### Three rules that most changes have to respect

**1. `src/shared/markdown-parse.ts` is the only markdown parser.** The
main-process indexer and the renderer's editor decorations both import it, so
link resolution can never disagree between the two sides. Anything that reads
structure out of a note — wikilinks, tags, headings, frontmatter, aliases —
belongs here, not in a component. Resolution order is deliberate: exact path,
then same-folder basename, then shallowest basename, then alias.

It also owns the path predicates both sides need: `isMarkdownPath` (never test
`endsWith('.md')` — `.markdown` and `.mdx` are notes too), `isPathAtOrBelow` and
`rebaseDescendantPath` (a folder rename must move `Old/Nested/a.md` without
touching the sibling `Old backup/a.md`).

The one sanctioned exception is `lib/render.ts`, which uses `marked` to turn a
note into standalone HTML for the export commands. It still calls `resolveLink`
for wikilink targets; `marked` never decides what a link means. Its custom
`Renderer` escapes raw HTML and drops any URL scheme that is not http(s),
`mailto`, or a `data:image/*` — exported HTML carries a strict CSP meta tag, and
loosening either is how a note becomes a script.

**2. The renderer never touches `fs`.** Every path crosses a typed IPC channel
declared in `src/shared/channels.ts`, handled in `src/main/ipc.ts`, and exposed
through `src/preload/index.ts` — a new capability means editing all three, plus
`src/shared/types.ts` if it carries a new payload shape. `contextIsolation` on,
`nodeIntegration` off, `sandbox` on. Vault images load over a custom `lumina://`
scheme (`src/main/protocol.ts`) rather than widening the CSP to `file:`.

`src/main/paths.ts` has two guards and they are not interchangeable. `safeJoin`
is sync and only rejects `..` traversal; `safeVaultPath` is async, additionally
`realpath`s the result so an in-vault symlink cannot point outside, and takes
`allowMissing` for a path about to be created (which then checks the nearest
existing parent). **Anything that opens a real file — indexer, protocol handler,
vault writes — must use `safeVaultPath`.**

Paths in the renderer, the index and every IPC payload are **vault-relative and
`/`-separated**; only `src/main` deals in absolute OS paths. `safeJoin` tolerates
backslashes on the way in, but nothing should ever send them.

**3. Nothing hardcodes a colour or dimension.** `styles/tokens.css` declares
every `--lum-*` variable; the theme editor writes the same names as inline
styles on the root element, and user snippets override them again. If you reach
for a hex code in CSS, add a token instead — otherwise the theme editor and
snippets silently stop working for that surface. Exported HTML snapshots the
live tokens by name (`currentTokens()` in `lib/render.ts`), so a token that
export needs must be added to that list as well.

### Live preview — the part that breaks quietly

`src/renderer/src/editor/livePreview.ts` renders markdown in place by hiding
syntax markers everywhere except the line the caret is on. It is split across
two providers because **CodeMirror forbids a `ViewPlugin` from producing
decorations that span line breaks**:

- `blockPreviewField` (a `StateField`) — frontmatter properties strip and
  rendered tables. These replace whole lines.
- `livePreviewPlugin` (a `ViewPlugin`) — everything inline, limited to the
  viewport.

Put a block decoration in the view plugin and CodeMirror disables the plugin
with no visible error; the editor still looks *almost* right because the
`HighlightStyle` in `cmTheme.ts` keeps colouring things. If markers stop hiding,
suspect this before anything else.

A block widget's root DOM element must never carry a CSS `margin`. CodeMirror's
height map (`posAtCoords` -> `elementAtHeight`) is built from
`getBoundingClientRect().height`, which excludes margins, while the drawn caret
comes from real DOM rects (`coordsAtPos`) — a margin on a widget silently
desyncs the two, so clicks land one or more lines off from where the caret is
actually drawn. Use `padding` (and an extra wrapper element if the margin was
faking space around a border, as `FrontmatterWidget` does) instead. Both
`FrontmatterWidget` and `TableWidget` assert this in dev via
`getComputedStyle(...).marginBottom` and `console.warn` if it is nonzero — keep
that guard on any new block widget.

Separately, `styles/markdown.css` has several rules written against a single
class (`.cm-line`, `.cm-scroller`) that lose to CodeMirror's base theme, which
compiles to two classes (`.ͼ1 .cm-line`) — `.cm-line { padding: 0 }` and
`.cm-scroller { line-height: inherit }` currently have no effect. Do not fix
this by simply prefixing `.cm-editor`: raising `.cm-line`'s specificity enough
to apply `display: inline-block` was measured to add a *new* line-box drift
(an inline-block's border box excludes line-box leading), the same class of bug
as the margin issue above.

Two related traps in the same file:

- When walking the syntax tree, returning `false` from `enter` stops descent
  into children. The document root starts at offset 0, so a guard like
  `if (start < fmEnd) return false` aborts the entire traversal for any note
  with frontmatter. Only skip nodes that are *wholly* inside the skipped span.
- Every rendered block must swap back to raw source when the caret enters it.
  That is what `activeLines()` and `editingLines()` are for; nothing should be a
  one-way transformation.

Wikilinks, `#tags` and `==highlights==` are not CommonMark. They are taught to
the parser as lezer extensions in `editor/markdownExtensions.ts`, so the
decorator works from the syntax tree rather than running its own regexes over
visible text.

### Opening a note from outside the app

Double-clicking a `.md` file, "Open with", or a path on the command line all
converge on `openFileFromDisk` in `ipc.ts`. The hard part is not the file, it is
deciding **which vault to open around it**, which `src/main/openFile.ts` answers
in descending order of confidence: the vault already on screen, an ancestor
folder containing `.lumina`, a vault in `recentVaults`, and only then the file's
own folder. That last case is a guess, so it is the one case the renderer asks
about first — silently adopting a folder would index somewhere like the
downloads directory on a single double-click.

Three delivery paths feed the same queue in `main/index.ts`: `process.argv` at
cold start, `second-instance` while the app is running (Windows and Linux), and
`open-file` on macOS, which only fires if the listener is registered *before*
`whenReady`. Draining is serial, so two files cannot race to open two vaults.

A cold start opens the vault while the page is still loading, which is earlier
than React can subscribe. `pushFileRequest` therefore parks requests until the
renderer drains them via `files.takeOpenRequests()` on mount — the same
pull-on-mount shape as `vault.current()`. Sending the event alone would lose it.
The two are drained in separate `try` blocks in `App.tsx`, so a failed vault
restore does not swallow the requested note.

Notes arriving this way open in their **own** tab (`newTab` unless already
open); the in-app default replaces the active tab, which would throw away
whatever the user was editing.

`fileAssociations` in `electron-builder.yml` is what makes the OS offer Lumina
at all, and it only takes effect through the NSIS installer — a `build:dir` or
`npm run dev` session will never be registered as a handler. To exercise the
path without installing, pass a note as an argument:
`npx electron out/main/index.js path/to/Note.md`.

### Shutting down without losing work

Autosave is debounced, so at any instant the last few hundred milliseconds of
typing exist only in the renderer. Both quit paths therefore hand off to
`flushRenderer` (`ipc.ts`) and *wait*: the window's `close` handler (the X
button, which destroys the renderer) and `before-quit` (Cmd+Q, which skips the
close handler entirely). The renderer's `onFlush` awaits three debounced things
together — `useEditor.saveAll()`, `flushSettingsPersistence()` and
`flushWorkspacePersistence()` — so a theme tweak or a resized panel survives the
same way an unsaved sentence does. Each path is guarded against re-entry and both
are safe to run twice, since saving a clean buffer does nothing. The 3s timeout
means a wedged renderer delays the quit rather than preventing it. If you add a
new way to quit, route it through one of those two.

### Commands are data

`src/renderer/src/lib/commands.ts` is a flat list (~50 entries) read by the
command palette, the global hotkey handler in `App.tsx`, and the hotkey rebinder
in settings. Add an action there, not as a bare click handler, or it will be
missing from the palette and unbindable. Operations spanning more than one store
live in `lib/actions.ts` so the sidebar, a broken link and the palette all create
a note the same way — and so that a rename or delete updates buffers, tabs *and*
starred paths together (`renameStarredPaths` / `removeStarredPaths`).

Editor-section commands are also bound in CodeMirror's own keymap
(`editor/extensions.ts`). The global handler in `App.tsx` deliberately yields to
CodeMirror when focus is inside `.cm-editor`, so those bindings do not fire twice.

Commands reach the editor through `editor/activeView.ts`, a module-level
`EditorView` singleton that `Editor.tsx` sets on mount — there is no ref threaded
through the tree and no context provider. Use the `withView()` wrapper in
`commands.ts`, which no-ops when no note is focused, rather than reading the
singleton directly.

### State

Five Zustand stores under `store/`: `vaultStore` (vault, tree, index),
`workspaceStore` (tabs, panels, history — persisted to `workspace.json`),
`editorStore` (buffers, dirty tracking, debounced autosave), `settingsStore`
(settings, theme, snippets, and `applyTheme` which pushes everything onto the
DOM), `uiStore` (modals, toasts, context menu, prompts).

`vaultStore` also exports the read helpers everything else resolves links
through — `titleOf`, `knownPaths`, `aliasMap`, `pathForNewNote`. `aliasMap`
caches on index *identity*, which is sound only because the index is replaced
wholesale rather than mutated; keep it that way.

**Buffers are vault-scoped, but their keys are not.** `editorStore.buffers` is
keyed by vault-relative path, so `Notes/Todo.md` in one vault collides with the
same path in another. Switching vaults therefore has a required order: main
calls `flushRenderer()` *before* `setRoot` (writes resolve against the root, so
the outgoing vault's edits must land while it is still current), and `receive()`
in `App.tsx` calls `useEditor.reset()` whenever the payload names a different
vault. Skip either half and `open()` short-circuits on the stale buffer, showing
one vault's note under another's path — and autosave then writes it there.
`reset()` also bumps a module-level `vaultGeneration`; every in-flight `open`
and `reload` captures it and discards its result if it changed, so a slow read
from the old vault cannot land in the new one. Concurrent `save()` calls for one
path are serialized through the `saves` map — never write around it.

Files are the source of truth. `<vault>/.lumina/cache.json` is a disposable
mtime-keyed speedup for the index and the serialized search index — bump
`CACHE_VERSION` in `indexer.ts` whenever `NoteIndexEntry` gains a field, or stale
entries will be read back missing it.

`getIndex()` in `indexer.ts` is **async** and every caller must await it. The
snapshot rebuild yields to the event loop every 500 notes so filesystem events
are not blocked on a large vault; that means the notes map can change mid-pass,
which is what the `revision` counter detects — a snapshot built over a changed
map is left dirty and rebuilt rather than declared clean.

Writes are atomic (temp file, then rename) and deletes go to the recycle bin.
JSON state writes in `settings.ts` are queued per file (and app-state
read-modify-writes queued globally), so two rapid saves cannot interleave into a
truncated `workspace.json`. `Settings.hotkeys` is the one field that is not
actually per-vault storage: `loadSettings`/`saveSettings` split it out to
`lumina.json` (app-level) transparently so a rebind follows you between
vaults, while every other field stays in the vault's `settings.json`. The
renderer never sees this split — `Settings.hotkeys` still just reads and
writes normally through `settings:get`/`settings:set`. Paths the app writes are suppressed in the watcher
for `SELF_WRITE_GRACE_MS` (`vault.ts`, 1.5s) so autosave does not come back as an
external edit; a genuinely external edit reloads a clean buffer and is refused on
a dirty one.

## Working on the editor

The CodeMirror instance is built once inside an effect keyed on the note path,
so React Fast Refresh keeps the component mounted and the **previous** extension
set running — edits appear to do nothing. A Vite plugin in
`electron.vite.config.ts` forces a full reload for anything under
`src/renderer/src/editor/`. If you move editor code outside that directory, move
the rule with it.

Settings-dependent extensions go through `settingsCompartment` so preferences
can change without reloading the note.

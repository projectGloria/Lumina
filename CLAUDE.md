# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Lumina is a local-first Obsidian-style note app: an Electron shell around a
CodeMirror 6 editor, styled after the Claude interface. A vault is an ordinary
folder of `.md` files chosen by the user; nothing is stored anywhere else.

## Commands

```
npm run dev                        # run the app with hot reload
npm test                           # all tests
npm run test:watch                 # rerun affected tests while working
npx vitest run tests/paths.test.ts # one file
npx vitest run -t "resolveLink"    # one describe/it by name
npm run typecheck                  # both tsconfigs (node + web)
npm run build                      # bundle main, preload, renderer into out/
npm run build:dir                  # package to release/win-unpacked (no installer)
npm run build:win                  # NSIS installer + portable exe
npm run release                    # build:win, then verify:release

pwsh scripts/fetch-speech-packs.ps1  # download the speech packs the installer bundles
```

`fetch-speech-packs.ps1` is optional and slow (~1.8 GB). Run it before
`build:win` for an installer that can set dictation up with no network; skip it
and the build is ~100 MB and simply reports no packs bundled.

`npm run typecheck` covers two separate projects — `tsconfig.node.json`
(main, preload, shared, tests) and `tsconfig.web.json` (renderer, shared,
preload). A change to `src/shared` must satisfy both. Both set
`noUnusedLocals`, so a leftover import fails the typecheck even when nothing
else is wrong.

Tests run in vitest's `node` environment, so React components and CodeMirror
have no harness at all. What is covered is the pure half of each feature:
`src/shared` (markdown parsing, slash-item ranking, placeholder expansion, tab
transitions, link-banner and quick-note naming, WAV encoding, whisper output
parsing, the language table, clip validation) plus `src/main/paths.ts`,
`openFile.ts`, `transcribe.ts`, `speechPacks.ts`, `clipServer.ts` and the
starter vault.

Several suites deliberately touch the real world, because the question they ask
is about it. `tests/open-file.test.ts` and the `safeVaultPath` cases in
`tests/paths.test.ts` build real directory trees and symlinks under
`os.tmpdir()`; `tests/transcribe.test.ts` and `tests/speech-packs.test.ts` do
the same for tool lookup and pack installs; `tests/clip-server.test.ts` stands
up a real HTTP listener and talks to it over a raw socket. That last one has to
use a socket rather than `fetch`, which silently replaces the `Host` header —
written with `fetch` the DNS-rebinding test passes while testing nothing. Keep `openFile.ts` free of `electron` imports or it stops being
testable — that is why `luminaDir` lives in `paths.ts` rather than `settings.ts`.
Note that `tests/starter-vault.test.ts` asserts that every wikilink in
`src/main/starter.ts` resolves and every tag is one the notes meant — editing the
starter notes can turn the suite red for reasons that have nothing to do with the
parser.

The `@shared/*` and `@/*` aliases are declared in four places —
`electron.vite.config.ts` (once per bundle), `tsconfig.node.json`,
`tsconfig.web.json` and `vitest.config.ts`. A new alias has to be added to all
of them or something (usually the tests, usually last) breaks.

`npm run verify:release` (`scripts/verify-release.ps1`, pwsh) refuses unsigned
artifacts unless `LUMINA_ALLOW_UNSIGNED=1`, which is for local diagnostics only.

### Running the app against a vault without clicking through the dialog

The vault picker is a native dialog, so for scripted verification seed the app
state instead. `%APPDATA%/lumina/lumina.json` holds `lastVault`, `recentVaults`,
`profiles`, app-level `hotkeys` and `windowBounds`; the app reopens the active
profile's vault on launch. Per-vault UI state lives in
`<vault>/.lumina/{settings,theme,workspace}.json`, so you can force a theme, a
panel, or a window size by writing those files and restarting. Pointing at an
empty folder seeds it with the starter notes from `src/main/starter.ts`.

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
profiles.ts profiles + passlock
quickNote.ts global shortcut
tray.ts    tray, for a window-less app
linkPreview.ts opt-in page metadata
snippets.ts vault CSS, hot-reloaded
fonts.ts    installed families, per OS
clipServer.ts  the web clipper's listener
clipImages.ts  clipped images, pulled into the vault
net.ts      the fetch primitives both outbound features share
transcribe.ts  local whisper, one-shot
whisperServer.ts resident whisper, for live dictation
speechPacks.ts engines and models bundled in the installer
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

The file explorer's scale works this way too: `settings.explorerSize` picks one
of the three steps in `EXPLORER_SIZES` (`shared/types.ts`) and `applyTheme`
writes them out as `--lum-tree-*`. Row height, label size, icon size and indent
all read those tokens, which is why `Icon`'s `size` prop is only a fallback —
it becomes a width/height *attribute*, and any CSS rule outranks one. A
component that sizes a glyph with an inline style instead (as `PathIcon` used
to) silently opts itself out of the setting.

### Live preview — the part that breaks quietly

`src/renderer/src/editor/livePreview.ts` renders markdown in place by hiding
syntax markers everywhere except the line the caret is on. It is split across
two providers because **CodeMirror forbids a `ViewPlugin` from producing
decorations that span line breaks**:

- `blockPreviewField` (a `StateField`) — the frontmatter properties strip,
  rendered tables, and link banners. These replace whole lines.
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
faking space around a border, as `FrontmatterWidget` does) instead. `warnOnMargin()` asserts this in dev for all three
block widgets — keep the call on any new one. It checks a frame after
`toDOM`, because the element is not in the document yet while `toDOM` runs and
`getComputedStyle` reports nothing there.

The same line-box sensitivity governs `styles/markdown.css`. Two rules there sit
where they do for measured reasons, not stylistic ones, and each carries the
reasoning in a comment:

- The centering inset is padding on `.cm-editor .cm-line`, not on `.cm-content`,
  because `rectanglesForRange` reads the *line's* own padding when it draws a
  full-line selection and ignores the content element's.
- `.cm-scroller` keeps `overflow-y: hidden` and is given `.cm-has-overflow` by
  `editor/scrollOverflow.ts` only when real content exceeds the viewport. The
  scroller's large bottom padding would otherwise make every note, even a
  one-line one, report itself as scrollable.

Selectors here have to outrank CodeMirror's base theme, which compiles to two
classes — that is why rules are written `.cm-editor .cm-line` rather than
`.cm-line`. Raising specificity is fine; changing a line box's `display` (e.g. to
`inline-block`) is not, since an inline-block's border box excludes line-box
leading and reintroduces the same drift as the widget-margin bug above.

Two related traps in `livePreview.ts` itself:

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

`components/Icon.tsx` keeps each glyph as raw SVG markup rather than JSX so the
same shapes can be built with plain DOM calls (`createIconElement`) from inside
editor widgets — a wikilink renders its target's explorer icon that way. Add new
icons to that map rather than as one-off inline SVG in a component.

### Links, slash commands, read mode

Three features share one rule: the pure, testable half lives in `src/shared`,
and only the drawing is in the renderer.

- **Link banners.** A link that is the whole line becomes a card;
  a link inside a sentence stays a `LinkChipWidget` pill. `standaloneLink()` in
  `shared/linkPreview.ts` decides which, and the walk is over the syntax tree
  rather than the raw lines, so a URL inside a fenced code block (where the
  text is `CodeText`, not a link node) is left alone. The card is drawn twice —
  by `LinkBannerWidget` in the editor and by `bannerifyLoneLinks()` in
  `lib/render.ts` for read mode — off the same `link-banner` class names, which
  is why those carry no `cm-` prefix.

  Offline it shows only what the URL says: a site icon, a title from the
  last path segment, the host. `editor.linkPreviews` (**off by default** — with
  it off the app makes no network requests at all) adds the page's own title,
  description and thumbnail through `main/linkPreview.ts`: http(s) only, capped
  reads, a month-long cache in `<vault>/.lumina/linkcache.json`, and images
  downloaded into `.lumina/linkpreviews/` so they are served by the existing
  `lumina://` scheme rather than by widening the CSP. `ipc.ts` mirrors the
  preference into `linkPreviewsEnabled` and refuses the fetch itself — the
  offline promise is enforced where the request actually happens, not only in
  the renderer.

- **Slash commands.** `editor/slashCommands.ts` builds the menu from the
  `Editor` section of the command registry, a list of block inserts, and the
  user's own snippets, which it reads from settings on every keystroke so a
  command added in Settings shows up without reloading the editor. Ranking is
  `matchSlashItems` in `shared/slashItems.ts`; the returned `CompletionResult`
  sets `filter: false` because that ranking has already happened — leaving
  CodeMirror's own filter on would re-filter labels against the typed text
  *including* the leading slash, which no label can match. Snippet bodies
  expand through `expandSnippet` in `shared/template.ts` (`{{date}}`,
  `{{time}}`, `{{title}}`, `{{cursor}}`), the same vocabulary daily-note
  templates use.

- **Read mode is per tab.** `TabState.mode` persists in `workspace.json`
  (absent means edit), so two tabs can be in different modes; `openNote`
  carries the mode across a replace, so following a link while reading keeps
  reading. The editor stays mounted but hidden behind read mode so its undo
  history and scroll survive the round trip. `ReadView` is not a dead end: it
  delegates clicks to `openNote` / the tag filter / `openExternal` off the data
  attributes `decorate()` writes, and rewrites in-vault image sources to
  `lumina://` (with the remaining `attachmentCandidates` left in
  `data-candidates` to fall through on error, the same guess the editor's image
  widget makes).

### The quick note, and living in the tray

`Ctrl+Shift+Space` anywhere in the OS makes a blank note in `Temporary/` and
opens it in its own tab. Electron accelerators cannot tell left modifiers from
right ones, so it answers to either Ctrl and either Shift.

The interesting part is that it has to work when Lumina is *not running*.
`applyLoginItem` registers a login item carrying `--hidden`; with that flag
`main/index.ts` boots into the tray with **no `BrowserWindow` and no vault
indexed** — main process, tray icon, global shortcut, nothing else. The first
press builds the window (`ensureWindow`), which is why the press has to survive
a cold start: `pushQuickNote` counts presses in `ipc.ts` until the renderer
drains them on mount, and `requestQuickNote` in `lib/actions.ts` holds them
again until a vault is actually open, since the window may come up on the
profile picker or a passlock. Both stages count rather than latch so no press is
lost; once delivery reaches the renderer, repeated presses reuse an open
timestamp-generated note while it remains empty.

Closing the window hides it (`quickNote.closeToTray`) instead of quitting, but
still runs the same `flushRenderer()` handoff first; the tray's Quit sets
`allowQuit` and goes through the normal `before-quit` path. `window-all-closed`
therefore only quits when close-to-tray is off.

Watch out when testing the tray path by hand: `npx electron out/main/index.js`
is not the app. Electron resolves `userData` to `%APPDATA%/Electron` there, so
it reads a *different* `lumina.json` with no active profile and sits on the
profile picker. Use `npx electron-vite dev -- --hidden`, which runs as Lumina
and forwards renderer logs to the terminal.

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
open). Ordinary in-app opens also append a tab or activate the existing one;
only explicit history navigation replaces the active tab. That decision is
`openTab` in `src/shared/tabs.ts` — a pure function over `(tabs, activeTab,
path, options)`, kept out of `workspaceStore` so `tests/tabs.test.ts` can pin
the rule down without a store. Every caller goes through it; a component that
pushes onto `tabs` itself will duplicate a tab that is already open.

`fileAssociations` in `electron-builder.yml` is what makes the OS offer Lumina
at all, and it only takes effect through the NSIS installer — a `build:dir` or
`npm run dev` session will never be registered as a handler. To exercise the
path without installing, pass a note as an argument:
`npx electron out/main/index.js path/to/Note.md`.

### Profiles and the passlock

`src/main/profiles.ts` keeps a list of profiles (name, colour, one vault, an
optional passlock) in app-level `lumina.json`; `store/profileStore.ts` drives a
four-state gate (`loading` -> `picker` | `locked` -> `ready`) that `App.tsx`
renders in front of the workspace. A locked profile re-locks on every launch —
having been active in the previous session does not skip the prompt.

**The passlock is a UI gate, not encryption.** A vault is a plain folder of
`.md` files by design, so a locked profile's notes stay readable to anything
with filesystem access; do not describe or extend it as though it protected data
at rest. Only a scrypt hash is persisted or crosses IPC, and comparison goes
through `timingSafeEqual` — keep the plaintext inside the single verify call.
`listProfiles` migrates a pre-profiles install's `lastVault` into a default
profile on first read; removing that path strands existing users on an empty
picker.

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
a note the same way.

That file is also where path-keyed bookkeeping lives, and it is easy to update
only half of it. A rename or move has to rebase **every** map keyed by
vault-relative path — buffers, tabs, `starred`, `pinned`, `iconOverrides`,
`colorOverrides`, `customIcons` — and a delete has to drop the same set, via the
`rename*` / `remove*` helper pairs. A new per-path setting owes both helpers plus
calls in `promptRename`, `movePath` and `confirmDelete`, or the user's decoration
silently stays attached to the old path forever.

Editor-section commands are also bound in CodeMirror's own keymap
(`editor/extensions.ts`). The global handler in `App.tsx` deliberately yields to
CodeMirror when focus is inside `.cm-editor`, so those bindings do not fire twice.

Commands reach the editor through `editor/activeView.ts`, a module-level
`EditorView` singleton that `Editor.tsx` sets on mount — there is no ref threaded
through the tree and no context provider. Use the `withView()` wrapper in
`commands.ts`, which no-ops when no note is focused, rather than reading the
singleton directly.

### State

Six Zustand stores under `store/`: `vaultStore` (vault, tree, index),
`workspaceStore` (tabs, panels, history — persisted to `workspace.json`),
`editorStore` (buffers, dirty tracking, debounced autosave), `settingsStore`
(settings, theme, snippets, and `applyTheme` which pushes everything onto the
DOM), `uiStore` (modals, toasts, context menu, prompts), `profileStore`
(profiles and the passlock gate).

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
truncated `workspace.json`. Three fields in `Settings` are not actually per-vault
storage: `loadSettings`/`saveSettings` split `hotkeys`, `slashCommands` and
`quickNote` out to `lumina.json` (app-level) so a rebind, a snippet or the
global shortcut follows you between vaults — and so the quick note works before
any vault is open. Every other field stays in the vault's `settings.json`. The
renderer never sees this split: it reads and writes the whole `Settings` object
through `settings:get`/`settings:set` as if it were one file. A new app-level
field means adding it to `AppState`, to the `appLevel` overlay in
`loadSettings`, and to the pair of writes in `saveSettings`. Paths the app writes are suppressed in the watcher
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

`editor/session.ts` is why switching tabs is not destructive. Rebuilding the
view from the buffer text would throw away the undo history, the selection and
the scroll position, so the whole `EditorState` is parked per path on the way
out (`rememberSession`) and handed back on the way in (`sessionState`). Two
conditions keep a parked session from lying:

- It is only restored while it still describes the buffer. A note edited on disk
  while its tab sat in the background is reloaded, and the stale session is
  dropped rather than restored and patched — patching would sit in the undo
  history as one enormous edit.
- `rememberSession` refuses to park a note whose buffer is gone. Closing a tab
  releases the buffer, and React may run the editor's cleanup afterwards; a
  session parked for a note nothing holds would outlive it.

The caret alone goes to `workspaceStore` as `TabState.cursor`, because that is
the one part of a session worth surviving a restart.

### Two views that are not React all the way down

- `components/GraphView.tsx` draws the vault as a force-directed map on a
  **canvas**, not SVG — a few thousand DOM nodes stutter while panning — and
  parks the `d3-force` simulation once it settles, so an idle graph costs
  nothing. `settings.graphPerformanceMode` only trades layout quality for a
  faster `alphaDecay`. Node positions live in refs and are drawn from a
  `requestAnimationFrame` loop; putting them in React state re-renders the tree
  on every tick.
- `components/FileTree.tsx` flattens the tree to a row list and renders it
  through `react-virtuoso`, so only visible rows exist. Anything that needs to
  reach a row (scroll-to, drag targets) has to work off the flattened index
  rather than assuming the DOM node is there.

### Attachments, and why targets are percent-encoded

A markdown destination is a URL, and CommonMark ends an unbracketed one at the
first space — so `![a](attachments/Pasted image 1.png)` is not an image at all.
The parser emits no `Image` node, the widget never runs, and the line renders as
literal text. Attachment names grow spaces on their own: a screenshot carries
one, and `uniquePath` adds ` 1` to the second `image.png` saved in a session,
which is why pasting one screenshot worked and the next one did not.

`encodeTarget` / `decodeTarget` in `shared/markdown-parse.ts` are the fix and
they are a **pair** — anything writing a target encodes, anything resolving one
decodes, and `attachmentCandidates` takes a real vault path in between:

- `editor/attachments.ts` and `lib/voice.ts` encode what they insert.
- `livePreview.ts` (the `Image` branch) and `render.ts` decode what they read.
- Wikilink embeds (`![[My file.png]]`) are **not** encoded — a wikilink target
  is raw text, not a URL — so that branch passes the target through untouched.
  Decoding it would turn a file named `50%20off.png` into `50 off.png`.

`vaultUrl` encodes again on the way to the `lumina://` handler, which decodes
once. Decode twice anywhere in that chain and the file 404s with no error.

### Voice notes and dictation

Recording is renderer-side (only it has a microphone), transcription is
main-side (only it can spawn a process), and `shared/audio.ts` holds the parts
both need — `isAudioTarget`, the WAV encoder, and the whisper output parser.

- **`lib/recorder.ts`** captures with `MediaRecorder` and keeps the compressed
  blob for the vault. Whisper reads only 16 kHz mono PCM and resamples nothing,
  so `toWhisperWav` decodes that blob and re-renders it through an
  `OfflineAudioContext` at one channel and 16 kHz. That conversion is the reason
  no ffmpeg binary is needed.
- **`lib/voice.ts`** orchestrates, and the ordering is deliberate: the audio is
  saved and linked into the note *before* transcription starts, so a missing
  model or a whisper failure costs the words and never the recording. The live
  `RecorderHandle` stays module-level — a microphone is not serialisable — and
  only the phase the bar draws goes through `uiStore.voice`. `startVoice` guards
  on **both** the handle and that store field, because the handle is already
  null while whisper is still working.
- **`main/transcribe.ts`** shells out to a local `whisper.cpp` build. Lumina
  ships neither the binary nor a model; they are looked up in
  `<userData>/whisper/` (and `whisper/models/`), largest `.bin` winning, and an
  explicit override that does not exist is reported rather than silently
  replaced by the auto-detected one. It imports no `electron` — `userData` is
  passed in — so `tests/transcribe.test.ts` can exercise the lookup against a
  real directory tree, the same reason `openFile.ts` avoids it.

Audio has no markdown syntax, so a recording is written with the **image** form
and separated by extension: `livePreview.ts` picks `AudioWidget` over
`ImageWidget`, and `render.ts` swaps the `<img>` marked produced for an
`<audio>`. Both wear the same `cm-embed-audio` class names, the way link banners
are drawn twice off one set. Two things this needed outside those files: an
`<audio>` will not retry a new `src` on its own, so `ReadView`'s candidate
fallback calls `load()`, and the renderer CSP needed `media-src` — `default-src`
would otherwise block `lumina://` for media only.

### Read aloud

The other direction of the same feature, and the only voice one that needs
nothing installed: `speechSynthesis` in the renderer is the operating system's
own synthesizer, so selecting text and pressing `Ctrl+Shift+L` works offline on
a machine that has never had a whisper build. `lib/readAloud.ts` drives it,
`shared/speech.ts` holds the pure half, and the split is the usual one.

`speechText` strips markdown before a word is spoken — a heading read verbatim
opens with "number sign number sign", a wikilink with "left bracket left
bracket", and a fenced code block is a minute of punctuation. `speechChunks`
then cuts the prose into ~220-character sentences, which is **not** cosmetic:
Chromium drops the tail of a long utterance on some platform voices,
`cancel()` only takes effect between utterances (so stop and skip are only as
responsive as a chunk is short), and the player bar's progress has to count
something the synthesizer will actually report.

Three things in `readAloud.ts` are load-bearing:

- Every callback checks a module-level `generation`. `cancel()` still delivers
  `end` for the utterance it interrupted, so without it stopping one reading
  starts the next chunk of it a moment later.
- `cancel()` is asynchronous; speaking in the same tick is how a reading ends
  up silent. Both `speak` and `skipReading` go through a zero-delay timeout.
- The keep-alive `resume()` nudges a synthesizer that stalled mid-queue, and it
  stands down while the pause is the user's own — otherwise it undoes it.

Which text gets read is decided in `selectionText()`, and the order matters:
the document's own selection first (it is the only one that knows about read
mode, search results and backlink excerpts), CodeMirror's state selection
second, because it survives the focus moving to the command palette when the
DOM selection does not. Nothing selected reads the whole note. Read mode grew
its own context menu for this — right-click is the one gesture that leaves a
selection intact.

### Speech packs, and shipping gigabytes in an installer

Dictation needs a whisper build and a model, neither of which Lumina can
reasonably ask a user to find. Both are carried **inside the installer**
(`resources/speech/<pack-id>/`, mapped to `speech/` by `extraResources`), so a
machine that has never been online can install Lumina and dictate. That is what
makes the installer ~1 GB rather than ~100 MB, and it is the whole point:
anything downloaded at runtime is not offline.

The payloads are **not in git** — `scripts/fetch-speech-packs.ps1` fetches them
from pinned upstream releases into `resources/speech`. A build without that step
is the small one, and `listSpeechPacks` correctly reports nothing bundled rather
than pretending.

`main/speechPacks.ts` owns the catalogue. Two things there are load-bearing:

- Installing **copies** the pack into `userData` rather than using it where it
  sits, because the install directory is replaced by an update and removed by
  an uninstall. The cost is one duplicated copy on disk, which is why the
  panel shows sizes and offers Remove.
- Removing an *engine* deletes its files one by one, never the folder. Models
  live in `whisper/models`, **inside** the CPU engine's folder, so a recursive
  delete would take a model the user installed separately with it — gigabytes
  of someone else's download destroyed by a button labelled "remove engine".
  `tests/speech-packs.test.ts` pins this down.

The first-run offer (`components/SpeechSetup.tsx`) is a dismissible modal, not
a gate, and appears only when this build carries packs and none are installed.
Declining is recorded in `voice.setupPrompted` exactly as firmly as accepting.

`importSpeechPack` covers the other half of offline: a build with no packs can
take one from a folder or a USB stick, and identifies what it is by looking
inside — an engine by its executable, a GPU build by `ggml-cuda.dll` — because
nothing guarantees the user kept our folder names.

### Live dictation, and why the meter is in decibels

Two measured facts shape all of this.

**Whisper's cost is almost entirely fixed.** Measured on `ggml-small`, per
transcription:

| build                              | 1.1s clip | 3.8s clip |
|------------------------------------|-----------|-----------|
| `whisper-cli`, CPU                 |   6.8 s   |   7.6 s   |
| server (model resident), CPU       |   4.9 s   |   5.1 s   |
| server + `--audio-ctx 512`, CPU    |   1.5 s   |   1.6 s   |
| server, **CUDA** (RTX 3060)        |  0.17 s   |  0.25 s   |

Loading the model dominates the CLI, so a process per phrase can never keep up
— hence the resident server in `main/whisperServer.ts`. Whisper also pads every
input to a 30-second window, so the encoder costs the same for one second of
speech as for thirty; `--audio-ctx` shrinks that window.

`locateVoiceTools` prefers a `whisper-cuda` folder over `whisper` and reports
`gpu`, which is what decides the tuning: **`--audio-ctx` is only passed off
GPU**, because on the CUDA build the reduced window saved 23ms and cost
accuracy. Off GPU it is load-bearing, and only honest because `MAX_PHRASE_MS`
in `lib/liveDictation.ts` caps a phrase below the ~10 seconds 512 frames
covers — change one and the other stops being safe. The model is searched for
across both folders, since the GPU archive ships no model of its own.

**Loudness is logarithmic.** The first meter read `getByteTimeDomainData` and
mapped amplitude linearly, which put ordinary speech at about 3% of the bar:
alive, but visibly dead. `analyserLevel` uses float data over a -60..0 dB range
instead, which puts the same speech near half scale. Both meters go through it
so they cannot drift apart.

`liveDictation.ts` segments on **pauses**, not on a timer — a fixed slice cuts
words in half and whisper cannot recover the pieces, while a pause is exactly
the complete utterance it was trained on. It reads the microphone through
`MediaStreamTrackProcessor` rather than a `MediaRecorder`, and that is what
makes interim results possible at all: a recorder hands back a container blob
only when it stops, so there is nothing to decode until the speaker has already
finished, while raw PCM can be turned into a WAV at any instant.

Each phrase is transcribed **twice over**: every 450ms while it is being spoken
(provisional, rewritten in place) and once when it settles. The early guesses
are deliberately disposable — whisper is much better given a whole utterance,
and in testing the finals corrected "whispered" to "Whisper" and "ends the ten"
to "ends the test". `voice.ts` owns the provisional span and abandons it if the
document no longer matches what it wrote, so typing over dictated text is never
overwritten.

Three things in there are not adjustable knobs:

- An interim result that arrives after its phrase ended is **dropped**, or it
  would overwrite the better final with an earlier guess.
- A quarter-second of audio *before* the detector trips is kept, because it
  always trips late and every phrase otherwise loses its first consonant.
- Finals are chained, not raced, or sentences arrive shuffled.

`WHISPER_LANGUAGES` in `shared/audio.ts` is the dropdown's source. The
**codes** are the contract — `transcribe.ts` passes them to the binary verbatim
and whisper rejects an unknown one with `error: unknown language '…'` — while
the names are only labels and deliberately do not all match whisper's own
strings (it calls `my` "myanmar" and `nn` "nynorsk"). Changing a code needs
checking against the binary; changing a name does not.

The detector and the recording bar's clock both run on `setInterval`, not
`requestAnimationFrame`: a hidden or occluded window delivers **zero** frames,
which froze the meter and the elapsed time. The clock also runs during
`saving`/`transcribing` — a number that keeps moving is what separates "it is
working" from "it has hung", and whisper can take seconds to answer.

`window.ts` answers permission prompts itself and grants **only** the
microphone. Electron's default handler approves more than this window needs, and
both `setPermissionRequestHandler` and `setPermissionCheckHandler` are required:
Chromium asks the second for synchronous capability tests.

The two handlers describe the media type **differently**, and the difference is
easy to miss because getting it wrong does not break recording. The request
handler is given `mediaTypes` (an array); the check handler `mediaType` (one
string). Reading only the array makes every *check* fail, which does not stop
the microphone opening — it strips the names off `enumerateDevices`, so the
picker in `settings/MicTester.tsx` lists "Microphone 1", "Microphone 2" and the
user cannot tell which is their headset. That is also why the picker cannot
show names until the meter has been run once: a page with no granted access is
not told what hardware is attached, so filling the list in is a side effect of
pressing Test.

### The web clipper

The one place Lumina accepts an **inbound** connection, and the only feature
that exists in two codebases: `extension/` is a browser extension, loaded
unpacked, that posts to a listener in `main/clipServer.ts`.

It is an extension rather than something Lumina does by fetching a URL because
that is the whole difference in capability — a clipper that fetches the URL
itself gets the pre-JavaScript document, so a logged-in, paywalled or
client-rendered page comes back as an empty shell. The extension reads the DOM
the user is actually looking at.

**The listener is app-level and comes up at boot** (`index.ts`, from
`loadAppState`), not when a vault opens. The extension should reach Lumina
whenever Lumina is running — including from the tray, and while the profile
picker or a passlock is up. A clip arriving with no vault yet is held by
`drainClips` in the renderer, the same shape as `drainQuickNotes`.

Five guards, and none is redundant — `tests/clip-server.test.ts` covers each
against a real socket:

1. Bound to `127.0.0.1`, never `0.0.0.0`.
2. The `Host` header must itself be loopback. A hostile page can point a name it
   controls at 127.0.0.1 and have the browser connect for it; binding does not
   stop that, this does. Note `fetch` refuses to set `Host`, so that test has to
   be written over a raw socket or it silently tests nothing.
3. A shared token, compared through `timingSafeEqual` over sha256 digests so a
   length mismatch cannot throw and leak the length.
4. The token rides in a **custom header**, which forces a CORS preflight for
   anything on a real web page — and only extension origins are answered.
5. The body is capped and the socket destroyed past the cap.

`validateClip` in `shared/clip.ts` is the only door the payload comes through,
and it re-derives every field rather than spreading the input, so an extra
property cannot ride along into a note. It is pure for the same reason
`openFile.ts` avoids `electron` — it is the part worth testing hardest.

Conversion runs in the **renderer** (`lib/clipToNote.ts`), because turning HTML
into Markdown needs a DOM and the renderer already has one; doing it in main
would mean parsing hostile documents in the process that owns the filesystem.
Two things there are load-bearing:

- `sanitize()` runs before anything else touches the document. Turndown has no
  rule for `<script>`, and with no rule its **text is emitted into the
  markdown** — so stripping has to happen here, not be left to the converter.
  `javascript:` links become plain text, relative URLs are resolved against the
  page, and `on*` attributes are dropped.
- Images are downloaded through main (`clipImages.ts`) *before* conversion, so
  the markdown only ever names local files, and every target goes through
  `encodeTarget` for the same reason pasted attachments do.

`main/net.ts` holds the fetch primitives both outbound features share (http(s)
only, hard timeout, read capped against what actually arrives rather than the
declared `Content-Length`). A third one must not ship without them.

## Style

No formatter or linter is configured, so the typechecker is the only automated
guard and nearby code is the style guide. The existing convention is two-space
indentation, single quotes, **no semicolons**, and trailing commas in multiline
constructs; `PascalCase` for components and exported types, `camelCase` for
functions and variables, `UPPER_SNAKE_CASE` for constants. Import through the
`@/` and `@shared/` aliases rather than long relative chains.

Comments here explain *why* — a measured constraint, a bug that a line prevents.
Several of the traps above (widget margins, the `.cm-line` inset, the
`overflow-y` toggle, the parked-session guards) are documented in place; keep
that reasoning attached to the code when you move it.

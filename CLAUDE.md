# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Lumina is a local-first Obsidian-style note app: an Electron shell around a
CodeMirror 6 editor, styled after the Claude interface. A vault is an ordinary
folder of `.md` files chosen by the user; nothing is stored anywhere else.

## Commands

```
npm run dev                       # run the app with hot reload
npm test                          # all tests
npx vitest run tests/paths.test.ts # one file
npx vitest run -t "resolveLink"    # one describe/it by name
npm run typecheck                 # both tsconfigs (node + web)
npm run build                     # bundle main, preload, renderer into out/
npm run build:dir                 # package to release/win-unpacked (no installer)
npm run build:win                 # NSIS installer + portable exe
```

`npm run typecheck` covers two separate projects — `tsconfig.node.json`
(main, preload, shared, tests) and `tsconfig.web.json` (renderer, shared,
preload). A change to `src/shared` must satisfy both.

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
settings.ts settings, theme, snippets
```

### Three rules that most changes have to respect

**1. `src/shared/markdown-parse.ts` is the only markdown parser.** The
main-process indexer and the renderer's editor decorations both import it, so
link resolution can never disagree between the two sides. Anything that reads
structure out of a note — wikilinks, tags, headings, frontmatter, aliases —
belongs here, not in a component. Resolution order is deliberate: exact path,
then same-folder basename, then shallowest basename, then alias.

**2. The renderer never touches `fs`.** Every path crosses a typed IPC channel
declared in `src/shared/channels.ts`, handled in `src/main/ipc.ts`, and exposed
through `src/preload/index.ts`. `safeJoin` in `src/main/paths.ts` rejects any
path resolving outside the vault root, and it is the only way a relative path
becomes an absolute one. `contextIsolation` on, `nodeIntegration` off,
`sandbox` on. Vault images load over a custom `lumina://` scheme
(`src/main/protocol.ts`) rather than widening the CSP to `file:`.

**3. Nothing hardcodes a colour or dimension.** `styles/tokens.css` declares
every `--lum-*` variable; the theme editor writes the same names as inline
styles on the root element, and user snippets override them again. If you reach
for a hex code in CSS, add a token instead — otherwise the theme editor and
snippets silently stop working for that surface.

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

### Commands are data

`src/renderer/src/lib/commands.ts` is a flat list (~50 entries) read by the
command palette, the global hotkey handler in `App.tsx`, and the hotkey rebinder
in settings. Add an action there, not as a bare click handler, or it will be
missing from the palette and unbindable. Operations spanning more than one store
live in `lib/actions.ts` so the sidebar, a broken link and the palette all create
a note the same way.

Editor-section commands are also bound in CodeMirror's own keymap
(`editor/extensions.ts`). The global handler in `App.tsx` deliberately yields to
CodeMirror when focus is inside `.cm-editor`, so those bindings do not fire twice.

### State

Five Zustand stores under `store/`: `vaultStore` (vault, tree, index),
`workspaceStore` (tabs, panels, history — persisted to `workspace.json`),
`editorStore` (buffers, dirty tracking, debounced autosave), `settingsStore`
(settings, theme, snippets, and `applyTheme` which pushes everything onto the
DOM), `uiStore` (modals, toasts, context menu, prompts).

Files are the source of truth. `<vault>/.lumina/cache.json` is a disposable
mtime-keyed speedup for the index and the serialized search index — bump
`CACHE_VERSION` in `indexer.ts` whenever `NoteIndexEntry` gains a field, or stale
entries will be read back missing it.

Writes are atomic (temp file, then rename) and deletes go to the recycle bin.
Paths the app writes are suppressed in the watcher for ~1.5s so autosave does
not come back as an external edit; a genuinely external edit reloads a clean
buffer and is refused on a dirty one.

## Working on the editor

The CodeMirror instance is built once inside an effect keyed on the note path,
so React Fast Refresh keeps the component mounted and the **previous** extension
set running — edits appear to do nothing. A Vite plugin in
`electron.vite.config.ts` forces a full reload for anything under
`src/renderer/src/editor/`. If you move editor code outside that directory, move
the rule with it.

Settings-dependent extensions go through `settingsCompartment` so preferences
can change without reloading the note.

## Other agent configs

A Codex config (`~/.codex/config.toml`) and a Gemini CLI config
(`~/.gemini/settings.json`) exist on this machine. To bring over MCP servers,
slash commands, subagents, skills or instructions, reply `/import` to see what
is importable, then `/import --yes=<digest>` to apply it. If `/import` is not
available here, run `claude import` from a terminal.

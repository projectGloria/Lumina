# Lumina

A local note app in the shape of Obsidian, wearing Claude's clothes.

Your vault is a folder of plain markdown files that you choose. There is no
account, no sync, no server, and no database — delete Lumina tomorrow and every
note still opens in Notepad. Everything the app knows about your notes lives in
a `.lumina` folder beside them, and all of it is rebuildable.

<!-- Screenshots live in docs/ once you take them; the app looks like the
     Claude interface: warm paper, clay accent, serif headings. -->

## What it does

- **Live-preview markdown editing.** Markdown renders as you type; syntax
  markers appear only on the line the cursor is on. Files stay plain `.md`.
- **Wikilinks and backlinks.** `[[Note]]`, `[[Note|alias]]`, `![[embed]]`, with
  as-you-type suggestions and a backlinks panel showing surrounding context.
  Clicking a link to a note that does not exist yet creates it.
- **Full-text search and tags.** Vault-wide search with match previews, and a
  nested `#tag` tree with counts.
- **Graph view.** Force-directed map of notes and links, on canvas, with a
  local-graph panel for the neighbourhood of the open note.
- **Command palette and quick switcher.** Ctrl+Shift+P and Ctrl+P. Every action
  in the app is a command, and every command can be rebound.
- **Deep customization.** Every colour, font and dimension is a CSS variable
  with a live editor behind it, plus a snippets folder for your own CSS that
  hot-reloads.
- **Opens notes from your file manager.** Double-click any `.md` file and it
  opens in Lumina, in the vault it belongs to. A note that is not in a vault
  yet asks before Lumina adopts its folder as one.
- Daily notes, templates, starred notes, callouts, task checkboxes, frontmatter
  properties, focus mode, and HTML/PDF export.

## Getting started

```
npm install
npm run dev
```

On first run, pick a folder. An empty one gets seeded with a handful of notes
that document the app inside the app; point it at markdown you already have and
Lumina just indexes it.

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the app with hot reload |
| `npm test` | Vitest over the parser, indexer and path guard |
| `npm run typecheck` | Typecheck main, preload and renderer |
| `npm run build` | Build all three bundles into `out/` |
| `npm run build:win` | NSIS installer and portable exe into `release/` |

## How the vault is laid out

```
<vault>/
  Welcome.md                    notes: plain markdown, nest them however you like
  Projects/Gloria.md
  attachments/diagram.png
  .lumina/
    settings.json               editor and appearance preferences
    theme.json                  your colour and font overrides
    workspace.json              open tabs, sidebar widths, last note
    cache.json                  link and tag index — safe to delete, it rebuilds
    snippets/*.css              your CSS, hot-reloaded on save
```

Because all of this lives inside the vault, copying the folder to another
machine brings your theme and layout with it.

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

`contextIsolation` on, `nodeIntegration` off, `sandbox` on. The renderer never
touches `fs`: every path crosses a typed IPC channel and is validated by
`safeJoin`, which rejects anything resolving outside the vault root. Vault
images are served over a custom `lumina://` scheme rather than widening the CSP
to `file:`.

`src/shared/markdown-parse.ts` is the one place wikilinks, tags, headings and
frontmatter are parsed. Both the main-process indexer and the renderer's editor
decorations import it, so link resolution can never disagree between the two.

### Layout

```
src/
  main/      index  window  vault  watcher  indexer  search
             settings  snippets  protocol  starter  ipc  paths
  preload/   index.ts + lumina.d.ts     the typed window.lumina bridge
  shared/    types  channels  markdown-parse
  renderer/
    styles/    tokens.css   <- every colour and dimension in the app
    store/     vault  workspace  editor  settings  ui
    editor/    Editor  livePreview  markdownExtensions  wikilink  format  cmTheme
    components/ sidebars, panels, dialogs, graph, settings
    lib/       commands  actions  hotkeys  fuzzy  render
```

## Theming

`src/renderer/src/styles/tokens.css` defines every `--lum-*` variable; nothing
else in the app hardcodes a colour. Settings → Appearance edits those same
variables live and stores the result in `.lumina/theme.json`, separately for
light and dark.

For anything the editor does not expose, drop a `.css` file into
`.lumina/snippets/`:

```css
:root {
  --lum-accent: #4a7c59;
  --lum-font-heading: 'Newsreader', Georgia, serif;
  --lum-radius: 4px;
}
```

It loads immediately, and each snippet has an on/off switch in settings.

## Notes on the implementation

A few decisions worth knowing if you plan to extend this:

- **Live preview is two providers, not one.** CodeMirror forbids a view plugin
  from producing decorations that span line breaks, so the frontmatter strip
  and rendered tables come from a `StateField` while inline markers come from a
  `ViewPlugin` that can limit itself to the viewport. Getting this wrong fails
  silently — the plugin is disabled and only syntax highlighting remains.
- **Editing beats rendering.** Every rendered block swaps back to raw source
  the moment the caret enters it, so nothing is a one-way transformation.
- **Writes are atomic** (temp file plus rename), and deletes go to the recycle
  bin. Files we write are suppressed in the watcher for a moment so autosave
  does not look like an external edit. Quitting waits for the debounced autosave
  to finish, so closing the window mid-sentence does not cost you the sentence.
- **A double-clicked note has to find its vault**, which the app works out from
  the `.lumina` folder beside it, falling back to vaults you have opened before.
  It asks before treating an unfamiliar folder as a vault, rather than indexing
  wherever the file happened to be.
- **Commands are data.** `lib/commands.ts` is a flat list the palette, the
  hotkey handler and the settings screen all read. It is the seam a plugin API
  would extend.
- **The editor is rebuilt only when the note path changes**, so a Vite plugin
  forces a full reload when anything under `src/renderer/src/editor` changes;
  fast refresh would otherwise leave the previous extension set running.

## Not in this version

Sync and collaboration, mobile, PDF annotation, canvas/whiteboard, and a
JavaScript plugin API. The command registry and CSS-variable system are built
so a plugin API can be layered on without a rewrite.

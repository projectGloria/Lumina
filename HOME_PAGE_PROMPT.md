# Build prompt — Lumina "Home" (customizable daily dashboard)

Paste everything below the line into Claude Code from the repo root.

---

## Task

Add a **Home** view to Lumina: a customizable, widget-based daily dashboard, in the
spirit of Evernote's Home. Read `CLAUDE.md` first — the three rules there
(one markdown parser, renderer never touches `fs`, nothing hardcodes a colour or
dimension) all apply to this feature, and the "Commands are data" and "State"
sections describe the patterns to copy.

Build it in the phases below. Stop after each phase, run
`npm run typecheck && npm test`, and report before continuing.

## Product shape

- One scrollable page: a greeting header (`Good evening, <profile name>` + full
  date) and a grid of widgets underneath.
- Widgets are added, removed, moved, and resized by the user. Layout is
  **per vault** and persists across restarts.
- Two modes: normal (widgets are live and interactive) and **edit layout**
  (drag handles, resize corners, remove buttons, an "Add widget" picker). A
  single toggle button in the page header switches between them. Nothing about
  the layout should be editable by accident in normal mode.
- Empty vault / first run: seed a sensible default layout rather than showing an
  empty page.

## Architecture decisions (make these, don't re-litigate them)

### 1. Home is a tab kind, not a note and not a modal

`TabState` currently assumes `path` names a real note. Home is not a note, so
widen the type rather than faking a path:

```ts
export type TabKind = 'note' | 'home'

export interface TabState {
  kind?: TabKind        // absent means 'note', so an old workspace.json still opens
  path: string          // '' for a home tab
  cursor?: number
  mode?: NoteMode
}
```

Every place that assumes `tab.path` is an indexed note has to learn about this.
Find and handle **all** of them — this is the part most likely to be done
half-way:

- `src/shared/tabs.ts` — `openTab` is the single pure decision point for tab
  opening. Give it a home case (open the existing home tab if there is one,
  never a second). Extend `tests/tabs.test.ts` to pin that down.
- `src/renderer/src/App.tsx` — `receive()` filters restored tabs with
  `!!payload.index.notes[tab.path]`, which drops a home tab on every launch.
- `components/Workspace.tsx` — `PrimaryPane` renders `Editor`/`ReadView`/
  `NoNoteOpen` off `tab.path`; add the home branch. `WordCountBar` must not
  render for it.
- `components/TabBar.tsx` — title and icon for a home tab (it has no
  `titleOf(path)`).
- `store/workspaceStore.ts` — `activePath()` and `activeMode()` must return
  null/'edit' for a home tab; `renamePathInTabs` / `removePathFromTabs` must
  leave it alone (`rebaseDescendantPath('', …)` and `isPathAtOrBelow('', …)` on
  an empty path are exactly the kind of thing that quietly closes the tab).
- `editor/session.ts` — nothing should be parked for a home tab.
- `lib/commands.ts` — commands with `enabled: () => !!activePath()` already
  guard themselves, but check the ones that read the active tab directly.

Add the command `view.home` ("Open Home") to `lib/commands.ts` with a default
accelerator, and a Home entry in the sidebar/title bar so it is reachable
without the palette. Optionally add a setting `home.openOnLaunch` that opens
Home when a vault opens with no tabs restored.

### 2. Widgets are data, the same way commands are

Create `src/renderer/src/home/widgets/index.ts` holding a flat registry:

```ts
export interface WidgetDef<C = unknown> {
  type: string                  // stable id, persisted
  name: string                  // shown in the picker
  description: string
  icon: IconName                // must exist in components/Icon.tsx
  defaultSize: { w: number; h: number }   // in grid units
  minSize: { w: number; h: number }
  defaultConfig: C
  Component: React.ComponentType<WidgetProps<C>>
  Settings?: React.ComponentType<WidgetSettingsProps<C>>  // per-widget options
}
```

Adding a widget must mean adding one entry to that registry and nothing else.
A persisted widget whose `type` is no longer in the registry renders a small
"Unknown widget — remove?" placeholder; it is never silently dropped from the
saved layout, and never throws.

Each widget renders inside a shared `<WidgetFrame>` that owns the card chrome,
title, overflow menu, and an `ErrorBoundary` — one broken widget must not blank
the page.

### 3. Persistence: `<vault>/.lumina/home.json`, its own IPC channels

Do not stuff the layout into `Settings` — it is per-vault layout state, the same
category as `workspace.json`. Follow that file's pattern exactly.

```ts
export interface HomeWidget {
  id: string            // uuid, stable across moves
  type: string          // WidgetDef.type
  x: number; y: number  // grid units
  w: number; h: number
  config: Record<string, unknown>   // validated against the registry on load
}

export interface HomeLayout {
  version: number
  columns: number       // logical column count the coords were authored against
  widgets: HomeWidget[]
}
```

- `src/shared/channels.ts`: `homeGet: 'home:get'`, `homeSet: 'home:set'`.
- `src/main/ipc.ts` + `src/main/settings.ts`: read/write through the existing
  **queued per-file** JSON writer, so two rapid saves cannot interleave into a
  truncated file.
- `src/preload/index.ts`: expose `window.lumina.home.{get,set}`.
- New store `store/homeStore.ts`: debounced persist (500 ms, same shape as
  `workspaceStore`), plus an exported `flushHomePersistence()` that is added to
  the `Promise.all` in `App.tsx`'s `onFlush` handler — otherwise a layout tweak
  is lost when the app quits.
- Loading validates: unknown types kept as placeholders, out-of-range coords
  clamped, overlaps resolved, config merged over `defaultConfig`.

### 4. Grid and dragging — no new dependency

The project has no drag-and-drop or grid library and should not gain one. Write
a small fixed-column grid:

- CSS grid, `columns` from a `ResizeObserver` on the page (e.g. 4 columns wide,
  2 narrow, 1 below ~640px). Widget `x/w` are clamped to the current column
  count for display; the authored `columns` in the file is what's persisted.
- Drag and resize with pointer events on the frame, moving a *ghost* while the
  pointer is down and committing the layout once on `pointerup`. Live positions
  live in a ref and are drawn from `requestAnimationFrame` — putting a
  pointermove into React state re-renders the whole board on every frame, the
  same reason `GraphView` keeps node positions in refs.
- Collision/compaction is a **pure function** in `src/shared/homeLayout.ts`
  (`placeWidget`, `compact`, `clampToColumns`), covered by
  `tests/home-layout.test.ts` in vitest's node environment. Keep the renderer
  side to drawing only.
- Keyboard accessible: a focused widget in edit mode moves with arrow keys and
  resizes with Shift+arrows. Drag handles get `aria-label`s.

### 5. Widgets read existing state, never the filesystem

Everything the first widget set needs is already in the stores. No widget gets
its own IPC channel.

| Widget | Source |
|---|---|
| Daily note | `settings.dailyNotes` + `applyTemplate` from `@shared/template`; opens/creates via `lib/actions.ts` |
| Quick capture | writes through the same `actions.ts` path as the quick note — do not re-implement note creation |
| Scratch pad | one designated note (configurable path), edited inline |
| Recent notes | `vaultStore` index, sorted by `mtime` |
| Starred | `settings.starred` |
| Pinned | `settings.pinned` |
| Tags | `index.tags` |
| Tasks | see below |
| On this day | `index` `createdAt`, same day-of-year in prior years |
| Vault stats | `index` — note count, word count, unresolved links |
| Clock / date | local only |

**Tasks needs an index change.** `NoteIndexEntry` has no task data. Add
`tasks: { text: string; done: boolean; line: number }[]`, parsed in
`src/shared/markdown-parse.ts` (the only markdown parser — do not regex tasks
inside a component), and **bump `CACHE_VERSION` in `src/main/indexer.ts`** or
stale cache entries read back without the field. Add parser tests.

**No widget may make a network request.** Lumina's stated promise is that with
`editor.linkPreviews` off the app makes no network requests at all. That rules
out weather, RSS, and quotes-of-the-day in this feature. If you want one later
it has to be opt-in behind a setting and routed through `main/net.ts`, and the
promise in `CLAUDE.md` has to be rewritten to match. Do not add one now.

### 6. Styling

Every colour, radius, spacing and dimension is a `--lum-*` token from
`styles/tokens.css`. If you need a value that has no token, **add the token** —
a hex code in CSS silently opts the surface out of the theme editor and user
snippets. Put the new rules in `styles/panels.css` (or a new `home.css`
imported alongside it), and add any token that HTML export needs to
`currentTokens()` in `lib/render.ts`. Icons go into the map in
`components/Icon.tsx`, not inline in a component.

## Phases

1. **Plumbing.** Types, channels, main handler, preload, `homeStore`,
   `flushHomePersistence` wired into the quit flush. Home tab kind through
   `tabs.ts` and every call site listed in §1. Route renders an empty board.
   Tests: `tabs.test.ts` extended.
2. **Grid.** `shared/homeLayout.ts` + tests, the board component, drag/resize/
   remove in edit mode, add-widget picker, responsive column count.
3. **Widget set.** Registry + `WidgetFrame` + the widgets in the table above,
   minus tasks. Default layout for a fresh vault.
4. **Tasks.** Parser change in `markdown-parse.ts`, `CACHE_VERSION` bump,
   parser tests, tasks widget (checking a box writes back to the source note
   through the normal buffer/save path).
5. **Polish.** Per-widget settings panels, keyboard moves, empty states,
   command palette entries, a Home section in `SettingsModal` if the widgets
   grew enough options to need one.

## Constraints

- Style: two-space indent, single quotes, **no semicolons**, trailing commas in
  multiline constructs. `PascalCase` components/types, `camelCase` functions,
  `UPPER_SNAKE_CASE` constants. Import via `@/` and `@shared/` aliases.
- Both tsconfigs must pass; `noUnusedLocals` means a leftover import is a build
  failure. Anything added to `src/shared` has to satisfy the node project too.
- Renderer never imports `electron` or `fs`. New capability = channel + ipc
  handler + preload + types, all four.
- Comments explain *why* — a measured constraint, a bug the line prevents — not
  what the line does.
- Before you say it's done: `npm run typecheck && npm test && npm run build`.

## What to report back

For each phase: files touched, the design choice you made at any fork, and
anything in the existing code you had to change that wasn't listed above (those
are the interesting ones — they mean an assumption in this prompt was wrong).

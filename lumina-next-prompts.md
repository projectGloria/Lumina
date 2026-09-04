# Lumina — next round of work (prompts for Claude Code)

Paste these one at a time, in order. Each is self-contained. Prompt 0 is a
short preamble worth pasting once at the start of a session; after that, one
phase per session so the context stays clean.

---

## Prompt 0 — session preamble (paste once)

> Read `CLAUDE.md` before you touch anything, and treat the three rules in it
> as hard constraints: one markdown parser (`src/shared/markdown-parse.ts`),
> the renderer never touches `fs` (every new capability = `shared/channels.ts`
> + `main/ipc.ts` + `preload/index.ts` + `shared/types.ts`), and nothing
> hardcodes a colour or dimension (add a `--lum-*` token in
> `styles/tokens.css` instead).
>
> House rules for everything below:
> - Style: two-space indent, single quotes, **no semicolons**, trailing commas
>   in multiline constructs. Import via `@/` and `@shared/`. Comments explain
>   *why* — a measured constraint or a bug a line prevents — not what.
> - The pure, testable half of any feature goes in `src/shared` with a vitest
>   suite; only drawing lives in the renderer. Tests run in the `node`
>   environment, so nothing you test may need a DOM.
> - Finish every phase with `npm run typecheck` (both projects — a leftover
>   import fails it) and `npm test`, and don't hand back work that is red.
> - Don't refactor things I didn't ask about. If you find something broken
>   outside the phase's scope, list it at the end instead of fixing it.
> - Ask me before adding any npm dependency, and before any change that would
>   make the app touch the network. Lumina makes no network requests with
>   `editor.linkPreviews` off, and that stays true.

---

## Prompt 1 — Home: bug audit and fixes

> Audit the Home dashboard (`src/renderer/src/home/**`,
> `src/renderer/src/store/homeStore.ts`, `src/shared/homeLayout.ts`, and the
> `home:*` IPC path) for bugs. **First produce a written findings list** —
> each item as `file:line`, what goes wrong, and the exact steps to reproduce
> it. Then fix them. Don't start editing before I've seen the list.
>
> Start from one I've already hit, because it tells you what kind of bug I
> care about:
>
> **Ticking a task makes it vanish.** In `home/widgets/TasksWidget.tsx` the
> list is filtered by `config.showDone || !done`, and `showDone` is `false` by
> default — so the moment the optimistic `pending` tick lands, the row is
> filtered out of `tasks` and the task disappears with no trace. From the
> user's side a checkbox was clicked and something was deleted. Two things are
> wrong and both need fixing:
>
> 1. A task ticked *in this session* must stay on the board, drawn as done and
>    struck through, until I do something else — not filtered out mid-click.
>    Give it a "just completed" holding set that survives the index round trip,
>    with an obvious way to undo (a row that stays clickable, or an undo
>    affordance on the card). Have it clear on a timer of several seconds, on
>    widget remount, or when I untick it — whichever comes first. Don't make
>    it a config option; make the default behaviour honest.
> 2. The list is sorted by `note.mtime`, so writing the tick rewrites the note,
>    bumps its mtime and **reorders the whole list under my cursor**. Freeze
>    the ordering while a tick is settling.
>
> Then audit the rest. Places I'd look, not an exhaustive list — find your own
> too:
>
> - `keyOf(path, line)` splits on the *last* `:` — check it holds for every
>   path shape the vault can produce, and that a stale line number from an
>   index snapshot degrades gracefully (the "task has moved" toast is the
>   right idea; make sure it can't fire spuriously).
> - `updateNoteContent` opens, edits, saves and releases the buffer. What
>   happens when the note is already open in a tab with unsaved edits, or open
>   and dirty in the *background*? Ticking a box must never lose typing.
> - The `pending`-reconciliation effect in `TasksWidget`: convince yourself it
>   can't strand an entry forever if the note is deleted or the line vanishes.
> - `homeStore.setCover(null)` drops the reference but leaves the image file in
>   `.lumina/home` forever. Same for replacing a cover. Decide on a lifecycle
>   and implement it.
> - Widget config: a stored `config` from an older build merged over a newer
>   `defaultConfig` — does every widget survive missing and unexpected keys?
>   `home.json` is a file I could have edited by hand.
> - Grid: drag/resize at the smallest column count, a widget at `minSize`,
>   removal-then-compact, and the "arranged at a narrow width" re-authoring
>   path in `commit`. Does a rearrange on a small window quietly destroy a
>   layout I built wide?
> - Per-widget: `ScratchWidget` persistence (does it lose text on unmount /
>   vault switch?), `CalendarWidget` and `HeatmapWidget` date bucketing across
>   month ends, DST and locale week-start, `ClockWidget` interval cleanup,
>   `GraphWidget` when the card is tiny or the vault is empty, `CaptureWidget`
>   before a vault is open, `OnThisDayWidget` on Feb 29.
> - Vault switching: `useHome.reset()` vs. in-flight `load()` and the debounced
>   persist — can one vault's board be written into another vault's
>   `home.json`? `editorStore` has a `vaultGeneration` guard for exactly this
>   shape of race; check Home has the equivalent.
> - Empty states and first run: a vault with no notes, no tasks, no tags.
> - Keyboard and focus: every widget action reachable without a mouse, and
>   `Edit layout` mode escapable.
>
> Add vitest coverage for whatever pure logic comes out of this (layout
> compaction, date bucketing, the completed-task holding rule if you can make
> it a pure function). Report anything you found and deliberately did *not*
> fix.

---

## Prompt 2 — Home: make it look like something

> The Home board is functionally fine and visually flat — it reads as a grid of
> grey boxes. Give it depth and warmth without touching the grid model or any
> widget's behaviour. This is a `styles/` + presentation-layer job; if you find
> yourself changing `homeStore` or the layout maths, stop.
>
> Constraints:
> - Every colour, radius, shadow, blur and dimension is a `--lum-*` token in
>   `styles/tokens.css`. New tokens are fine — new hex codes in `home.css` are
>   not. If a token needs to survive HTML export, add it to `currentTokens()`
>   in `lib/render.ts`.
> - It has to hold up in light **and** dark, and under a user theme that has
>   overridden the palette. Check both before you call it done.
> - Respect `prefers-reduced-motion` for anything that animates.
> - No new dependency, no network, no remote fonts or images.
>
> What I'm after — "cozy, considered, quietly alive", the Claude/Notion end of
> the spectrum, not a neon dashboard:
>
> - **The header block.** Right now it's a greeting and a date on nothing.
>   Give it a ground: a soft token-derived gradient wash that shifts with the
>   time of day (the same four bands `greetingFor()` already knows about), so
>   morning and midnight don't look identical. When there's no cover image,
>   that wash is what sits at the top of the page instead of a hard edge.
> - **Cards with hierarchy.** Layered surface tokens rather than one flat
>   panel colour: card background, a hairline border, a shadow that lifts on
>   hover, and a header row with the widget's icon in a tinted chip. Let a
>   widget optionally declare an accent (add it to `WidgetDef`, default it, and
>   use it for the icon chip and any of the widget's own emphasis) so the board
>   has colour that means something instead of decoration.
> - **Density and rhythm.** Consistent internal padding, a real type scale for
>   card titles vs. row text vs. meta, and truncation that doesn't jitter.
> - **Empty states that aren't a sentence in grey.** Use a glyph from
>   `components/Icon.tsx` (add ones you need to that map — no one-off inline
>   SVG) plus a short line and, where it makes sense, the action that fixes
>   the emptiness.
> - **Loading.** The index arrives asynchronously; a card that has nothing yet
>   should show a skeleton, not "Nothing outstanding" followed by content.
> - **A little life.** Progress and stats deserve to be drawn, not printed —
>   a ring for progress, a sparkline of the last N days for stats, real
>   intensity steps on the heatmap. Keep them canvas-free and cheap; these
>   redraw on every index update.
> - **Edit-layout mode** should read as a different mode: a subdued board, a
>   visible grid, drag handles that appear rather than always sit there.
>
> Before you write CSS, show me the token additions you plan to make and a
> one-paragraph description of the look. Then implement. Screenshot-free is
> fine — I'll run it.

---

## Prompt 3 — Music vault and a mini player

> New feature. I want to point Lumina at a folder of my own music and have a
> small, unobtrusive, good-looking player inside the app. It never touches the
> network, and the music folder is **not** part of the vault and must never be
> indexed, watched, or shown in the explorer.
>
> **Where the setting lives.** A music folder is a property of the machine, not
> of a vault, so it belongs with the app-level settings — the same split
> `hotkeys`, `slashCommands` and `quickNote` already use in
> `main/settings.ts`. That means a new `music` block in `Settings` **plus**
> adding it to `AppState`, to the `appLevel` overlay in `loadSettings`, and to
> both writes in `saveSettings`. Shape it as roughly
> `{ folder: string, volume: number, shuffle: boolean, repeat: 'off' | 'all' | 'one', lastTrack?: string, lastPosition?: number }`.
> The Settings modal gets an "Open music vault" row: a folder picker showing
> the current path, a track count, and a way to clear it.
>
> **Serving the audio.** Don't widen the CSP and don't reach for `file:`. The
> `lumina://` handler in `main/protocol.ts` already dispatches on hostname
> (`lumina://vault/...`), so add `lumina://music/...` resolved against the
> music root, guarded exactly as strictly as the vault path is — generalise
> `safeVaultPath` into a "safe path under this root" helper rather than
> copying it, and keep the `realpath` step so a symlink in the music folder
> can't serve me my whole disk. The renderer CSP already allows `media-src`
> for `lumina:`, so nothing there should need to change — verify that rather
> than assuming it.
>
> **New IPC** (channels + ipc + preload + types, all four): pick the music
> folder, and list it. Listing walks the folder recursively for audio
> extensions, caps the result, returns vault-root-relative `/`-separated paths
> plus size and mtime, and does **not** block the main process on a large
> library. Nothing else about the folder crosses IPC.
>
> **The pure half** goes in `src/shared/music.ts` with a vitest suite: the
> audio-extension predicate, filename → `{ artist, title, track }` parsing for
> the common shapes (`01 - Title`, `Artist - Title`, plain), duration
> formatting, and the queue model — next/prev, the three repeat modes, and a
> shuffle that is a *bag* (every track plays once before any repeats) rather
> than a random pick each time. Test the queue hard; it's the part that will
> annoy me if it's wrong.
>
> **The renderer.** A new `store/musicStore.ts` and a `components/MiniPlayer.tsx`.
> The `HTMLAudioElement` is a module-level singleton and never React state —
> same reasoning as the module-level `RecorderHandle` in `lib/voice.ts`; only
> the phase the UI draws goes through the store. Two presentations off one
> state: a compact bar (art thumbnail, title, prev/play/next, a scrub line)
> that lives in the status-bar strip and is present wherever I am in the app,
> and an expanded panel with the queue, search-as-you-type over the library,
> shuffle/repeat and volume. Add a `music` Home widget off the same store so
> it can sit on the board too. Player commands go in `lib/commands.ts` like
> everything else, so they're in the palette and rebindable — play/pause,
> next, previous, toggle the player. Do **not** register OS-level media keys.
>
> **Artwork.** No embedded-tag reading unless you ask me first about the
> dependency. Without one: look for `cover.*` / `folder.*` / `album.*` beside
> the track, fall back to a generated token-coloured tile seeded by the album
> or folder name — which should look deliberate, not like a missing image.
>
> Behaviour I care about: it remembers the track and position across restarts;
> it doesn't autoplay on launch; it survives a vault switch untouched (music
> is app-level, the board isn't); a missing or moved file skips forward with a
> quiet toast rather than dying; and pausing/seeking never costs more than one
> frame of jank while the editor has focus.
>
> Tell me the plan — files, IPC names, store shape — before you write it.

---

## Prompt 4 — Per-note covers and thumbnails (Notion-style)

> Every note should be able to carry a **cover image** and an **icon**, the way
> a Notion page does, and those should show up everywhere the note is
> represented.
>
> **Source of truth is the note's own frontmatter**, not a sidecar map in
> settings. `cover: attachments/photo.jpg`, `coverY: 42` (the vertical focal
> point, 0–100), `icon: 📓`. Reasons, which I want respected: a vault is a
> plain folder of markdown by design, so the decoration has to survive being
> read by any other editor; a path-keyed settings map would need adding to
> *both* the `rename*` and `remove*` helper pairs in `lib/actions.ts` and to
> `promptRename` / `movePath` / `confirmDelete`, and would silently rot the
> first time one of those was missed. Parsing goes in
> `shared/markdown-parse.ts` — it's the only thing that reads structure out of
> a note — and `NoteIndexEntry` gains `cover?` / `coverY?` / `icon?`, which
> means bumping `CACHE_VERSION` in `indexer.ts` or stale cache entries come
> back missing the fields.
>
> **Where a cover is drawn.** In the editor, draw it as React chrome *above*
> the CodeMirror view — **not** as a block widget in `livePreview.ts`. A
> full-width image inside the height map is exactly the class of thing that
> desyncs `posAtCoords` from `coordsAtPos` and makes clicks land on the wrong
> line, and the frontmatter strip already occupies that slot. Read mode gets
> the same header from `lib/render.ts`, off the same class names, the way link
> banners are drawn twice off one set.
>
> **Reuse, don't fork.** `home/HomeCover.tsx` already implements
> drag-to-reposition with the `requestAnimationFrame`/commit-on-pointerup
> discipline. Extract that into one shared `CoverImage` component used by both
> the Home board and note covers, with the position committed to frontmatter
> for a note and to `home.json` for the board. One implementation, two callers.
>
> **Where a thumbnail shows.** In descending order of how much I want it:
> 1. The note header (cover + icon + title), edit and read mode.
> 2. Explorer rows in `components/FileTree.tsx` — the icon replaces the
>    `PathIcon` glyph, and a note with a cover gets a small thumb. This must
>    size itself off the `--lum-tree-*` tokens that `settings.explorerSize`
>    writes; sizing a glyph with an inline style opts it out of the setting
>    (see what `PathIcon` used to do wrong).
> 3. Home widgets that list notes — recent, starred, pinned, on-this-day —
>    which become small cards when the note has a cover.
> 4. Search results, the quick switcher, tab titles (icon only), and the
>    wikilink `LinkChipWidget` / link banner for an in-vault target.
> 5. Graph nodes: optional, and only if it doesn't cost frame rate. Ask before
>    doing it.
>
> **Setting one.** A cover control on the note header and a context-menu entry
> in the explorer: pick an image from disk (copied into `attachmentFolder`
> through the existing attachment-save path), pick one already in the vault, or
> remove. Targets written into frontmatter follow the same `encodeTarget` /
> `decodeTarget` discipline as any other attachment reference, and display
> goes through `vaultUrl` — decode twice anywhere in that chain and the image
> 404s silently. Icons: an emoji picker is enough; also allow any name from
> `components/Icon.tsx`.
>
> **Performance.** A vault with hundreds of covered notes shouldn't load
> hundreds of full-size JPEGs to draw an explorer. Decide how you're handling
> that — a cached downscaled thumbnail under `.lumina/thumbs`, keyed by source
> mtime, is the obvious answer — and tell me before you build it.
>
> Not in this phase, but design so it isn't painful later: a Notion-style
> gallery view of a folder, where the covers are the point.
>
> Plan first, then build.

---

## A note on scope

You're building toward "the only note app I need". The four phases above are
the ones you asked for; from what's already in the repo, the things most
likely to be missed next are a per-folder gallery/board view (Notion's real
differentiator, and covers are the prerequisite), inline task queries with due
dates (Obsidian Tasks — you already parse checkboxes and have the widget), and
saved searches. None of those need doing now — but the frontmatter-first
decision in Prompt 4 and the queue-in-`shared` decision in Prompt 3 are what
keep them cheap later.

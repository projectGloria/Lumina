# Lumina Feature Roadmap — Progress

Tracks work completed against the roadmap in `CLAUDE.md`, phase by phase. Each phase has its
own plan file entry (see session history) covering exploration, scope decisions, and
verification; this document is the running summary.

## Phase 1: Visual & UI Polish — done

- **Empty states** — empty vault, empty tag filter, and no-search-results now use a richer
  icon + heading + helper-text treatment instead of a plain line of text.
  (`FileTree.tsx`, `SearchPanel.tsx`)
- **Rich links on paste** — pasting a bare URL inserts a markdown link (domain as label); any
  external `[label](https://…)` link renders as a small pill/chip with an icon in live
  preview. Full OpenGraph-style previews (fetched title/image) are out of scope — would need
  a new IPC channel. (`editor/linkPaste.ts`, `editor/livePreview.ts`)
- **Folder & file icons** — right-click → "Change icon…" picks from a built-in icon set per
  file/folder, persisted in settings and kept in sync across rename/move/delete. Arbitrary
  custom image/.ico upload deferred (needs new IPC surface). (`lib/actions.ts`, `FileTree.tsx`)
- **Typography** — Sans/Serif/Mono quick-toggle added above the existing font-stack fields in
  Settings → Editor. (`components/settings/SettingsModal.tsx`)
- **Breadcrumbs** — title bar shows the full folder path (vault / folder / … / note), each
  segment clickable to reveal that folder in the sidebar. (`TitleBar.tsx`)
- **Already implemented, verified only**: editor padding, hidden inactive scrollbars,
  resizable/collapsible sidebars + focus mode.

## Phase 2: Editor & Markdown Experience — done

- **Save indicator** — `Ctrl+S` shows a "Saved" toast on a successful write of dirty content.
  (`lib/commands.ts`)
- **Edit/View mode toggle** — `Ctrl+Shift+E` (and command palette) swaps the editor for a
  rendered, read-only view reusing the export markdown pipeline; editor stays mounted
  underneath so undo history and scroll position survive the round trip.
  (`lib/render.ts`, `editor/ReadView.tsx`, `components/Workspace.tsx`)
- **Double-click to create a note** — works in the empty sidebar area and the empty editor
  area. (`FileTree.tsx`, `components/Workspace.tsx`)
- **Word/character count** — toggleable status bar under the editor (command palette →
  "Toggle word count"). (`components/Workspace.tsx`)
- **Image paste & drag-and-drop** — pasting or dropping an image saves it into the vault's
  attachment folder and inserts a working `![]()` link. The IPC plumbing for this already
  existed but was unused. (`editor/attachments.ts`)
- **Math block** — `/math` in the slash menu inserts a `$$ … $$` fence (insert only, no KaTeX
  rendering). (`editor/format.ts`, `editor/slashCommands.ts`)
- **Already implemented, verified only**: global Ctrl+N, interactive checkboxes, slash
  commands, auto-pairing, ordered-list auto-numbering.

## Phase 3: Navigation & Organization — done

- **Editor context menu** — right-click gives Bold/Italic/Link/Cut/Copy/Paste/Copy-as-wikilink
  instead of Electron's bare native menu. (`editor/contextMenu.ts`)
- **Advanced search filters** — "Titles only" and "This folder" toggles, wired end-to-end
  through IPC. (`components/SearchPanel.tsx`, `main/search.ts`)
- **Outgoing-links counter** — collapsible "Links out · N" section next to backlinks, reusing
  outgoing-link data that already existed in the index. Scoped to note-level only; a
  folder/vault-wide link view belongs to Graph View (phase 5).
  (`components/BacklinksPanel.tsx`)
- **Note & folder pinning** — right-click → Pin hoists pinned files/folders to the top of
  their level in the tree; distinct from the existing starred panel.
  (`FileTree.tsx`, `lib/actions.ts`)
- **File sorting** — sort button in the file tree header (Name / Date modified / Date
  created); added `createdAt` to the file index (bumped `CACHE_VERSION`).
  (`FileTree.tsx`, `main/vault.ts`, `main/indexer.ts`)
- **Split view** — right-click a tab → "Open in split view" opens a second, resizable pane.
  Surfaced and fixed a real bug: the app's command-dispatch singleton assumed only one editor
  is ever mounted — fixed by tracking focus rather than mount order, so formatting commands go
  to whichever pane you're actually typing in. Scoped to exactly two panes, no tab bar in the
  split pane, no drag-between-panes. (`components/Workspace.tsx`, `editor/activeView.ts`)
- **Already implemented, verified only**: Table of Contents/Outline panel, Tag pane.

## Phase 4: Profiles & Security — done

Scope decisions made up front: the passlock is a **UI gate only**, not encryption (a vault
stays a plain folder of `.md` files by design); a **profile = one vault** plus its settings,
not a container for multiple vaults.

- **Profile creation & passlock** — new profiles get an optional password (blank = none),
  hashed with scrypt in the main process, never sent as plaintext across IPC.
  (`main/profiles.ts`)
- **First-launch prompt** — app no longer auto-opens the last vault at startup; always shows
  the profile picker first, and re-locks any passworded profile every launch (unlock state is
  session-only). (`main/index.ts`, `ProfilePicker.tsx`, `PasslockScreen.tsx`)
- **Profile indicator** — bottom-left of the sidebar rail, colored-initial avatar (no image
  upload yet), click opens switch/rename/password/delete.
  (`ProfileIndicator.tsx`, `Sidebar.tsx`)
- **Account switching** — switching profiles switches vaults via the existing vault-open flow.
  Found and fixed a real bug while wiring this: switching to a brand-new profile with no vault
  yet would have left the previous profile's vault/tabs/buffers showing through — added
  `clearVault()` plus a workspace/editor reset for that case.
  (`store/profileStore.ts`, `store/vaultStore.ts`)
- Existing installs migrate automatically: a `lastVault` with no profiles yet becomes one
  default profile on first load, so upgrading doesn't strand anyone on an empty picker.

## Verification

Every phase: `npm run typecheck` (both tsconfigs) and `npm test` (89 tests) pass. Manual
in-app verification is still recommended for each phase — Electron isn't drivable through the
browser tooling available in this session.

## Not yet started

**Phase 5: Power User Extras** — Quick Capture window (global hotkey, bypasses profile
login), Daily Notes (partially exists already — `openDailyNote`/`dailyNotes` settings were
found already implemented), Note Templates, Graph View, Local Trash / History.

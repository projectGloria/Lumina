# Quick Note implementation notes

## Launch and identity
Run `npm run dev:quicknote` or build and run `npm run start:quicknote`.
The synchronous main dispatcher reads `--quicknote` or packaged
`launchMode: quicknote` metadata. Separate main bundles preserve Vault's
pre-ready protocol registration and keep its services off Quick Note's boot path.
Quick Note uses its own single-instance lock and `lumina-quicknote` userData;
a second launch focuses its existing window. Vault's existing shortcut is unchanged.

With no explicit flag, a file argument decides which application starts
(`src/main/fileRoute.ts`): a markdown note inside a vault goes to Vault, and any
other text document — plus markdown outside a vault — goes to Quick Note. The
check is synchronous, runs before `app.ready`, and treats a `.lumina` folder on
an ancestor or a root remembered in `lumina.json` as proof of a vault. A
multi-file selection is decided on its first argument.

Because the two applications keep separate userData directories they hold
separate single-instance locks, so a second launch carrying a `.txt` fails Quick
Note's lock, hands its argv over through `second-instance`, and exits. Both
applications can run at the same time. Files arriving before the renderer exists
queue in main and are drained by `qn:pendingFiles` on mount, so a cold start and
an already-open window are the same code path.

## Opening files
The command line, a second instance, macOS `open-file`, the Ctrl+O dialog and a
drop on the window all converge on one renderer function. A file already open is
focused rather than opened twice — and its buffer is left alone, so re-opening a
file with unsaved edits does not discard them. A single untouched `new 1` is
consumed rather than left beside the file the user asked for.

Reads are refused above 16 MB or when the first 8 KB look binary, both with a
message in the status bar. A byte-order mark is honoured, so UTF-16 files open
correctly; UTF-16 with no BOM is indistinguishable from binary and is refused
rather than decoded into replacement characters and offered for saving back.

Quick Note has no vault, so `paths.ts` and its traversal guard deliberately do
not apply. What replaces them: `trusted(event)` on every handler, a sandboxed
renderer with no other route to `fs`, and the two refusals above.

## Persistence and close
UUID-keyed drafts contain text, cursor offset, creation and update timestamps.
The newest draft restores first; the draft selector exposes older buffers.
Writes to `quicknote-cache/session.json` are serialized and replaced through a
temporary file, after 2.5 seconds of inactivity and on blur/close.
A normal close waits for acknowledgement. After 300 ms the status shows
“Saving…”. Failure or a five-second timeout offers Retry, Keep Open, or Close
Anyway (which may lose the last changes). No indefinite close lock is required.
An unreadable cache is never replaced with an empty session.
Crash loss within the debounce interval is accepted; there is no recovery journal.

Ctrl/Cmd+S saves, Ctrl/Cmd+N creates another draft, and Ctrl/Cmd+W closes.
The editor is frozen during explicit save; only successful note creation removes
that draft. A failed cache cleanup is reported. Force-close or a crash between
note creation and cache cleanup may restore an already-saved draft.

## Saving and appearance
Quick Note follows a compact dark text-editor layout: toolbar, tabs,
line-number gutter, plain text area, and character/line/cursor status, plus the
active file's line ending and encoding. Theme and font size remain independent
preferences.

Ctrl+S writes a file-backed buffer straight to its own path; a buffer that has
never been saved falls through to Save As, and Ctrl+Shift+S always asks. **A
saved buffer stays open** — that is the difference between a scratchpad that
files things away and an editor. No Vault configuration is read and no Inbox or
other destination is chosen automatically.

Writes go through a temporary file and a rename, so an interrupted save cannot
leave a half-written document. The target is realpath'd first: renaming onto a
symlink would replace the link rather than its target. The file's own line
ending, encoding and byte-order mark are restored, so saving a file nothing was
typed into returns it byte-identical. A new draft defaults to the platform's
line ending — CRLF on Windows.

A tab shows a dot when its buffer differs from disk, and the title bar an
asterisk. Closing a modified buffer offers Keep Open, Save (or Save As… for an
untitled one) and Discard Changes; a cancelled or failed save leaves the buffer
open rather than closing it anyway. Automatic unsaved-session caching remains
enabled, and the cache carries the file fields so a restart restores both the
paths and any unsaved edits.

## Packaging pending supplied artwork
Do not add the second profile until icon assets are confirmed:
- `resources/quicknote/icon.ico`: 16, 24, 32, 48, 64, 128, 256 px.
- `resources/quicknote/icon.icns`: 16–1024 px, including Retina representations.
- `resources/quicknote/icons/NxN.png`: 16, 32, 48, 64, 128, 256, 512 px.
- Optional 1024 px PNG master.

The future profile should use productName Lumina Quick Note, appId
com.nihil.lumina.quicknote, separate executable/output names, and launchMode
metadata. Omit Vault file associations and speech packs. Run two builder
profiles after compilation. Validate installed taskbar/Dock identities on each
platform; development Electron icons do not establish packaged identity.
Cold-start sub-second appearance remains a measurement target.

The renderer now has two HTML entries under the src Vite root. Vault's built
HTML lives at out/renderer/renderer/index.html; its loader and release verifier
are updated together.

## File associations
`electron-builder.yml` registers roughly 90 extensions across markdown, text,
config, data, web, source, script and build groups. Every entry is
`role: Editor`, so Lumina appears under "Open with" and never seizes an
extension's existing default. Markdown carries the Lumina icon; everything else
carries Quick Note's, since that is the application that will open it. Keep the
list in step with `TEXT_EXTENSIONS` in `src/shared/textFiles.ts` — a type
registered in the installer that Quick Note refuses would open an error rather
than a file.

## Validation
Typechecking, production compilation and 162 Vitest cases pass. Earlier Electron
smoke checks using isolated appData and a disposable vault verified debounce
persistence, new/save shortcuts, immediate-close flushing, restoration on
relaunch, force-close after an injected filesystem failure, and Vault boot.
Native dialog button choices were automated for the failure check.

The file-opening work adds `tests/textFiles.test.ts` (23 cases: the name
allowlist, binary detection, encoding round-trips, line-ending detection),
`tests/fileRoute.test.ts` (14: routing, argv parsing, reading remembered vaults,
the `.lumina` marker walk) and `tests/quicknoteFiles.test.ts` (17: the buffer
model and the read/write pair, including CRLF, BOM, UTF-16 and symlink cases).
Routing was checked at runtime against the built output: a `.txt` and a markdown
file outside a vault both opened in Quick Note with the file in a tab, a markdown
file inside a vault opened Vault, a second launch handed its file to the running
Quick Note as a new tab rather than starting a process, and an opened file was
left byte-identical on disk.

Not verified: saving driven through the real UI (the `writeDocument` layer under
it is covered by unit tests, the Ctrl+S IPC handler is not), drag-and-drop, the
installed file associations, packaged identity and cold-start timing.

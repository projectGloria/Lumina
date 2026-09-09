# Quick Note implementation notes

## Launch and identity
Run `npm run dev:quicknote` or build and run `npm run start:quicknote`.
The synchronous main dispatcher reads `--quicknote` or packaged
`launchMode: quicknote` metadata. Separate main bundles preserve Vault's
pre-ready protocol registration and keep its services off Quick Note's boot path.
Quick Note uses its own single-instance lock and `lumina-quicknote` userData;
a second launch focuses its existing window. Vault's existing shortcut is unchanged.

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

## Save As and appearance
Quick Note follows a compact dark text-editor layout: toolbar, draft tabs,
line-number gutter, plain text area, and character/line/cursor status.
Theme and font size remain independent preferences.

Every explicit save opens a native Save As dialog. The user chooses the folder
and filename; cancelling retains the draft. No Vault configuration is read and
no Inbox or other destination is selected automatically. The exact approved
path is written using the shared note writer, with overwrite confirmation in
the native dialog. Automatic unsaved-session caching remains enabled as requested.

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

## Validation
Typechecking, production compilation, and eight Vitest regression tests pass.
Electron smoke checks using isolated appData and a disposable vault verified
debounce persistence, new/save shortcuts, immediate-close flushing, restoration
on relaunch, force-close after an injected filesystem failure, and Vault boot.
Native dialog button choices were automated for the failure check. Packaged
identity and cold-start timing have not been verified.

; Registers "Lumina Quick Note" with Windows as an application of its own.
;
; Windows' "Open with" list and Settings > Default apps enumerate executables,
; not launch flags, so `Lumina.exe --quicknote` could never be picked as a
; default. "Lumina Quick Note.exe" is a ~10 KB launcher (build/quicknote-launcher)
; that runs exactly that command; this script gives it the registry presence of
; a real app. Nothing here takes a default away from anyone — Windows 10/11 only
; let the user set defaults (UserChoice is hash-protected), so the most an
; installer can do is offer itself.
;
; Per extension, three things are written (see QuickNoteExtAdd):
;   1. .ext\OpenWithProgids\<our ProgID>   → listed under "Open with"
;   2. Applications\<exe>\SupportedTypes   → listed when browsing for an app
;   3. Capabilities\FileAssociations       → listed in Settings > Default apps
; plus an "Open with Lumina Quick Note" right-click verb under
; SystemFileAssociations\.ext\shell — consulted whichever app owns the extension,
; so the verb shows on a .json VS Code opens just the same.
;
; Markdown is in the list too: Lumina.exe (electron-builder's own association)
; routes a vault note to Vault, and picking Lumina Quick Note for .md is the
; explicit way to have every note open in Quick Note instead.
;
; SHCTX follows `perMachine: false`, i.e. HKCU — no elevation. On Windows 11
; classic verbs live under "Show more options"; reaching the compact top-level
; menu needs an IExplorerCommand handler in a sparse package.
;
; Keep QuickNoteExtsForEach in step with `TEXT_EXTENSIONS` in src/shared/textFiles.ts
; — tests/installerVerbs.test.ts fails the build if they drift.

!define QUICKNOTE_NAME "Lumina Quick Note"
!define QUICKNOTE_EXE "Lumina Quick Note.exe"
!define QUICKNOTE_VERB "LuminaQuickNote"
!define QUICKNOTE_PROGID "Lumina.QuickNote.Document"
!define QUICKNOTE_CAPS "Software\LuminaQuickNote\Capabilities"
!define QUICKNOTE_APPKEY "Software\Classes\Applications\${QUICKNOTE_EXE}"

!macro QuickNoteExtAdd EXT
  ; The verb — key name LuminaQuickNote kept from earlier releases so an upgrade
  ; overwrites it in place instead of leaving a second entry behind.
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\${QUICKNOTE_VERB}" "" "Open with ${QUICKNOTE_NAME}"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\${QUICKNOTE_VERB}" "Icon" "$INSTDIR\resources\quicknote-icon.ico"
  ; %1 is quoted so paths with spaces survive.
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\${QUICKNOTE_VERB}\command" "" '"$INSTDIR\${QUICKNOTE_EXE}" "%1"'
  ; Association candidates. Values only — never the extension's default.
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${QUICKNOTE_PROGID}" ""
  WriteRegStr SHCTX "${QUICKNOTE_APPKEY}\SupportedTypes" ".${EXT}" ""
  WriteRegStr SHCTX "${QUICKNOTE_CAPS}\FileAssociations" ".${EXT}" "${QUICKNOTE_PROGID}"
!macroend

!macro QuickNoteExtRemove EXT
  ; Only our verb's subtree and our value — the .ext and SystemFileAssociations
  ; keys hold other apps' entries, so deleting them whole would vandalise them.
  DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\${QUICKNOTE_VERB}"
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${QUICKNOTE_PROGID}"
  ; SupportedTypes and Capabilities are ours entirely and go in QuickNoteAppRemove.
!macroend

!macro QuickNoteAppAdd
  ; The ProgID every extension above points at: icon and open command.
  WriteRegStr SHCTX "Software\Classes\${QUICKNOTE_PROGID}" "" "Text Document"
  WriteRegStr SHCTX "Software\Classes\${QUICKNOTE_PROGID}\DefaultIcon" "" "$INSTDIR\resources\quicknote-icon.ico,0"
  WriteRegStr SHCTX "Software\Classes\${QUICKNOTE_PROGID}\shell\open\command" "" '"$INSTDIR\${QUICKNOTE_EXE}" "%1"'
  ; The name "Open with" shows — without it Windows falls back to the exe's
  ; FileDescription, which the launcher also sets, but the registry wins.
  WriteRegStr SHCTX "${QUICKNOTE_APPKEY}" "FriendlyAppName" "${QUICKNOTE_NAME}"
  WriteRegStr SHCTX "${QUICKNOTE_APPKEY}\DefaultIcon" "" "$INSTDIR\resources\quicknote-icon.ico,0"
  WriteRegStr SHCTX "${QUICKNOTE_APPKEY}\shell\open\command" "" '"$INSTDIR\${QUICKNOTE_EXE}" "%1"'
  ; Settings > Default apps only lists apps found under RegisteredApplications.
  WriteRegStr SHCTX "${QUICKNOTE_CAPS}" "ApplicationName" "${QUICKNOTE_NAME}"
  WriteRegStr SHCTX "${QUICKNOTE_CAPS}" "ApplicationDescription" "A fast plain-text and code editor from Lumina."
  WriteRegStr SHCTX "${QUICKNOTE_CAPS}" "ApplicationIcon" "$INSTDIR\resources\quicknote-icon.ico,0"
  WriteRegStr SHCTX "Software\RegisteredApplications" "${QUICKNOTE_NAME}" "${QUICKNOTE_CAPS}"
!macroend

!macro QuickNoteAppRemove
  DeleteRegValue SHCTX "Software\RegisteredApplications" "${QUICKNOTE_NAME}"
  DeleteRegKey SHCTX "Software\LuminaQuickNote"
  DeleteRegKey SHCTX "${QUICKNOTE_APPKEY}"
  DeleteRegKey SHCTX "Software\Classes\${QUICKNOTE_PROGID}"
!macroend

; NSIS has no arrays and a compile-time !while loop depends on the bundled
; NSIS version, so the list is spelled out once and both directions walk it by
; passing the per-extension macro in. One list, two consumers, zero parsing.
!macro QuickNoteExtsForEach PER_EXT
  !insertmacro ${PER_EXT} txt
  !insertmacro ${PER_EXT} text
  !insertmacro ${PER_EXT} log
  !insertmacro ${PER_EXT} md
  !insertmacro ${PER_EXT} markdown
  !insertmacro ${PER_EXT} mdx
  !insertmacro ${PER_EXT} rst
  !insertmacro ${PER_EXT} adoc
  !insertmacro ${PER_EXT} tex
  !insertmacro ${PER_EXT} ini
  !insertmacro ${PER_EXT} cfg
  !insertmacro ${PER_EXT} conf
  !insertmacro ${PER_EXT} config
  !insertmacro ${PER_EXT} properties
  !insertmacro ${PER_EXT} env
  !insertmacro ${PER_EXT} toml
  !insertmacro ${PER_EXT} editorconfig
  !insertmacro ${PER_EXT} json
  !insertmacro ${PER_EXT} json5
  !insertmacro ${PER_EXT} jsonc
  !insertmacro ${PER_EXT} yaml
  !insertmacro ${PER_EXT} yml
  !insertmacro ${PER_EXT} xml
  !insertmacro ${PER_EXT} csv
  !insertmacro ${PER_EXT} tsv
  !insertmacro ${PER_EXT} plist
  !insertmacro ${PER_EXT} svg
  !insertmacro ${PER_EXT} html
  !insertmacro ${PER_EXT} htm
  !insertmacro ${PER_EXT} xhtml
  !insertmacro ${PER_EXT} css
  !insertmacro ${PER_EXT} scss
  !insertmacro ${PER_EXT} sass
  !insertmacro ${PER_EXT} less
  !insertmacro ${PER_EXT} vue
  !insertmacro ${PER_EXT} svelte
  !insertmacro ${PER_EXT} js
  !insertmacro ${PER_EXT} mjs
  !insertmacro ${PER_EXT} cjs
  !insertmacro ${PER_EXT} jsx
  !insertmacro ${PER_EXT} ts
  !insertmacro ${PER_EXT} tsx
  !insertmacro ${PER_EXT} mts
  !insertmacro ${PER_EXT} cts
  !insertmacro ${PER_EXT} py
  !insertmacro ${PER_EXT} pyw
  !insertmacro ${PER_EXT} rb
  !insertmacro ${PER_EXT} go
  !insertmacro ${PER_EXT} rs
  !insertmacro ${PER_EXT} lua
  !insertmacro ${PER_EXT} pl
  !insertmacro ${PER_EXT} php
  !insertmacro ${PER_EXT} r
  !insertmacro ${PER_EXT} c
  !insertmacro ${PER_EXT} h
  !insertmacro ${PER_EXT} cpp
  !insertmacro ${PER_EXT} cc
  !insertmacro ${PER_EXT} cxx
  !insertmacro ${PER_EXT} hpp
  !insertmacro ${PER_EXT} hh
  !insertmacro ${PER_EXT} cs
  !insertmacro ${PER_EXT} java
  !insertmacro ${PER_EXT} kt
  !insertmacro ${PER_EXT} kts
  !insertmacro ${PER_EXT} swift
  !insertmacro ${PER_EXT} scala
  !insertmacro ${PER_EXT} dart
  !insertmacro ${PER_EXT} sql
  !insertmacro ${PER_EXT} graphql
  !insertmacro ${PER_EXT} gql
  !insertmacro ${PER_EXT} proto
  !insertmacro ${PER_EXT} sh
  !insertmacro ${PER_EXT} bash
  !insertmacro ${PER_EXT} zsh
  !insertmacro ${PER_EXT} fish
  !insertmacro ${PER_EXT} ps1
  !insertmacro ${PER_EXT} psm1
  !insertmacro ${PER_EXT} bat
  !insertmacro ${PER_EXT} cmd
  !insertmacro ${PER_EXT} gradle
  !insertmacro ${PER_EXT} cmake
  !insertmacro ${PER_EXT} mk
  !insertmacro ${PER_EXT} make
  !insertmacro ${PER_EXT} dockerfile
  !insertmacro ${PER_EXT} gitignore
  !insertmacro ${PER_EXT} gitattributes
  !insertmacro ${PER_EXT} patch
  !insertmacro ${PER_EXT} diff
!macroend

!macro QuickNoteShortcutsRemove
  Delete "$DESKTOP\${QUICKNOTE_NAME}.lnk"
  Delete "$SMPROGRAMS\${QUICKNOTE_NAME}.lnk"
  ; Pre-rename shortcut names, so an upgrade doesn't leave a stale duplicate.
  Delete "$DESKTOP\Quick Note.lnk"
  Delete "$SMPROGRAMS\Quick Note.lnk"
!macroend

!macro customInstall
  !insertmacro QuickNoteShortcutsRemove
  ; Shortcuts target the launcher too, so the Start menu entry is the same app
  ; Windows lists under "Open with". Icon index 0 is the launcher's own icon.
  CreateShortCut "$DESKTOP\${QUICKNOTE_NAME}.lnk" "$INSTDIR\${QUICKNOTE_EXE}" "" "$INSTDIR\resources\quicknote-icon.ico" 0
  CreateShortCut "$SMPROGRAMS\${QUICKNOTE_NAME}.lnk" "$INSTDIR\${QUICKNOTE_EXE}" "" "$INSTDIR\resources\quicknote-icon.ico" 0
  !insertmacro QuickNoteAppAdd
  !insertmacro QuickNoteExtsForEach QuickNoteExtAdd
  ; SHCNE_ASSOCCHANGED: Explorer caches associations and context menus, so
  ; without this the new app and verb only appear after a sign-out.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  !insertmacro QuickNoteShortcutsRemove
  !insertmacro QuickNoteExtsForEach QuickNoteExtRemove
  !insertmacro QuickNoteAppRemove
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

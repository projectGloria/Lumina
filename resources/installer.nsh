; "Open with Quick Note" on the right-click menu of every text document.
;
; Registered under SystemFileAssociations\.<ext>\shell rather than under a
; ProgID: that key is consulted for the extension no matter which app owns it
; by default, so the verb shows up on a .json that VS Code opens just the same
; as on one nobody claims — and it never touches the user's default handler.
;
; `--quicknote` forces the Quick Note branch in `src/main/index.ts`, skipping
; `fileRoute.ts`. That matters for markdown: a double-click on a vault note goes
; to Vault, and this verb is the explicit way to open it in Quick Note instead.
; Multi-select works because Explorer runs the verb once per file and Quick
; Note's single-instance lock turns every launch after the first into a tab.
;
; SHCTX follows `perMachine: false`, i.e. HKCU\Software\Classes — no elevation.
; On Windows 11 classic verbs live under "Show more options"; reaching the
; compact top-level menu needs an IExplorerCommand handler in a sparse package.
;
; Keep QuickNoteVerbsForEach in step with `TEXT_EXTENSIONS` in src/shared/textFiles.ts
; — tests/installerVerbs.test.ts fails the build if they drift.

!define QUICKNOTE_VERB "LuminaQuickNote"

!macro QuickNoteVerbAdd EXT
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\${QUICKNOTE_VERB}" "" "Open with Quick Note"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\${QUICKNOTE_VERB}" "Icon" "$INSTDIR\resources\quicknote-icon.ico"
  ; %1 is quoted so paths with spaces survive; argPathsFrom drops the switch.
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\${QUICKNOTE_VERB}\command" "" '"$INSTDIR\Lumina.exe" --quicknote "%1"'
!macroend

!macro QuickNoteVerbRemove EXT
  ; Only our verb's subtree — the SystemFileAssociations\.ext key may hold other
  ; apps' verbs, so deleting it whole would vandalise them.
  DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\${QUICKNOTE_VERB}"
!macroend

; NSIS has no arrays and a compile-time !while loop depends on the bundled
; NSIS version, so the list is spelled out once and both directions walk it by
; passing the per-extension macro in. One list, two consumers, zero parsing.
!macro QuickNoteVerbsForEach ACTION
  !insertmacro QuickNoteVerb${ACTION} txt
  !insertmacro QuickNoteVerb${ACTION} text
  !insertmacro QuickNoteVerb${ACTION} log
  !insertmacro QuickNoteVerb${ACTION} md
  !insertmacro QuickNoteVerb${ACTION} markdown
  !insertmacro QuickNoteVerb${ACTION} mdx
  !insertmacro QuickNoteVerb${ACTION} rst
  !insertmacro QuickNoteVerb${ACTION} adoc
  !insertmacro QuickNoteVerb${ACTION} tex
  !insertmacro QuickNoteVerb${ACTION} ini
  !insertmacro QuickNoteVerb${ACTION} cfg
  !insertmacro QuickNoteVerb${ACTION} conf
  !insertmacro QuickNoteVerb${ACTION} config
  !insertmacro QuickNoteVerb${ACTION} properties
  !insertmacro QuickNoteVerb${ACTION} env
  !insertmacro QuickNoteVerb${ACTION} toml
  !insertmacro QuickNoteVerb${ACTION} editorconfig
  !insertmacro QuickNoteVerb${ACTION} json
  !insertmacro QuickNoteVerb${ACTION} json5
  !insertmacro QuickNoteVerb${ACTION} jsonc
  !insertmacro QuickNoteVerb${ACTION} yaml
  !insertmacro QuickNoteVerb${ACTION} yml
  !insertmacro QuickNoteVerb${ACTION} xml
  !insertmacro QuickNoteVerb${ACTION} csv
  !insertmacro QuickNoteVerb${ACTION} tsv
  !insertmacro QuickNoteVerb${ACTION} plist
  !insertmacro QuickNoteVerb${ACTION} svg
  !insertmacro QuickNoteVerb${ACTION} html
  !insertmacro QuickNoteVerb${ACTION} htm
  !insertmacro QuickNoteVerb${ACTION} xhtml
  !insertmacro QuickNoteVerb${ACTION} css
  !insertmacro QuickNoteVerb${ACTION} scss
  !insertmacro QuickNoteVerb${ACTION} sass
  !insertmacro QuickNoteVerb${ACTION} less
  !insertmacro QuickNoteVerb${ACTION} vue
  !insertmacro QuickNoteVerb${ACTION} svelte
  !insertmacro QuickNoteVerb${ACTION} js
  !insertmacro QuickNoteVerb${ACTION} mjs
  !insertmacro QuickNoteVerb${ACTION} cjs
  !insertmacro QuickNoteVerb${ACTION} jsx
  !insertmacro QuickNoteVerb${ACTION} ts
  !insertmacro QuickNoteVerb${ACTION} tsx
  !insertmacro QuickNoteVerb${ACTION} mts
  !insertmacro QuickNoteVerb${ACTION} cts
  !insertmacro QuickNoteVerb${ACTION} py
  !insertmacro QuickNoteVerb${ACTION} pyw
  !insertmacro QuickNoteVerb${ACTION} rb
  !insertmacro QuickNoteVerb${ACTION} go
  !insertmacro QuickNoteVerb${ACTION} rs
  !insertmacro QuickNoteVerb${ACTION} lua
  !insertmacro QuickNoteVerb${ACTION} pl
  !insertmacro QuickNoteVerb${ACTION} php
  !insertmacro QuickNoteVerb${ACTION} r
  !insertmacro QuickNoteVerb${ACTION} c
  !insertmacro QuickNoteVerb${ACTION} h
  !insertmacro QuickNoteVerb${ACTION} cpp
  !insertmacro QuickNoteVerb${ACTION} cc
  !insertmacro QuickNoteVerb${ACTION} cxx
  !insertmacro QuickNoteVerb${ACTION} hpp
  !insertmacro QuickNoteVerb${ACTION} hh
  !insertmacro QuickNoteVerb${ACTION} cs
  !insertmacro QuickNoteVerb${ACTION} java
  !insertmacro QuickNoteVerb${ACTION} kt
  !insertmacro QuickNoteVerb${ACTION} kts
  !insertmacro QuickNoteVerb${ACTION} swift
  !insertmacro QuickNoteVerb${ACTION} scala
  !insertmacro QuickNoteVerb${ACTION} dart
  !insertmacro QuickNoteVerb${ACTION} sql
  !insertmacro QuickNoteVerb${ACTION} graphql
  !insertmacro QuickNoteVerb${ACTION} gql
  !insertmacro QuickNoteVerb${ACTION} proto
  !insertmacro QuickNoteVerb${ACTION} sh
  !insertmacro QuickNoteVerb${ACTION} bash
  !insertmacro QuickNoteVerb${ACTION} zsh
  !insertmacro QuickNoteVerb${ACTION} fish
  !insertmacro QuickNoteVerb${ACTION} ps1
  !insertmacro QuickNoteVerb${ACTION} psm1
  !insertmacro QuickNoteVerb${ACTION} bat
  !insertmacro QuickNoteVerb${ACTION} cmd
  !insertmacro QuickNoteVerb${ACTION} gradle
  !insertmacro QuickNoteVerb${ACTION} cmake
  !insertmacro QuickNoteVerb${ACTION} mk
  !insertmacro QuickNoteVerb${ACTION} make
  !insertmacro QuickNoteVerb${ACTION} dockerfile
  !insertmacro QuickNoteVerb${ACTION} gitignore
  !insertmacro QuickNoteVerb${ACTION} gitattributes
  !insertmacro QuickNoteVerb${ACTION} patch
  !insertmacro QuickNoteVerb${ACTION} diff
!macroend

!macro customInstall
  CreateShortCut "$DESKTOP\Quick Note.lnk" "$INSTDIR\Lumina.exe" "--quicknote" "$INSTDIR\resources\quicknote-icon.ico" 0
  CreateShortCut "$SMPROGRAMS\Quick Note.lnk" "$INSTDIR\Lumina.exe" "--quicknote" "$INSTDIR\resources\quicknote-icon.ico" 0
  !insertmacro QuickNoteVerbsForEach Add
  ; SHCNE_ASSOCCHANGED: Explorer caches context menus, so without this the verb
  ; only appears after a sign-out.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Quick Note.lnk"
  Delete "$SMPROGRAMS\Quick Note.lnk"
  !insertmacro QuickNoteVerbsForEach Remove
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

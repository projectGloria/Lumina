!macro customInstall
  CreateShortCut "$DESKTOP\Quick Note.lnk" "$INSTDIR\Lumina.exe" "--quicknote" "$INSTDIR\resources\quicknote-icon.ico" 0
  CreateShortCut "$SMPROGRAMS\Quick Note.lnk" "$INSTDIR\Lumina.exe" "--quicknote" "$INSTDIR\resources\quicknote-icon.ico" 0
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Quick Note.lnk"
  Delete "$SMPROGRAMS\Quick Note.lnk"
!macroend

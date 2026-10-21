; FurZone for Windows: installs for the current user (no admin prompt), so updates can install silently.
; makensis -DVERSION=1.0.1 -DSRC=out installer.nsi   ->  FurZone_Setup.exe
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!ifndef VERSION
  !define VERSION "1.0.1"
!endif
!ifndef SRC
  !define SRC "out"
!endif
!define APP "FurZone"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\FurZone"

Name "${APP}"
OutFile "FurZone_Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\FurZone"
InstallDirRegKey HKCU "Software\FurZone" "InstallDir"
Icon "FurZone.ico"
UninstallIcon "FurZone.ico"
BrandingText "FurZone ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "FurZone"
VIAddVersionKey "FileDescription" "FurZone installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "SNUFFLES-boop"
VIAddVersionKey "LegalCopyright" "SNUFFLES-boop"

!include "MUI2.nsh"
!include "FileFunc.nsh"
!define MUI_ICON "FurZone.ico"
!define MUI_UNICON "FurZone.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\FurZone.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open FurZone"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; Waits (up to 20 s) for a running FurZone to close: it holds a named mutex while open.
!macro WAIT_FOR_FURZONE prefix
Function ${prefix}WaitForFurZone
  StrCpy $R1 0
  loop:
    System::Call 'kernel32::OpenMutexW(i 0x00100000, i 0, w "Local\FurZoneSingleInstance") p .r0'
    IntCmp $0 0 done
    System::Call 'kernel32::CloseHandle(p r0)'
    Sleep 250
    IntOp $R1 $R1 + 1
    IntCmp $R1 80 done
    Goto loop
  done:
FunctionEnd
!macroend
!insertmacro WAIT_FOR_FURZONE ""
!insertmacro WAIT_FOR_FURZONE "un."

Section "FurZone"
  Call WaitForFurZone
  SetOutPath "$INSTDIR"
  ; Replace the whole app folder so no old files linger after an update.
  RMDir /r "$INSTDIR\web"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall FurZone.exe"
  CreateShortcut "$SMPROGRAMS\FurZone.lnk" "$INSTDIR\FurZone.exe"
  IfSilent +2
    CreateShortcut "$DESKTOP\FurZone.lnk" "$INSTDIR\FurZone.exe"
  WriteRegStr HKCU "Software\FurZone" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "FurZone"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "SNUFFLES-boop"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\FurZone.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall FurZone.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" $0
  ; A silent install is an in-app update: open the updated app again.
  IfSilent 0 +2
    Exec '"$INSTDIR\FurZone.exe"'
SectionEnd

Section "Uninstall"
  Call un.WaitForFurZone
  Delete "$SMPROGRAMS\FurZone.lnk"
  Delete "$DESKTOP\FurZone.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\FurZone"
  ; Your login and settings (WebView2 data) are removed too.
  RMDir /r "$LOCALAPPDATA\FurZone"
SectionEnd

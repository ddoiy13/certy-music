; Picked up automatically by electron-builder (buildResources = build/).
; Adds a clickable Privacy Policy link to the first and last wizard pages.
; Keep the URL in sync with src/preload.js (PRIVACY_URL).
; Functions live inside the macros because the uninstaller pass never inserts them,
; and makensis treats unreferenced functions as an error here.
!include nsDialogs.nsh
!include LogicLib.nsh
!define PRIVACY_URL "https://github.com/ddoiy13/certy-music/blob/main/PRIVACY.md"

!macro customWelcomePage
  Function WelcomeAddPrivacyLink
    ; Below the body label (120u 45u, 195u x 130u) so the two do not overlap; the dialog is 193u tall.
    ${NSD_CreateLink} 120u 177u 190u 12u "Privacy Policy"
    Pop $0
    ${NSD_OnClick} $0 OpenPrivacyPolicy
    SetCtlColors $0 0x0000FF transparent
  FunctionEnd

  Function OpenPrivacyPolicy
    ExecShell "open" "${PRIVACY_URL}"
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_SHOW WelcomeAddPrivacyLink
  !insertmacro MUI_PAGE_WELCOME
!macroend

; Same as electron-builder's default finish page (run app after install), plus the link.
!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif
  !define MUI_FINISHPAGE_LINK "Privacy Policy"
  !define MUI_FINISHPAGE_LINK_LOCATION "${PRIVACY_URL}"
  !insertmacro MUI_PAGE_FINISH
!macroend

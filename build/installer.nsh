; ============================================================
; 自定义 NSIS 脚本
; 功能：目录页选择/输入安装路径后，自动在其下追加应用名子目录
;   例如用户选择 D:\MyProgram，输入框会自动显示为 D:\MyProgram\VideoQPTool
; ============================================================

!ifdef allowToChangeInstallationDirectory
!ifndef BUILD_UNINSTALLER
  !include "LogicLib.nsh"
  !include "FileFunc.nsh"

  ; 第一个 MUI 页面就是目录页（安装模式页使用显式 PageCallbacks，不会消费此定义）
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE AutoAppendAppDir

  Function AutoAppendAppDir
    ; 定位目录页路径输入框：NSIS 目录页编辑框控件 ID = 1019
    ; 控件可能直接挂在页面容器上，也可能在嵌套的 #32770 对话框中
    GetDlgItem $0 $HWNDPARENT 1019
    ${If} $0 == 0
      System::Call 'user32::FindWindowEx(i $HWNDPARENT, i 0, t "#32770", t "") i .r1'
      ${If} $1 != 0
        System::Call 'user32::GetDlgItem(i r1, i 1019) i .r0'
      ${EndIf}
    ${EndIf}

    ; 读取当前路径：优先读输入框文本，读不到则用 $INSTDIR
    StrCpy $1 $INSTDIR
    ${If} $0 != 0
      System::Call 'user32::SendMessage(i r0, i 0x000D, i ${NSIS_MAX_STRLEN}, t .r1)'
      ${If} $1 == ""
        StrCpy $1 $INSTDIR
      ${EndIf}
    ${EndIf}

    ${If} $1 != ""
      ; 去掉末尾反斜杠，避免拼接出双斜杠
      StrCpy $2 "$1" 1 -1
      ${If} $2 == "\"
        StrCpy $1 "$1" -1
      ${EndIf}
      ; 判断最后一段是否已经是应用名
      ${GetFileName} "$1" $2
      ${If} $2 != "${APP_FILENAME}"
        ; 追加应用名子目录，写回输入框并停留本页让用户确认
        StrCpy $3 "$1\${APP_FILENAME}"
        StrCpy $INSTDIR $3
        ${If} $0 != 0
          System::Call 'user32::SetWindowText(i r0, t r3)'
        ${EndIf}
        Abort
      ${EndIf}
    ${EndIf}
  FunctionEnd
!endif
!endif

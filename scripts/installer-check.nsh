; GoBuddy NSIS 安装前检查脚本
; 检查 Node.js 是否已安装，未安装则自动下载安装

!macro customInit
  ; 检查 Node.js 是否已安装
  nsExec::ExecToStack 'cmd /c node --version'
  Pop $0
  Pop $1
  ${If} $0 != 0
    ; Node.js 未安装，提示用户并自动安装
    MessageBox MB_YESNO|MB_ICONQUESTION "GoBuddy 需要 Node.js 运行环境，检测到尚未安装。$\n$\n是否自动下载安装 Node.js？$\n（需要网络连接，安装过程约1-2分钟）" IDYES downloadNode IDNO abortInstall

    downloadNode:
      ; 下载 Node.js MSI 安装包
      DetailPrint "正在下载 Node.js ..."
      NSISdl::download "https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi" "$TEMP\node-v22.16.0-x64.msi"
      Pop $0
      ${If} $0 != "success"
        MessageBox MB_OK|MB_ICONSTOP "Node.js 下载失败，请检查网络连接后重试。$\n$\n您也可以手动安装 Node.js: https://nodejs.org"
        Abort
      ${EndIf}

      ; 静默安装 Node.js
      DetailPrint "正在安装 Node.js ..."
      ExecWait 'msiexec /i "$TEMP\node-v22.16.0-x64.msi" /qn /norestart' $0
      ${If} $0 != 0
        MessageBox MB_OK|MB_ICONSTOP "Node.js 安装失败。$\n$\n请手动安装 Node.js: https://nodejs.org"
        Abort
      ${EndIf}

      ; 清理安装包
      Delete "$TEMP\node-v22.16.0-x64.msi"

      ; 刷新环境变量
      System::Call 'kernel32::SendMessageTimeoutA(i 0xFFFF, i 0x1A, i 0, t "Environment", i 0x0002, i 1000, *i 0)'

      DetailPrint "Node.js 安装完成"
      Goto done

    abortInstall:
      MessageBox MB_OK|MB_ICONINFORMATION "GoBuddy 需要 Node.js 才能运行。$\n$\n请先安装 Node.js: https://nodejs.org$\n安装后重新运行此安装程序。"
      Abort

    done:
  ${EndIf}
!macroend

!macro customInstall
  ; 安装完成后检查 lark-cli（首次启动时也会检查，这里做预检查）
  DetailPrint "检查飞书 CLI ..."
  nsExec::ExecToStack 'cmd /c lark-cli --version'
  Pop $0
  ${If} $0 != 0
    DetailPrint "飞书 CLI 未安装，将在首次启动时自动安装"
  ${Else}
    DetailPrint "飞书 CLI 已安装"
  ${EndIf}
!macroend

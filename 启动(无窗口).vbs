' 电气项目管理台 - 静默启动器（不显示命令行窗口）
Option Explicit

Dim fso, sh, appDir, electron, indexPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

appDir   = fso.GetParentFolderName(WScript.ScriptFullName)
electron = appDir & "\node_modules\electron\dist\electron.exe"
indexPath = appDir & "\dist\index.html"

If Not fso.FileExists(electron) Then
  MsgBox "缺少依赖，请先双击 启动.bat 查看初始化步骤。", 48, "电气项目管理台"
  WScript.Quit 1
End If

If Not fso.FileExists(indexPath) Then
  MsgBox "界面未构建，请在项目目录执行 npm run build。", 48, "电气项目管理台"
  WScript.Quit 1
End If

sh.CurrentDirectory = appDir
sh.Run """" & electron & """ """ & appDir & """", 0, False

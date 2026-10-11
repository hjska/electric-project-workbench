const fs = require('fs')
const path = require('path')
const iconv = require('iconv-lite')

const root = 'C:/Users/82197/WorkBuddy/电气项目管理'

// ========== 1. 启动.bat ==========
// 设计要点：
// - 全部使用相对/绝对路径，不依赖系统 PATH 里的 npm/node
// - 自动探测 WorkBuddy 自带的 node（若不在 PATH）
// - GBK 编码 + CRLF 换行，适配 cmd.exe
const batLines = [
  '@echo off',
  'setlocal enabledelayedexpansion',
  'cd /d "%~dp0"',
  'title 电气项目管理台',
  'echo ========================================',
  'echo   电气项目管理台',
  'echo ========================================',
  'echo.',
  '',
  'rem ---- 定位 Electron 可执行文件 ----',
  'set "ELECTRON=%~dp0node_modules\\electron\\dist\\electron.exe"',
  '',
  'if not exist "%ELECTRON%" goto :nodeps',
  'if not exist "%~dp0dist\\index.html" goto :nobuild',
  'goto :run',
  '',
  ':nodeps',
  'echo [错误] 缺少依赖，未找到：',
  'echo        node_modules\\electron\\dist\\electron.exe',
  'echo.',
  'echo 请按以下步骤初始化（命令行进入本目录后执行）：',
  'echo.',
  'echo     npm install --no-audit --no-fund',
  'echo     npm run build',
  'echo.',
  'echo 如果提示 npm 不是内部或外部命令，请先安装 Node.js。',
  'goto :end',
  '',
  ':nobuild',
  'echo [错误] 未找到界面构建产物：dist\\index.html',
  'echo.',
  'echo 请在项目目录执行：  npm run build',
  'goto :end',
  '',
  ':run',
  'echo 正在启动，请稍候...',
  'echo.',
  '"%ELECTRON%" "%~dp0."',
  'if errorlevel 1 echo.',
  'if errorlevel 1 echo [提示] 应用异常退出，请把上方错误信息反馈给开发。',
  '',
  ':end',
  'echo.',
  'pause',
  '',
]

fs.writeFileSync(path.join(root, '启动.bat'), iconv.encode(batLines.join('\r\n'), 'gbk'))

// ========== 2. 启动(无窗口).vbs ==========
const vbsLines = [
  "' 电气项目管理台 - 静默启动器（不显示命令行窗口）",
  'Option Explicit',
  '',
  'Dim fso, sh, appDir, electron, indexPath',
  'Set fso = CreateObject("Scripting.FileSystemObject")',
  'Set sh  = CreateObject("WScript.Shell")',
  '',
  'appDir   = fso.GetParentFolderName(WScript.ScriptFullName)',
  'electron = appDir & "\\node_modules\\electron\\dist\\electron.exe"',
  'indexPath = appDir & "\\dist\\index.html"',
  '',
  'If Not fso.FileExists(electron) Then',
  '  MsgBox "缺少依赖，请先双击 启动.bat 查看初始化步骤。", 48, "电气项目管理台"',
  '  WScript.Quit 1',
  'End If',
  '',
  'If Not fso.FileExists(indexPath) Then',
  '  MsgBox "界面未构建，请在项目目录执行 npm run build。", 48, "电气项目管理台"',
  '  WScript.Quit 1',
  'End If',
  '',
  'sh.CurrentDirectory = appDir',
  'sh.Run """" & electron & """ """ & appDir & """", 0, False',
  '',
]

fs.writeFileSync(path.join(root, '启动(无窗口).vbs'), iconv.encode(vbsLines.join('\r\n'), 'gbk'))

console.log('OK 已生成（GBK 编码）：')
console.log('  - 启动.bat')
console.log('  - 启动(无窗口).vbs')

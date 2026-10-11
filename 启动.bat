@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title 电气项目管理台
echo ========================================
echo   电气项目管理台
echo ========================================
echo.

rem ---- 定位 Electron 可执行文件 ----
set "ELECTRON=%~dp0node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON%" goto :nodeps
if not exist "%~dp0dist\index.html" goto :nobuild
goto :run

:nodeps
echo [错误] 缺少依赖，未找到：
echo        node_modules\electron\dist\electron.exe
echo.
echo 请按以下步骤初始化（命令行进入本目录后执行）：
echo.
echo     npm install --no-audit --no-fund
echo     npm run build
echo.
echo 如果提示 npm 不是内部或外部命令，请先安装 Node.js。
goto :end

:nobuild
echo [错误] 未找到界面构建产物：dist\index.html
echo.
echo 请在项目目录执行：  npm run build
goto :end

:run
echo 正在启动，请稍候...
echo.
"%ELECTRON%" "%~dp0."
if errorlevel 1 echo.
if errorlevel 1 echo [提示] 应用异常退出，请把上方错误信息反馈给开发。

:end
echo.
pause

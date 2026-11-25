@echo off
rem Builds and deploys the portable app to D:\Apps\Markdown BBCode through scripts\package.mjs: the new exe is staged
rem beside the old one, a running copy is closed gracefully (one admin prompt if it runs elevated), swapped and relaunched.
setlocal enableextensions enabledelayedexpansion
cd /d "%~dp0"

set "SKIP_BUILD=0"
set "PKG_ARGS="

:parse_args
if "%~1"=="" goto :args_done
if /i "%~1"=="--skip-build" (
  set "SKIP_BUILD=1"
) else if /i "%~1"=="-SkipBuild" (
  set "SKIP_BUILD=1"
) else (
  set "PKG_ARGS=!PKG_ARGS! %1"
)
shift
goto :parse_args

:args_done
if "%SKIP_BUILD%"=="1" (
  echo Deploying already-built Markdown BBCode portable app...
  node "scripts\package.mjs"!PKG_ARGS!
) else if defined PKG_ARGS (
  echo Building and deploying Markdown BBCode portable app...
  call npx tauri build --no-bundle
  if not errorlevel 1 node "scripts\package.mjs"!PKG_ARGS!
) else (
  echo Building and deploying Markdown BBCode portable app...
  call npm run portable
)
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  echo Portable deployment succeeded.
) else (
  echo Portable deployment failed with exit code %EXIT_CODE%.
)

set "CMDLINE=!cmdcmdline:"=_!"
if /i not "!CMDLINE!"=="!CMDLINE:/c =!" (
  powershell.exe -NoProfile -Command "try { if ([Console]::IsInputRedirected) { exit 1 }; $c = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $PID)).ParentProcessId; $p = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $c)).ParentProcessId; if ((Get-Process -Id $p -ErrorAction Stop).ProcessName -ieq 'explorer') { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 (
    echo.
    pause
  )
)

exit /b %EXIT_CODE%

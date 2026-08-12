@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
set "DRY_RUN=0"
if /I "%~1"=="--dry-run" set "DRY_RUN=1"

echo MLSM Studio - installazione completa Windows
where winget >nul 2>nul || (
  echo ERRORE: Windows Package Manager non disponibile. Installa "App Installer" dal Microsoft Store e riprova.
  exit /b 2
)

call :install OpenJS.NodeJS.LTS node.exe
call :install Python.Python.3.11 py.exe
call :install Rustlang.Rustup rustc.exe
call :install Gyan.FFmpeg ffmpeg.exe
call :install MSYS2.MSYS2 pacman.exe
call :install Microsoft.EdgeWebView2Runtime msedgewebview2.exe
call :install Microsoft.VisualStudio.2022.BuildTools vswhere.exe --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

set "PATH=%ProgramFiles%\nodejs;%USERPROFILE%\.cargo\bin;%LOCALAPPDATA%\Microsoft\WindowsApps;%PATH%"
if exist C:\msys64\ucrt64\bin set "PATH=C:\msys64\ucrt64\bin;%PATH%"
if not exist C:\msys64\ucrt64\bin\rubberband.exe (
  if "%DRY_RUN%"=="1" (echo [dry-run] C:\msys64\usr\bin\bash.exe -lc "pacman -Syu --noconfirm ^&^& pacman -S --noconfirm mingw-w64-ucrt-x86_64-rubberband") else (
    C:\msys64\usr\bin\bash.exe -lc "pacman -Syu --noconfirm && pacman -S --noconfirm mingw-w64-ucrt-x86_64-rubberband" || exit /b 4
  )
)
if "%DRY_RUN%"=="1" (
  echo [dry-run] npm ci
  echo [dry-run] node tools\setup_python_runtime.cjs upscaler
  echo [dry-run] node tools\setup_python_runtime.cjs ai-quantizer
  echo [dry-run] cargo fetch --manifest-path apps\desktop\src-tauri\Cargo.toml
  exit /b 0
)
where node >nul 2>nul || (echo Riavvia questo installer: Node e' stato installato ma il PATH non e' ancora aggiornato.& exit /b 3)
where py >nul 2>nul || (echo Riavvia questo installer: Python e' stato installato ma il PATH non e' ancora aggiornato.& exit /b 3)

call npm ci || exit /b 10
call node tools\setup_python_runtime.cjs upscaler || exit /b 11
call node tools\setup_python_runtime.cjs ai-quantizer || exit /b 12
call cargo fetch --manifest-path apps\desktop\src-tauri\Cargo.toml || exit /b 13

call node tools\verify_installation.cjs
echo MLSM Studio e' pronto. L'installer non ha avviato alcun server.
exit /b %ERRORLEVEL%

:install
set "PACKAGE=%~1"
set "COMMAND=%~2"
where "%COMMAND%" >nul 2>nul && exit /b 0
if "%DRY_RUN%"=="1" (echo [dry-run] winget install --exact --id %PACKAGE% %~3 %~4& exit /b 0)
winget install --exact --id "%PACKAGE%" --silent --accept-package-agreements --accept-source-agreements %~3 %~4 || exit /b 1
exit /b 0

@echo off
setlocal EnableExtensions EnableDelayedExpansion
for %%I in ("%~dp0\..\..") do set "ROOT_DIR=%%~fI"
cd /d "%ROOT_DIR%"
set "DRY_RUN=0"
if /I "%~1"=="--dry-run" set "DRY_RUN=1"

echo MLSM Studio - installazione completa Windows
where winget >nul 2>nul || (
  echo ERRORE: Windows Package Manager non disponibile. Installa "App Installer" dal Microsoft Store e riprova.
  exit /b 2
)

call :install OpenJS.NodeJS.LTS node.exe
if errorlevel 1 exit /b 1
call :install_python_311
if errorlevel 1 exit /b 1
call :install Rustlang.Rustup rustc.exe
if errorlevel 1 exit /b 1
call :install Gyan.FFmpeg ffmpeg.exe
if errorlevel 1 exit /b 1
call :install MSYS2.MSYS2 pacman.exe
if errorlevel 1 exit /b 1
call :install Microsoft.EdgeWebView2Runtime msedgewebview2.exe
if errorlevel 1 exit /b 1
call :install Microsoft.VisualStudio.2022.BuildTools vswhere.exe --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
if errorlevel 1 exit /b 1

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
  echo [dry-run] node tools\setup_python_runtime.cjs song-player
  echo [dry-run] node tools\setup_python_runtime.cjs audio-tts
  echo [dry-run] cargo fetch --manifest-path apps\desktop\src-tauri\Cargo.toml
  exit /b 0
)
where node >nul 2>nul || (echo Riavvia questo installer: Node e' stato installato ma il PATH non e' ancora aggiornato.& exit /b 3)
py -3.11 -c "import sys;raise SystemExit(0 if sys.version_info[:2]==(3,11) else 1)" >nul 2>nul || (echo Riavvia questo installer: Python 3.11 e' stato installato ma non e' ancora disponibile.& exit /b 3)

call npm ci || exit /b 10
call node tools\setup_python_runtime.cjs upscaler || exit /b 11
call node tools\setup_python_runtime.cjs ai-quantizer || exit /b 12
call node tools\setup_python_runtime.cjs song-player || exit /b 13
call node tools\setup_python_runtime.cjs audio-tts || exit /b 14
call cargo fetch --manifest-path apps\desktop\src-tauri\Cargo.toml || exit /b 15

call node tools\verify_installation.cjs
echo MLSM Studio e' pronto. L'installer non ha avviato alcun server.
exit /b %ERRORLEVEL%

:install_python_311
py -3.11 -c "import sys;raise SystemExit(0 if sys.version_info[:2]==(3,11) else 1)" >nul 2>nul && exit /b 0
if "%DRY_RUN%"=="1" (echo [dry-run] winget install --exact --id Python.Python.3.11& exit /b 0)
winget install --exact --id "Python.Python.3.11" --silent --accept-package-agreements --accept-source-agreements || exit /b 1
exit /b 0

:install
set "PACKAGE=%~1"
set "COMMAND=%~2"
where "%COMMAND%" >nul 2>nul && exit /b 0
if "%DRY_RUN%"=="1" (echo [dry-run] winget install --exact --id %PACKAGE% %~3 %~4& exit /b 0)
winget install --exact --id "%PACKAGE%" --silent --accept-package-agreements --accept-source-agreements %~3 %~4 || exit /b 1
exit /b 0

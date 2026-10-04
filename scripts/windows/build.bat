@echo off
rem Crea installer .exe (NSIS) e .msi nativi Windows. Non avvia server locali.
setlocal EnableExtensions
for %%I in ("%~dp0\..\..") do set "ROOT_DIR=%%~fI"
cd /d "%ROOT_DIR%"
set "PATH=%ProgramFiles%\nodejs;%USERPROFILE%\.cargo\bin;%LOCALAPPDATA%\Microsoft\WinGet\Links;C:\msys64\ucrt64\bin;%PATH%"

if /I "%~1"=="--check" goto check
if /I "%~1"=="--dry-run" (
  echo [dry-run] npm exec --workspace @rbs/desktop tauri -- build --bundles nsis,msi
  exit /b 0
)
call :check || exit /b %ERRORLEVEL%
echo Compilazione MLSM Studio per Windows ^(.exe NSIS e .msi^)...
call npm exec --workspace @rbs/desktop tauri -- build --bundles nsis,msi
if errorlevel 1 exit /b %ERRORLEVEL%
echo Installer creati in apps\desktop\src-tauri\target\release\bundle\nsis\ e bundle\msi\
exit /b 0

:check
if not "%OS%"=="Windows_NT" (echo Questo script deve essere eseguito su Windows.& exit /b 2)
where node >nul 2>nul || (echo Node non trovato: esegui prima scripts\windows\install.bat& exit /b 3)
where cargo >nul 2>nul || (echo Cargo non trovato: esegui prima scripts\windows\install.bat& exit /b 3)
node tools\verify_node_dependencies.cjs || (echo Dipendenze npm incomplete: esegui prima scripts\windows\install.bat& exit /b 3)
node tools\verify_brand_assets.cjs || exit /b 4
echo Packaging Windows pronto. Nessuna compilazione avviata.
exit /b 0

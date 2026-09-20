@echo off
setlocal EnableExtensions
for %%I in ("%~dp0\..\..") do set "ROOT_DIR=%%~fI"
cd /d "%ROOT_DIR%"
set "PATH=%ProgramFiles%\nodejs;%USERPROFILE%\.cargo\bin;%LOCALAPPDATA%\Microsoft\WinGet\Links;C:\msys64\ucrt64\bin;%PATH%"

if /I "%~1"=="--check" goto check
where node >nul 2>nul || (echo Node non trovato. Esegui prima scripts\windows\install.bat.& exit /b 2)
call node tools\verify_node_dependencies.cjs || (echo Installazione npm incompleta. Esegui scripts\windows\install.bat.& exit /b 3)
echo Avvio MLSM Studio su http://localhost:1421
echo Per arrestare applicazione e servizi premi Ctrl+C.
call npm run dev --workspace @rbs/desktop -- --port 1421
exit /b %ERRORLEVEL%

:check
where node >nul 2>nul || exit /b 2
where npm >nul 2>nul || exit /b 2
node -e "const [M,m]=process.versions.node.split('.').map(Number);if(M^<22 ^|^| (M===22 ^&^& m^<12))process.exit(1)" || exit /b 2
if not exist package-lock.json exit /b 3
node tools\verify_node_dependencies.cjs || exit /b 3
echo Launcher Windows pronto. Nessun server avviato.
exit /b 0

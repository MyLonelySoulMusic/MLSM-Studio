@echo off
setlocal EnableExtensions
for %%I in ("%~dp0\..\..") do set "ROOT_DIR=%%~fI"
cd /d "%ROOT_DIR%"
if exist C:\msys64\ucrt64\bin set "PATH=C:\msys64\ucrt64\bin;%PATH%"

if /I "%~1"=="--check" goto check
where node >nul 2>nul || (echo Node non trovato. Esegui prima scripts\windows\install.bat.& exit /b 2)
if not exist node_modules (echo Installazione assente. Esegui prima scripts\windows\install.bat.& exit /b 3)
echo Avvio MLSM Studio su http://localhost:1421
echo Per arrestare applicazione e servizi premi Ctrl+C.
call npm run dev --workspace @rbs/desktop -- --port 1421
exit /b %ERRORLEVEL%

:check
where node >nul 2>nul || exit /b 2
where npm >nul 2>nul || exit /b 2
node -e "const [M,m]=process.versions.node.split('.').map(Number);if(M^<22 ^|^| (M===22 ^&^& m^<12))process.exit(1)" || exit /b 2
if not exist package-lock.json exit /b 3
if not exist node_modules exit /b 3
echo Launcher Windows pronto. Nessun server avviato.
exit /b 0

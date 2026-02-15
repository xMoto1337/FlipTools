@echo off
title FlipTools - Command Center
color 0B

:menu
cls
echo.
echo  ============================================================
echo  ^|                                                          ^|
echo  ^|              F L I P T O O L S  -  v0.1.0               ^|
echo  ^|              All-in-One Command Center                   ^|
echo  ^|                                                          ^|
echo  ============================================================
echo.
echo  DEVELOPMENT
echo  -----------
echo  [1] Start Dev Server       - Launches web dev server on localhost:1422
echo                                with hot reload for frontend development
echo.
echo  [2] Start Desktop Dev      - Launches Tauri desktop app in dev mode
echo                                with hot reload and DevTools enabled
echo.
echo  BUILD
echo  -----
echo  [3] Build Desktop          - Compiles frontend for desktop (output: dist/)
echo.
echo  [4] Build Web              - Compiles frontend for web deployment
echo                                (output: dist-web/) ready for Vercel
echo.
echo  [5] Build Installer        - Builds full Windows installer using NSIS
echo                                (output: src-tauri/target/release/bundle/nsis/)
echo.
echo  UTILITIES
echo  ---------
echo  [6] Preview Web Build      - Serves the web build locally to test
echo                                before deploying to Vercel
echo.
echo  [7] Install Dependencies   - Runs npm install to set up all packages
echo.
echo  [8] Type Check             - Runs TypeScript compiler to check for errors
echo.
echo  [0] Exit
echo.
echo  ============================================================
echo.
set /p choice="  Select an option [0-8]: "

if "%choice%"=="1" goto dev
if "%choice%"=="2" goto dev_desktop
if "%choice%"=="3" goto build
if "%choice%"=="4" goto build_web
if "%choice%"=="5" goto build_installer
if "%choice%"=="6" goto preview_web
if "%choice%"=="7" goto install
if "%choice%"=="8" goto typecheck
if "%choice%"=="0" goto exit

echo.
echo  Invalid option. Please try again.
timeout /t 2 >nul
goto menu

:dev
cls
echo.
echo  Starting FlipTools Dev Server (localhost:1422)...
echo  Press Ctrl+C to stop.
echo.
cd /d "%~dp0"
npm run dev
pause
goto menu

:dev_desktop
cls
echo.
echo  Starting FlipTools Desktop App (Tauri Dev Mode)...
echo  Press Ctrl+C to stop.
echo.
cd /d "%~dp0"
npm run tauri dev
pause
goto menu

:build
cls
echo.
echo  Building FlipTools Desktop Frontend...
echo.
cd /d "%~dp0"
npm run build
echo.
echo  Build complete! Output in dist/
pause
goto menu

:build_web
cls
echo.
echo  Building FlipTools for Web Deployment...
echo.
cd /d "%~dp0"
npm run build:web
echo.
echo  Web build complete! Output in dist-web/
pause
goto menu

:build_installer
cls
echo.
echo  Building FlipTools Windows Installer (NSIS)...
echo  This may take a few minutes.
echo.
cd /d "%~dp0"
npm run tauri build
echo.
echo  Installer built! Check src-tauri\target\release\bundle\nsis\
pause
goto menu

:preview_web
cls
echo.
echo  Previewing FlipTools Web Build...
echo  Press Ctrl+C to stop.
echo.
cd /d "%~dp0"
npm run preview:web
pause
goto menu

:install
cls
echo.
echo  Installing FlipTools Dependencies...
echo.
cd /d "%~dp0"
npm install
echo.
echo  Dependencies installed!
pause
goto menu

:typecheck
cls
echo.
echo  Running TypeScript Type Check...
echo.
cd /d "%~dp0"
npx tsc --noEmit
echo.
echo  Type check complete!
pause
goto menu

:exit
exit

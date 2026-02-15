@echo off
setlocal

:: ============================================
:: FlipTools - Push to GitHub for Vercel Deploy
:: ============================================

cd /d "%~dp0"

:: Check if git repo exists
if not exist ".git" (
    echo Initializing git repository...
    git init
    git branch -M main
    echo.
    echo ========================================
    echo  FIRST TIME SETUP:
    echo  1. Go to https://github.com/new
    echo  2. Create a repo named "fliptools"
    echo  3. Do NOT initialize with README
    echo  4. Copy the repo URL and run:
    echo     git remote add origin https://github.com/YOUR_USERNAME/fliptools.git
    echo  5. Then run push.bat again
    echo ========================================
    echo.
    pause
    exit /b 0
)

:: Check if remote exists
git remote get-url origin >nul 2>&1
if errorlevel 1 (
    echo No remote "origin" found.
    echo.
    echo Run: git remote add origin https://github.com/YOUR_USERNAME/fliptools.git
    echo Then run push.bat again.
    echo.
    pause
    exit /b 1
)

:: Get commit message
set /p MSG="Commit message (or press Enter for default): "
if "%MSG%"=="" set MSG=Update FlipTools

:: Stage all files
echo.
echo Staging changes...
git add -A

:: Show what's being committed
echo.
echo Changes to commit:
git status --short
echo.

:: Commit
git commit -m "%MSG%"
if errorlevel 1 (
    echo Nothing to commit or commit failed.
    pause
    exit /b 1
)

:: Push
echo.
echo Pushing to GitHub...
git push -u origin main
if errorlevel 1 (
    echo.
    echo Push failed. If this is your first push, try:
    echo   git push -u origin main --force
    echo.
    pause
    exit /b 1
)

echo.
echo ========================================
echo  Pushed successfully!
echo  Vercel will auto-deploy from GitHub.
echo ========================================
echo.
pause

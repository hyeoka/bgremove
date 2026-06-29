@echo off
setlocal
cd /d "%~dp0"
set PYTHONUTF8=1
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 launcher.py
) else (
  python launcher.py
)
if errorlevel 1 (
  echo.
  echo Failed. Screenshot this window from the top.
)
pause

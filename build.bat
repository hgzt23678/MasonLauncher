@echo off
setlocal

cd /d "%~dp0"
if errorlevel 1 (
echo Failed to cd into project directory.
pause
exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File ".\build-win.ps1" debug %*

set EXITCODE=%ERRORLEVEL%
echo.
echo build-win.ps1 debug exited with code %EXITCODE%
pause
exit /b %EXITCODE%

@echo off
setlocal

cd /d "C:\Users\hgzt23678\Documents\New project"
if errorlevel 1 (
echo Failed to cd into project directory.
pause
exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File ".\build.ps1"

set EXITCODE=%ERRORLEVEL%
echo.
echo build.ps1 exited with code %EXITCODE%
pause
exit /b %EXITCODE%

@echo off
setlocal

cd /d "%~dp0"
if errorlevel 1 (
echo Failed to cd into project directory.
pause
exit /b 1
)

echo Building Mason Launcher (Release / installer)...
powershell -NoProfile -ExecutionPolicy Bypass -File ".\build.ps1" -Configuration Release %*

set EXITCODE=%ERRORLEVEL%
echo.
echo build.ps1 exited with code %EXITCODE%
pause
exit /b %EXITCODE%

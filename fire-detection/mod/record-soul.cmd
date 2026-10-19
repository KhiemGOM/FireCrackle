@echo off
setlocal
cd /d "%~dp0"
if not exist "build\recording-sockets" mkdir "build\recording-sockets"
set "JAVA_TOOL_OPTIONS=%JAVA_TOOL_OPTIONS% -Djdk.net.unixdomain.tmpdir=%CD%\build\recording-sockets"
call gradlew.bat runClient -PfirelabelDebug=false -PfirelabelLegacyLabels=true -PfirelabelOwnership=false --console=plain
if errorlevel 1 pause
endlocal

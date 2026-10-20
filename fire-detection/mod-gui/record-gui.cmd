@echo off
setlocal
cd /d "%~dp0"
set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.10.7-hotspot"
set "PATH=%JAVA_HOME%\bin;%PATH%"
if not exist "build\recording-sockets" mkdir "build\recording-sockets"
set "JAVA_TOOL_OPTIONS=%JAVA_TOOL_OPTIONS% -Djdk.net.unixdomain.tmpdir=%CD%\build\recording-sockets"
call gradlew.bat runClient --console=plain
if errorlevel 1 pause
endlocal

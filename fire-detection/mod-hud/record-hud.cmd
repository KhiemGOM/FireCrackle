@echo off
setlocal
cd /d "%~dp0"
set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-21.0.10.7-hotspot"
set "PATH=%JAVA_HOME%\bin;%PATH%"
call "%~dp0gradlew.bat" runClient --console=plain
if errorlevel 1 pause
endlocal

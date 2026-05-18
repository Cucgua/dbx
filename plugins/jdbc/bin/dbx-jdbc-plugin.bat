@echo off
setlocal

if defined JAVA_HOME (
    if exist "%JAVA_HOME%\bin\java.exe" (
        set "JAVA_BIN=%JAVA_HOME%\bin\java.exe"
        goto :run
    )
)

where java >nul 2>nul
if %errorlevel% equ 0 (
    java -version >nul 2>nul
    if %errorlevel% equ 0 (
        set "JAVA_BIN=java"
        goto :run
    )
)

echo Java runtime not found. Install Java or the optional DBX JDBC runtime. >&2
exit /b 127

:run
"%JAVA_BIN%" -jar "%~dp0..\lib\dbx-jdbc-plugin.jar"

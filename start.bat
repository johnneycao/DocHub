@echo off
rem DocHub - From Requirements to Architecture Design
rem Starts DocHub on Windows with Claude on Microsoft Foundry (the Windows twin of start.command).
rem First run: asks for your Foundry details and saves them in .foundry.env next to this file.
setlocal EnableExtensions
cd /d "%~dp0"
set "CONF=.foundry.env"
set "PORT=8765"
set "PYTHONUTF8=1"
echo DocHub - From Requirements to Architecture Design

rem ---- Python 3.10 or newer ----
set "PY="
py -3 -c "import sys; sys.exit(0 if sys.version_info>=(3,10) else 1)" >nul 2>&1 && set "PY=py -3"
if not defined PY python -c "import sys; sys.exit(0 if sys.version_info>=(3,10) else 1)" >nul 2>&1 && set "PY=python"
if not defined PY (
  echo.
  echo Python 3.10 or newer was not found. Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH", then run this again.
  pause
  exit /b 1
)

where claude >nul 2>&1
if errorlevel 1 (
  echo.
  echo The "claude" command was not found. Install Claude Code first ^(https://code.claude.com^), then run this again.
  pause
  exit /b 1
)

rem ---- Foundry details, asked once ----
if not exist "%CONF%" call :ask

:load
for /f "usebackq tokens=1,* delims==" %%A in ("%CONF%") do set "%%A=%%B"
set "CLAUDE_CODE_USE_FOUNDRY=1"
set "ANTHROPIC_DEFAULT_OPUS_MODEL=%ANTHROPIC_DEFAULT_SONNET_MODEL%"
set "ANTHROPIC_DEFAULT_HAIKU_MODEL=%ANTHROPIC_DEFAULT_SONNET_MODEL%"

rem ---- MarkItDown (Word, PDF, PowerPoint, Excel), optional ----
set "PYTHONPATH=%CD%\.pydeps"
%PY% -c "import markitdown" >nul 2>&1
if errorlevel 1 (
  echo.
  echo MarkItDown, which reads Word, PDF, PowerPoint and Excel files, is not installed.
  set /p "A=Install it now into the tool's own folder? About 1-2 minutes. [Y/n] "
  if /i not "%A%"=="n" %PY% -m pip install --upgrade --target "%CD%\.pydeps" "markitdown[docx,pdf,pptx,xlsx,xls]" || echo Installation failed. You can try again later with the Install MarkItDown button in the tool.
)
set "PYTHONPATH="

echo.
echo Checking the connection to Claude on Foundry...
claude -p "Reply with the single word OK" > "%TEMP%\dochub-claude-check.txt" 2>&1
if errorlevel 1 (
  echo.
  echo Claude did not answer:
  type "%TEMP%\dochub-claude-check.txt"
  echo.
  echo Most likely the resource name, key or deployment name is wrong.
  set /p "A=Enter the details again? [Y/n] "
  if /i not "%A%"=="n" (
    del "%CONF%" >nul 2>&1
    call :ask
    goto load
  )
  pause
  exit /b 1
)
echo Claude answered. Starting the tool.

start "" "http://127.0.0.1:%PORT%"
echo Leave this window open while you use the tool. Close it to stop.
%PY% src\server.py --port %PORT%
pause
exit /b 0

:ask
echo.
echo First-time setup: Claude on Microsoft Foundry
echo ^(Azure portal ^> your Foundry resource ^> Endpoints and keys^)
echo.
set /p "RES=Resource name (just the name, not a URL): "
set "KEY="
for /f "usebackq delims=" %%K in (`powershell -NoProfile -Command "$s = Read-Host 'API key (typing is hidden)' -AsSecureString; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "KEY=%%K"
set "MODEL="
set /p "MODEL=Claude deployment name [claude-sonnet-4-5]: "
if not defined MODEL set "MODEL=claude-sonnet-4-5"
> "%CONF%" echo ANTHROPIC_FOUNDRY_RESOURCE=%RES%
>> "%CONF%" echo ANTHROPIC_FOUNDRY_API_KEY=%KEY%
>> "%CONF%" echo ANTHROPIC_DEFAULT_SONNET_MODEL=%MODEL%
exit /b 0

@echo off
setlocal
cd /d "%~dp0"
set "PORT=8080"
set "HOST=127.0.0.1"
set "AUTH_REQUIRED=true"
set "ENABLE_CLAUDE_WEB_SEARCH=true"
set "CLAUDE_MODEL=claude-opus-4-7,claude-opus-4-6,claude-sonnet-4-6"

set "NODE_EXE=C:\Users\54115\AppData\Local\OpenAI\Codex\bin\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

echo Starting AI Tax Agent on http://127.0.0.1:8080
"%NODE_EXE%" server.js

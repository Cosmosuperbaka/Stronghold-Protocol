@echo off
rem Double-click: stop the game server and its cloudflared tunnel, freeing the port (default 3000; e.g. stop-server.bat --port 3001).
chcp 65001 >nul
cd /d "%~dp0.."
node scripts\free-port.mjs %*
pause

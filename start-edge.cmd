@echo off
cd /d "%~dp0"
echo Patent Intelligence - Local Edge Workbench
echo Keep this window open while using the workbench.
node --use-env-proxy scripts/start-edge.js
if errorlevel 1 pause

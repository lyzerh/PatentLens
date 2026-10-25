@echo off
cd /d "%~dp0"
echo Patent Intelligence Workbench
echo Open http://127.0.0.1:4317/ after the server starts.
echo Keep this window open while using the app.
call npm start
pause

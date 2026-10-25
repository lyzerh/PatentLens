@echo off
cd /d "%~dp0"
set "PATENT_PORT=4321"
echo Starting PatentLens...
npm run start:edge -- --pilot-thermal
if errorlevel 1 pause

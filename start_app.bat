@echo off
title Hydrocarbon Accounting Launcher

echo ==========================================
echo   Hydrocarbon Accounting System Launcher
echo ==========================================
echo.

cd /d "%~dp0"

echo Starting Backend...
start "Hydrocarbon Backend" cmd /k "cd /d backend && call venv\Scripts\activate && uvicorn app.main:app --reload"

timeout /t 3 /nobreak > nul

echo Starting Frontend...
start "Hydrocarbon Frontend" cmd /k "cd /d frontend && npm run dev"

timeout /t 5 /nobreak > nul

echo Opening application in browser...
start http://localhost:5173

echo.
echo ==========================================
echo Backend and Frontend started.
echo Backend:  http://127.0.0.1:8000
echo API Docs: http://127.0.0.1:8000/docs
echo Frontend: http://localhost:5173
echo ==========================================
echo.

pause
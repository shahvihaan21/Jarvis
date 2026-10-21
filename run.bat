@echo off
title Jarvis Command Center
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [1/4] Creating Python environment...
    python -m venv .venv
    if errorlevel 1 (echo Could not create virtual environment.& pause& exit /b 1)
)

echo [2/4] Installing backend dependencies...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (echo Dependency installation failed.& pause& exit /b 1)

echo [3/4] Applying database migrations...
".venv\Scripts\python.exe" backend\manage.py migrate --noinput
if errorlevel 1 (echo Migration failed.& pause& exit /b 1)

echo [4/4] Starting Jarvis at http://127.0.0.1:8000/
start "" powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8000/'"
".venv\Scripts\python.exe" backend\manage.py runserver 127.0.0.1:8000

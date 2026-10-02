@echo off
cd /d "%~dp0"
pnpm --filter desktop tauri dev

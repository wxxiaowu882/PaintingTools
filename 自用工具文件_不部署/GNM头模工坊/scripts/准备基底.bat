@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo 准备 GNM 完整基底…
node scripts\prepare-gnm-assets.mjs
if errorlevel 1 pause
pause

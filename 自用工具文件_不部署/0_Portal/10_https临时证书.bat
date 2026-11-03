@echo off
chcp 65001 >nul
REM 原脚本用 browser-sync --startPath Solid.html，需在仓库根目录启动
cd /d "%~dp0..\.."
call "%~dp0..\https临时证书\一键启动https.cmd" %*

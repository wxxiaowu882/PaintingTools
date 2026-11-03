@echo off
chcp 65001 >nul
start "" "%~dp0..\android-webview-shell"
explorer "%~dp0..\android-webview-shell"

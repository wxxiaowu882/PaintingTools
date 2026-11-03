@echo off
chcp 65001 >nul
REM 剪映前：把手机原片压成「剪辑代理」（小、快、好拖）。勿把输出当正课上架。
REM 用法：把一个或多个视频拖到本 bat 上；或双击后按提示输入路径。
REM 可选：去掉声音（代理更小、剪映里自己配音/现场声另轨时有用）。

setlocal EnableExtensions
cd /d "%~dp0"
if "%~1"=="" (
  set /p INPUT=拖入视频路径后回车: 
) else (
  set "INPUT=%~1"
)
if "%INPUT%"=="" (
  echo 未指定文件
  pause
  exit /b 1
)

echo.
echo === 剪辑代理压片 ===
set "MUTE_FLAG="
set /p MUTE_ANS=去掉声音？(Y=去掉 / 直接回车=保留): 
if /i "%MUTE_ANS%"=="Y" set "MUTE_FLAG=--mute"
if /i "%MUTE_ANS%"=="YES" set "MUTE_FLAG=--mute"
if defined MUTE_FLAG (
  echo 声音：去掉
) else (
  echo 声音：保留
)
echo.

:loop
echo 输入: %INPUT%
if defined MUTE_FLAG (
  node "%~dp0encode-course-sample.mjs" "%INPUT%" --preset edit_proxy %MUTE_FLAG%
) else (
  node "%~dp0encode-course-sample.mjs" "%INPUT%" --preset edit_proxy
)
if errorlevel 1 (
  echo 失败
  pause
  exit /b 1
)
shift
if "%~1"=="" goto done
set "INPUT=%~1"
goto loop

:done
echo.
echo 完成。输出一般在原片同级 _proxy\ 目录。
echo 请用代理片进剪映；剪完导出后请用 Portal「25b_视频压上架档」或本目录「压上架档.bat」。
pause
endlocal

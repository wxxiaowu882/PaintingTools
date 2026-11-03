@echo off
chcp 65001 >nul
REM 剪映导出后：压成正课上架档（默认 land_1080 · ~1080p · ~3.5Mbps）。
REM 竖屏短预告可答 V 改用 vert_preview。
REM 用法：把一个或多个视频拖到本 bat 上；或双击后按提示输入路径。

setlocal EnableExtensions
cd /d "%~dp0"
if "%~1"=="" (
  set /p INPUT=拖入「剪映导出」视频路径后回车: 
) else (
  set "INPUT=%~1"
)
if "%INPUT%"=="" (
  echo 未指定文件
  pause
  exit /b 1
)

echo.
echo === 上架档压片 ===
echo 默认：正课横屏 land_1080（拟合 1920x1080 · ~3.5Mbps）
echo 竖屏短预告请输入 V
set "PRESET=land_1080"
set /p PRESET_ANS=档位？(直接回车=上架横屏 / V=竖屏预告): 
if /i "%PRESET_ANS%"=="V" set "PRESET=vert_preview"
if /i "%PRESET_ANS%"=="VERT" set "PRESET=vert_preview"
echo 使用档位: %PRESET%

set "MUTE_FLAG="
set /p MUTE_ANS=去掉声音？(Y=去掉 / 直接回车=保留，正课一般保留): 
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
  node "%~dp0encode-course-sample.mjs" "%INPUT%" --preset %PRESET% %MUTE_FLAG%
) else (
  node "%~dp0encode-course-sample.mjs" "%INPUT%" --preset %PRESET%
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
echo 完成。输出一般在原片同级 _encoded\ 目录。
echo 确认画幅与体积后，再上传 R2 / 填课表。
pause
endlocal

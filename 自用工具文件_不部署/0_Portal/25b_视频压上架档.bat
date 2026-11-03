@echo off
chcp 65001 >nul
REM Portal：剪映导出后 · 上架档压片（可开关声音 + 档位）
REM 用法：双击按提示；或把一个/多个视频拖到本 bat 上。

setlocal EnableExtensions
set "TOOL=%~dp0..\视频压片"
set "ENC=%TOOL%\encode-course-sample.mjs"
if not exist "%ENC%" (
  echo [错误] 找不到压片脚本: %ENC%
  pause
  exit /b 1
)

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
echo === Portal · 上架档压片 ===
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
  node "%ENC%" "%INPUT%" --preset %PRESET% %MUTE_FLAG%
) else (
  node "%ENC%" "%INPUT%" --preset %PRESET%
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
echo 完成。输出一般在原片同级 _encoded\ 。确认画幅与体积后再上传 R2 / 填课表。
pause
endlocal

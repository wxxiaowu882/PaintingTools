@echo off
title 启动本地HTTPS测试服务器
echo ====================================================
echo   正在尝试通过 Node.js 启动 HTTPS 安全环境...
echo ====================================================
echo.
echo [提示] 启动后请在浏览器访问控制台显示的 https 地址。
echo [提示] 如果浏览器提示“您的连接不是私密连接”，请点击“高级”->“继续前往”。
echo.

:: 使用 npx 自动调用 http-server，开启 SSL 模式
npx http-server -S -C cert.pem -o /Solid.html

if %errorlevel% neq 0 (
    echo.
    echo [错误] 启动失败。请确保电脑已安装 Node.js。
    echo 如果没有证书文件，尝试运行普通 HTTPS 模式...
    npx http-server -S -o /Solid.html
)

pause
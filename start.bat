@echo off
title GoBuddy Server
echo ========================================
echo   GoBuddy - 启动中...
echo ========================================
echo.

cd /d "%~dp0"

:: 检查 node 是否可用
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)

:: 检查依赖
if not exist node_modules (
    echo [提示] 首次运行，正在安装依赖...
    npm install
    echo.
)

:: 启动 server（后台）
echo [1/2] 启动 API 服务 (端口 8081)...
start /b node server.js

:: 等待服务就绪
timeout /t 2 /nobreak >nul

:: 打开浏览器
echo [2/2] 打开浏览器...
start "" "%~dp0index.html"

echo.
echo ========================================
echo   GoBuddy 已启动！
echo   API 服务: http://localhost:8081
echo   关闭此窗口将停止服务
echo ========================================
echo.

:: 保持窗口打开，显示 server 日志
node server.js
pause

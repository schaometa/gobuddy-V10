@echo off
title GoBuddy - 快捷重启
echo ========================================
echo   GoBuddy 快捷重启中...
echo ========================================

cd /d "%~dp0"

:: 杀掉占用 8081 端口的进程
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8081 ^| findstr LISTENING') do (
    echo 终止旧进程 PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)

:: 等待端口释放
timeout /t 1 /nobreak >nul

:: 后台启动服务
echo 启动 API 服务 (端口 8081)...
start /b cmd /c "node server.js"

:: 等待服务就绪
timeout /t 3 /nobreak >nul

:: 打开浏览器
start "" "http://localhost:8081"

echo.
echo ========================================
echo   GoBuddy 已重启！
echo   API 服务: http://localhost:8081
echo   按任意键停止服务并退出
echo ========================================
echo.

:: 等待用户按键，期间服务在后台运行
pause

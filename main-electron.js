// GoBuddy Electron 主进程
const { app, BrowserWindow, shell, session, Menu } = require('electron');
const path = require('path');

const PORT = process.env.PORT || 8081;
let mainWindow = null;
let serverInstance = null;

// 显示加载页面
function showLoadingPage(msg) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'PingFang SC\',sans-serif;background:#F5F6F7;color:#555B61">' +
      '<div style="text-align:center">' +
      '<div style="font-size:28px;margin-bottom:16px;color:#3370FF">GoBuddy</div>' +
      '<div style="font-size:14px;color:#888D92;margin-bottom:24px">' + msg + '</div>' +
      '<div style="width:200px;height:3px;background:#E6E8EA;border-radius:2px;overflow:hidden;margin:0 auto">' +
      '<div style="width:60%;height:100%;background:#3370FF;border-radius:2px;animation:load 1.5s ease-in-out infinite"></div>' +
      '</div>' +
      '<style>@keyframes load{0%{transform:translateX(-100%)}50%{transform:translateX(100%)}100%{transform:translateX(-100%)}}</style>' +
      '</div></body></html>'
    ));
  }
}

// 显示错误页面
function showErrorPage(title, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:Inter,-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'PingFang SC\',sans-serif;background:#F5F6F7;color:#F54A45">' +
      '<div style="text-align:center;max-width:500px;padding:24px">' +
      '<div style="font-size:24px;margin-bottom:12px">' + title + '</div>' +
      '<div style="font-size:14px;color:#555B61;line-height:1.6">' + message + '</div>' +
      '</div></body></html>'
    ));
  }
}

async function createWindow() {
  // 隐藏菜单栏
  Menu.setApplicationMenu(null);

  // 移除飞书响应头限制
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    delete responseHeaders['x-frame-options'];
    delete responseHeaders['X-Frame-Options'];
    if (responseHeaders['content-security-policy']) {
      responseHeaders['content-security-policy'] = responseHeaders['content-security-policy']
        .map(v => v.replace(/frame-src[^;]*(;|$)/g, ''));
    }
    callback({ responseHeaders });
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'GoBuddy - 个人工作助理',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });

  mainWindow.show();
  showLoadingPage('正在检查运行环境...');

  // ===== 自动检测并安装依赖 =====
  try {
    const { ensureDeps } = require('./scripts/ensure-deps');
    const depResult = await ensureDeps((msg) => showLoadingPage(msg));

    if (!depResult.success) {
      showErrorPage('环境检查失败', depResult.errors.join('<br>'));
      return;
    }
  } catch (e) {
    console.error('[GoBuddy] 依赖检查异常:', e.message);
    // 依赖检查脚本加载失败时继续尝试启动
  }

  // ===== 自动清理被占用的端口 =====
  showLoadingPage('正在检查端口...');
  try {
    const { execSync } = require('child_process');
    const checkCmd = process.platform === 'win32'
      ? `netstat -ano | findstr :${PORT} | findstr LISTENING`
      : `lsof -i :${PORT} -t`;
    const output = execSync(checkCmd, { encoding: 'utf-8', windowsHide: true }).trim();
    if (output) {
      const pids = process.platform === 'win32'
        ? [...new Set(output.split('\n').map(l => l.trim().split(/\s+/).pop()).filter(Boolean))]
        : output.split('\n').map(l => l.trim()).filter(Boolean);
      for (const pid of pids) {
        try {
          process.kill(parseInt(pid), 'SIGTERM');
          console.log('[GoBuddy] 已终止占用端口的进程:', pid);
        } catch {}
      }
      // 等待端口释放
      await new Promise(r => setTimeout(r, 1000));
    }
  } catch {}

  // ===== 启动 Express 服务器 =====
  showLoadingPage('正在启动服务...');
  try {
    const { startServer } = require('./server');
    serverInstance = await startServer(PORT);
  } catch (e) {
    showErrorPage('启动失败',
      e.message.includes('EADDRINUSE')
        ? '端口 ' + PORT + ' 仍被占用，请手动关闭占用该端口的程序后重试。'
        : e.message
    );
    return;
  }

  // ===== 加载前端页面 =====
  mainWindow.loadURL(`http://localhost:${PORT}`);

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ===== 生命周期 =====
function stopServer() {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopServer();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  stopServer();
});

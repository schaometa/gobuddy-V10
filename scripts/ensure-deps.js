// GoBuddy 依赖环境自动检测与安装
// 在 Electron 主进程中调用，确保 Node.js 和 lark-cli 可用

const { execSync, exec } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 60000, windowsHide: true, ...opts }).trim();
  } catch {
    return null;
  }
}

function runAsync(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { encoding: 'utf-8', timeout: 300000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}

// 检查 Node.js
function checkNode() {
  const ver = run('node --version');
  return ver ? ver : null;
}

// 检查 npm
function checkNpm() {
  const ver = run('npm --version');
  return ver ? ver : null;
}

// 检查 lark-cli
function checkLark() {
  const ver = run('lark-cli --version');
  return ver ? ver : null;
}

// 下载文件
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (e) => { file.close(); fs.unlinkSync(dest); reject(e); });
  });
}

// 静默安装 Node.js MSI
async function installNode(progressCallback) {
  const ver = 'v22.16.0';
  const arch = os.arch() === 'x64' ? 'x64' : 'x86';
  const url = `https://nodejs.org/dist/${ver}/node-${ver}-${arch}.msi`;
  const msiPath = path.join(os.tmpdir(), `node-${ver}-${arch}.msi`);

  progressCallback('正在下载 Node.js ...');
  await download(url, msiPath);

  progressCallback('正在安装 Node.js ...');
  run(`msiexec /i "${msiPath}" /qn /norestart`, { timeout: 120000 });

  // 清理临时文件
  try { fs.unlinkSync(msiPath); } catch {}

  // 刷新 PATH（msi安装后需要新进程才能生效，这里手动添加）
  const nodePath = arch === 'x64'
    ? 'C:\\Program Files\\nodejs'
    : 'C:\\Program Files (x86)\\nodejs';
  if (!process.env.PATH.includes(nodePath)) {
    process.env.PATH = nodePath + ';' + process.env.PATH;
  }

  return checkNode();
}

// 安装 lark-cli
async function installLark(progressCallback) {
  progressCallback('正在安装飞书 CLI ...');
  const result = await runAsync('npm install -g @larksuite/cli');
  return checkLark();
}

// 主函数：检测并自动安装所有依赖
// 返回 { success, results, errors }
async function ensureDeps(progressCallback = () => {}) {
  const results = {};
  const errors = [];

  // 1. 检查 Node.js
  progressCallback('检查 Node.js ...');
  results.node = checkNode();
  if (!results.node) {
    progressCallback('Node.js 未安装，正在自动安装...');
    results.node = await installNode(progressCallback);
    if (!results.node) {
      errors.push('Node.js 安装失败，请手动安装: https://nodejs.org');
    }
  }

  // 2. 检查 npm
  if (results.node) {
    progressCallback('检查 npm ...');
    results.npm = checkNpm();
    if (!results.npm) {
      errors.push('npm 未找到，通常随 Node.js 一起安装');
    }
  }

  // 3. 检查 lark-cli
  progressCallback('检查飞书 CLI ...');
  results.lark = checkLark();
  if (!results.lark && results.npm) {
    results.lark = await installLark(progressCallback);
    if (!results.lark) {
      errors.push('飞书 CLI 安装失败，请手动执行: npm install -g @larksuite/cli');
    }
  } else if (!results.lark) {
    errors.push('飞书 CLI 未安装且 npm 不可用');
  }

  return {
    success: errors.length === 0,
    results,
    errors
  };
}

module.exports = { ensureDeps, checkNode, checkNpm, checkLark };

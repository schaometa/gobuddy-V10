// GoBuddy Local API Server - 飞书CLI桥接服务
const express = require('express');
const { exec, spawn } = require('child_process');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

// ============ 工作目录和临时目录（延迟初始化） ============
let _workDir = null;
let _tmpDir = null;

function getWorkDir() {
  if (!_workDir) {
    try {
      if (typeof process !== 'undefined' && process.resourcesPath && __dirname.includes('asar')) {
        // 打包后静态文件在 app.asar.unpacked 目录下
        _workDir = __dirname.replace('app.asar', 'app.asar.unpacked');
      } else {
        _workDir = __dirname;
      }
    } catch (e) {
      _workDir = __dirname;
    }
  }
  return _workDir;
}

function getTmpDir() {
  if (!_tmpDir) {
    _tmpDir = path.join(getWorkDir(), '.tmp');
    try { if (!fs.existsSync(_tmpDir)) fs.mkdirSync(_tmpDir, { recursive: true }); } catch {}
  }
  return _tmpDir;
}

// ============ Express 应用 ============
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 静态文件服务（禁止缓存，确保开发时总是加载最新代码）
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  next();
});
const staticFiles = ['index.html', 'style.css', 'main.js', 'icon.png'];
staticFiles.forEach(file => {
  app.get('/' + file, (req, res) => res.sendFile(path.join(getWorkDir(), file)));
});
app.use('/components', express.static(path.join(getWorkDir(), 'components')));
app.use('/services', express.static(path.join(getWorkDir(), 'services')));
app.get('/', (req, res) => res.sendFile(path.join(getWorkDir(), 'index.html')));

// ============ 工具函数 ============

function runLark(cmd, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs, encoding: 'utf-8', cwd: getWorkDir() }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          console.warn(`[runLark] JSON parse failed: ${cmd}\n  stdout: ${stdout.substring(0, 200)}`);
          resolve(stdout);
        }
      }
    });
  });
}

function cleanOldTempFiles() {
  try {
    const tmpDir = getTmpDir();
    const oldFiles = fs.readdirSync(tmpDir);
    oldFiles.forEach(f => {
      const fp = path.join(tmpDir, f);
      try {
        const stat = fs.statSync(fp);
        if (Date.now() - stat.mtimeMs > 3600000) fs.unlinkSync(fp);
      } catch {}
    });
  } catch {}
}

function createTempFile(content, ext = '.md') {
  const tmpDir = getTmpDir();
  const workDir = getWorkDir();
  const tmpFile = path.join(tmpDir, 'gobuddy-' + crypto.randomUUID() + ext);
  fs.writeFileSync(tmpFile, content, 'utf8');
  return path.relative(workDir, tmpFile);
}

function createJsonTempFile(obj) {
  const json = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return createTempFile(json, '.json');
}

function deleteTempFile(relPath) {
  try {
    const absPath = path.resolve(getWorkDir(), relPath);
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  } catch (e) {
    console.error('删除临时文件失败:', e);
  }
}

// cmd.exe 转义：对特殊字符前加 ^
function escapeCmdArg(str) {
  if (!str) return '';
  return String(str).replace(/[|><&^%]/g, '^$&');
}

// 将 JSON 写入临时文件并返回 @file 引用（仅用于 --markdown 等支持 @file 的参数）
function jsonFileArg(obj) {
  const relPath = createJsonTempFile(obj);
  return { arg: `@${relPath}`, cleanup: () => deleteTempFile(relPath) };
}

// 通过临时 .bat 文件执行命令，避免 cmd.exe shell 转义问题
// 适用于需要传递复杂 JSON 参数的场景（--values, --json, --params 等）
function runLarkViaBat(cmd, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const batFile = path.join(getTmpDir(), 'gobuddy-cmd-' + crypto.randomUUID() + '.bat');
    fs.writeFileSync(batFile, '@echo off\r\n' + cmd + '\r\n', 'utf8');
    exec(`"${batFile}"`, { timeout: timeoutMs, encoding: 'utf-8', cwd: getWorkDir() }, (err, stdout, stderr) => {
      try { fs.unlinkSync(batFile); } catch {}
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          console.warn(`[runLarkViaBat] JSON parse failed: ${cmd.substring(0, 100)}\n  stdout: ${stdout.substring(0, 200)}`);
          resolve(stdout);
        }
      }
    });
  });
}

// 将 JSON 转义为 .bat 文件安全格式（双引号前加反斜杠）
function batJsonEscape(obj) {
  const json = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return json.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// 解包 lark-cli 响应：{ ok, data: {...} } → data
function unwrap(result) {
  if (result && typeof result === 'object' && result.data) return result.data;
  return result;
}

// ============ 认证 API ============

app.get('/api/feishu/auth/status', async (req, res) => {
  try {
    const result = await runLark('lark-cli auth status');
    // lark-cli 返回 userName 表示已登录，检查 refreshExpiresAt 是否未过期
    const loggedIn = result && typeof result === 'object' && result.userName
      ? !result.refreshExpiresAt || new Date(result.refreshExpiresAt) > new Date()
      : false;
    res.json({ logged_in: loggedIn, ...result });
  } catch (e) {
    res.json({ logged_in: false, error: e.message });
  }
});

// 飞书退出登录
app.post('/api/feishu/auth/logout', async (req, res) => {
  try {
    await runLark('lark-cli auth logout');
    // 清除 auth 缓存（保留 app 配置，避免重装后需要重新配置）
    const cacheDir = path.join(os.homedir(), '.lark-cli', 'cache');
    try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch {}
    // 清除 config.json 中的用户信息（不删注册表，保留 app secret）
    const configFile = path.join(os.homedir(), '.lark-cli', 'config.json');
    try {
      const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      if (cfg.apps) cfg.apps.forEach(a => { a.users = []; });
      fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2), 'utf8');
    } catch {}
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 触发飞书登录（Device Flow：获取验证URL + 轮询等待授权）
app.post('/api/feishu/auth/login', async (req, res) => {
  try {
    // 检查 lark-cli 是否已配置，未配置则返回 needConfig
    try {
      await runLark('lark-cli auth status');
    } catch (statusErr) {
      if (statusErr.message && statusErr.message.includes('not configured')) {
        return res.json({ success: false, needConfig: true });
      }
    }
    const result = await runLark('lark-cli auth login --recommend --no-wait --json');
    // 用系统浏览器打开验证链接
    if (result && result.verification_url) {
      exec(`start "" "${result.verification_url}"`);
    }
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 配置 lark-cli（后台运行 config init，从 stdout 提取验证 URL）
let configInitProcess = null;
app.post('/api/feishu/config/init', (req, res) => {
  if (configInitProcess) {
    return res.json({ success: true, message: '配置已在进行中' });
  }
  const proc = spawn('lark-cli', ['config', 'init', '--new', '--app-id', 'cli_aa88322d20b75bc6', '--brand', 'feishu', '--lang', 'zh'], { shell: true });
  configInitProcess = proc;

  let output = '';
  let urlSent = false;

  proc.stdout.on('data', (data) => {
    output += data.toString();
    const urlMatch = output.match(/(https:\/\/open\.feishu\.cn\/[^\s]+)/);
    if (urlMatch && !urlSent) {
      urlSent = true;
      res.json({ success: true, verification_url: urlMatch[1] });
    }
  });

  proc.stderr.on('data', (data) => {
    output += data.toString();
    const urlMatch = output.match(/(https:\/\/open\.feishu\.cn\/[^\s]+)/);
    if (urlMatch && !urlSent) {
      urlSent = true;
      res.json({ success: true, verification_url: urlMatch[1] });
    }
  });

  proc.on('close', (code) => {
    configInitProcess = null;
    if (!urlSent) {
      res.status(500).json({ error: '配置失败', code });
    }
  });

  proc.on('error', (err) => {
    configInitProcess = null;
    if (!urlSent) {
      res.status(500).json({ error: err.message });
    }
  });
});

// 轮询飞书登录状态（等待用户在浏览器完成授权）
app.post('/api/feishu/auth/login/poll', async (req, res) => {
  const { deviceCode } = req.body;
  if (!deviceCode) return res.status(400).json({ error: '缺少 deviceCode' });
  try {
    const result = await runLark(`lark-cli auth login --device-code "${deviceCode}" --json`);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(200).json({ success: false, pending: true, error: e.message });
  }
});

// ============ 文档 API ============

app.get('/api/feishu/docx/:token', async (req, res) => {
  try {
    const result = await runLark(`lark-cli docs +fetch --doc ${req.params.token} --format json`);
    const d = unwrap(result);
    res.json({
      ...d,
      token: req.params.token,
      content: d.markdown || d.content || d.text || '',
      title: d.title || '',
      modified_time: d.edit_time || d.modified_time || '',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/feishu/docx/create', async (req, res) => {
  const { title, content, wikiNode, folder } = req.body;
  let tmpFile = null;
  try {
    // lark-cli 要求 --markdown 非空，空内容用空格占位
    const mdContent = (content && content.trim()) || ' ';
    tmpFile = createTempFile(mdContent);
    let cmd = `lark-cli docs +create --title "${escapeCmdArg(title)}" --markdown @${tmpFile}`;
    if (wikiNode) cmd += ` --wiki-node ${wikiNode}`;
    if (folder) cmd += ` --folder-token ${folder}`;
    const result = await runLark(cmd);
    const d = unwrap(result);
    res.json({
      ...d,
      token: d.doc_id || d.token || '',
      doc_token: d.doc_id || d.token || '',
      url: d.doc_url || d.url || '',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    if (tmpFile) deleteTempFile(tmpFile);
  }
});

app.post('/api/feishu/docx/update', async (req, res) => {
  const { token, mode, content, select } = req.body;
  let tmpFile = null;
  try {
    const mdContent = (content && content.trim()) || ' ';
    tmpFile = createTempFile(mdContent);
    let cmd = `lark-cli docs +update --doc ${token} --mode ${mode} --markdown @${tmpFile}`;
    if (select) cmd += ` --selection-with-ellipsis "${escapeCmdArg(select)}"`;
    const result = await runLark(cmd);
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    if (tmpFile) deleteTempFile(tmpFile);
  }
});

// ============ 电子表格 API ============

app.get('/api/feishu/sheet/read', async (req, res) => {
  const { url, range } = req.query;
  try {
    const result = await runLark(`lark-cli sheets +read --url "${url}" --range "${range || 'Sheet1!A1:Z100'}"`);
    const d = unwrap(result);
    // lark-cli 返回 { valueRange: { values: [[...], ...] } }
    const values = d.valueRange?.values || d.values || d || [];
    res.json({ values });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/feishu/sheet/create', async (req, res) => {
  const { title, wikiNode, folder } = req.body;
  try {
    let cmd = `lark-cli sheets +create --title "${escapeCmdArg(title)}"`;
    if (folder) cmd += ` --folder-token ${folder}`;
    const result = await runLark(cmd);
    const d = unwrap(result);
    res.json({
      ...d,
      spreadsheetToken: d.spreadsheet_token || d.spreadsheetToken || '',
      token: d.spreadsheet_token || d.spreadsheetToken || '',
      url: d.url || '',
      title: d.title || title,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/feishu/sheet/write', async (req, res) => {
  const { token, range, values } = req.body;
  try {
    const url = `https://feishu.cn/sheets/${token}`;
    const escapedValues = batJsonEscape(values);
    const result = await runLarkViaBat(`lark-cli sheets +write --url ${url} --range ${range} --values "${escapedValues}"`);
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/feishu/sheet/sheets/:token', async (req, res) => {
  try {
    const result = await runLark(`lark-cli sheets +info --spreadsheet-token ${req.params.token}`);
    const d = unwrap(result);
    // lark-cli 返回 { sheets: { sheets: [...] }, spreadsheet: { spreadsheet: {...} } }
    // 前端期望 result.sheets 为数组
    const sheets = d.sheets?.sheets || d.sheets || [];
    const spreadsheet = d.spreadsheet?.spreadsheet || d.spreadsheet || {};
    res.json({ sheets, spreadsheet });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/feishu/sheet/meta/:token', async (req, res) => {
  try {
    const result = await runLark(`lark-cli sheets +info --spreadsheet-token ${req.params.token}`);
    const d = unwrap(result);
    const sheets = d.sheets?.sheets || d.sheets || [];
    const spreadsheet = d.spreadsheet?.spreadsheet || d.spreadsheet || {};
    res.json({ sheets, spreadsheet });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/feishu/sheet/append', async (req, res) => {
  const { token, sheetRef, values } = req.body;
  try {
    const url = `https://feishu.cn/sheets/${token}`;
    const escapedValues = batJsonEscape(values);
    const result = await runLarkViaBat(`lark-cli sheets +append --url ${url} --range ${sheetRef || 'Sheet1'} --values "${escapedValues}"`);
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/feishu/sheet/add-rows', async (req, res) => {
  const { token, sheetRef, count } = req.body;
  try {
    const result = await runLark(`lark-cli sheets +add-dimension --spreadsheet-token ${token} --sheet-id "${sheetRef || 'Sheet1'}" --dimension ROWS --length ${count || 100}`);
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/feishu/sheet/add-cols', async (req, res) => {
  const { token, sheetRef, count } = req.body;
  try {
    const result = await runLark(`lark-cli sheets +add-dimension --spreadsheet-token ${token} --sheet-id "${sheetRef || 'Sheet1'}" --dimension COLUMNS --length ${count || 10}`);
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/feishu/sheet/replace', async (req, res) => {
  const { token, sheetRef, find, replace, matchCase, wholeCell } = req.body;
  try {
    let cmd = `lark-cli sheets +replace --spreadsheet-token ${token} --sheet-id "${sheetRef || 'Sheet1'}" --find "${escapeCmdArg(find)}" --replacement "${escapeCmdArg(replace)}"`;
    if (matchCase) cmd += ' --match-case';
    if (wholeCell) cmd += ' --match-entire-cell';
    const result = await runLark(cmd);
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/feishu/sheet/clear', async (req, res) => {
  const { token, sheetRef, ranges } = req.body;
  try {
    const range = ranges || (sheetRef || 'Sheet1');
    const result = await runLark(`lark-cli sheets +write --spreadsheet-token ${token} --range "${range}" --values "[]"`);
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ 多维表格 API ============

app.get('/api/feishu/bitable/meta/:token', async (req, res) => {
  try {
    const result = await runLark(`lark-cli base +base-get --base-token ${req.params.token}`);
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/feishu/bitable/fields/:appToken/:tableId', async (req, res) => {
  try {
    const result = await runLark(`lark-cli base +field-list --base-token ${req.params.appToken} --table-id ${req.params.tableId}`);
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/feishu/bitable/records/:appToken/:tableId', async (req, res) => {
  try {
    const result = await runLark(`lark-cli base +record-list --base-token ${req.params.appToken} --table-id ${req.params.tableId} --format json`);
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/feishu/bitable/records/:appToken/:tableId', async (req, res) => {
  const { fields } = req.body;
  try {
    const payload = { fields: Object.keys(fields), rows: [Object.values(fields)] };
    const escapedPayload = batJsonEscape(payload);
    const result = await runLarkViaBat(`lark-cli base +record-batch-create --base-token ${req.params.appToken} --table-id ${req.params.tableId} --json "${escapedPayload}"`);
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ 任务 API ============

app.get('/api/feishu/task', async (req, res) => {
  const { status } = req.query;
  try {
    let cmd = 'lark-cli task +search --format json';
    if (status === 'uncompleted') cmd += ' --completed=false';
    if (status === 'completed') cmd += ' --completed=true';
    const result = await runLark(cmd);
    const d = unwrap(result);
    const items = d.items || d.tasks || [];
    res.json({ tasks: items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/feishu/task/create', async (req, res) => {
  const { summary, description, due, members } = req.body;
  try {
    let cmd = `lark-cli task +create --summary "${escapeCmdArg(summary)}" --format json`;
    if (description) cmd += ` --description "${escapeCmdArg(description)}"`;
    if (due) cmd += ` --due "${due}"`;
    if (members) cmd += ` --assignee ${members.split(',')[0].trim()}`;
    const result = await runLark(cmd);
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/feishu/task/:id/complete', async (req, res) => {
  try {
    const result = await runLark(`lark-cli task +complete --task-id ${req.params.id} --format json`);
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/feishu/task/:id', async (req, res) => {
  try {
    const escapedParams = batJsonEscape({ task_guid: req.params.id });
    const result = await runLarkViaBat(`lark-cli task tasks get --params "${escapedParams}" --format json`);
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ 日历 API ============

app.get('/api/feishu/calendar', async (req, res) => {
  try {
    const result = await runLark('lark-cli calendar calendars list --format json');
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/feishu/calendar/primary', async (req, res) => {
  try {
    const escapedParams = batJsonEscape({ calendar_id: 'primary' });
    const result = await runLarkViaBat(`lark-cli calendar calendars get --params "${escapedParams}" --format json`);
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/feishu/calendar/events', async (req, res) => {
  const { calendarId, startTime, endTime } = req.query;
  try {
    let cmd = `lark-cli calendar +agenda --calendar-id ${calendarId || 'primary'} --format json`;
    if (startTime) cmd += ` --start "${startTime}"`;
    if (endTime) cmd += ` --end "${endTime}"`;
    const result = await runLark(cmd);
    const d = unwrap(result);
    const rawEvents = d.events || d.items || (Array.isArray(d) ? d : []);
    // 转换事件格式：start_time/end_time 从对象 {datetime, timezone} 转为字符串
    const events = rawEvents.map(e => ({
      ...e,
      start_time: typeof e.start_time === 'object' ? e.start_time?.datetime : e.start_time,
      end_time: typeof e.end_time === 'object' ? e.end_time?.datetime : e.end_time,
      startTime: typeof e.start_time === 'object' ? e.start_time?.datetime : (e.start_time || e.startTime),
      endTime: typeof e.end_time === 'object' ? e.end_time?.datetime : (e.end_time || e.endTime),
    }));
    res.json({ events });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/feishu/calendar/events', async (req, res) => {
  const { calendarId, summary, start, end, description, attendeeIds } = req.body;
  try {
    let cmd = `lark-cli calendar +create --calendar-id ${calendarId || 'primary'} --summary "${escapeCmdArg(summary)}" --start "${start}" --end "${end}"`;
    if (description) cmd += ` --description "${escapeCmdArg(description)}"`;
    if (attendeeIds) cmd += ` --attendee-ids "${attendeeIds}"`;
    const result = await runLark(cmd);
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ 知识库 API ============

app.get('/api/feishu/wiki/spaces', async (req, res) => {
  try {
    const result = await runLark('lark-cli wiki spaces list --format json');
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/feishu/wiki/nodes/:spaceId', async (req, res) => {
  const { parent } = req.query;
  try {
    const paramsObj = { space_id: req.params.spaceId };
    if (parent) paramsObj.parent_node_token = parent;
    const escapedParams = batJsonEscape(paramsObj);
    const result = await runLarkViaBat(`lark-cli wiki nodes list --params "${escapedParams}" --format json`);
    res.json(unwrap(result));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ 搜索 API ============

app.get('/api/feishu/search', async (req, res) => {
  const { query, sort, size } = req.query;
  try {
    let cmd = `lark-cli docs +search --query "${escapeCmdArg(query || '')}" --format json`;
    if (size) cmd += ` --page-size ${size}`;
    const result = await runLark(cmd);
    const d = unwrap(result);
    // 转换搜索结果格式：lark-cli 返回 results，前端期望 items
    if (d.results && !d.items) {
      d.items = d.results.map(r => {
        const meta = r.result_meta || {};
        // 去掉 title_highlighted 中的 HTML 高亮标签
        const title = (r.title_highlighted || '').replace(/<\/?[^>]+>/g, '');
        return {
          title,
          token: meta.token || '',
          url: meta.url || '',
          doc_types: meta.doc_types || '',
          edit_user_name: meta.edit_user_name || '',
          update_time: meta.update_time_iso || '',
          summary: (r.summary_highlighted || '').replace(/<\/?[^>]+>/g, ''),
          ...meta
        };
      });
      delete d.results;
    }
    res.json(d);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ AI 对话 API（支持工具调用） ============

// 工具定义：AI 可以调用的 GoBuddy 功能
const AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_feishu_doc',
      description: '创建飞书文档。返回文档链接。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '文档标题' },
          content: { type: 'string', description: '文档内容（Markdown 格式）' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_feishu_sheet',
      description: '创建飞书电子表格。返回表格链接。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '表格标题' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_feishu_docs',
      description: '搜索飞书文档。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_feishu_tasks',
      description: '获取飞书待办任务列表。',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['uncompleted', 'completed'], description: '任务状态' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_feishu_task',
      description: '创建飞书待办任务。',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: '任务标题' },
          description: { type: 'string', description: '任务描述' },
          due: { type: 'string', description: '截止时间（ISO 8601 格式）' }
        },
        required: ['summary']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_calendar_events',
      description: '获取日历日程列表。',
      parameters: {
        type: 'object',
        properties: {
          startTime: { type: 'string', description: '开始时间（ISO 8601）' },
          endTime: { type: 'string', description: '结束时间（ISO 8601）' }
        }
      }
    }
  },
  // ===== 读取类工具 =====
  {
    type: 'function',
    function: {
      name: 'read_feishu_doc',
      description: '读取飞书文档的完整内容（Markdown格式）。',
      parameters: {
        type: 'object',
        properties: {
          token: { type: 'string', description: '文档 token（从 URL 中提取）' }
        },
        required: ['token']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_feishu_sheet',
      description: '读取飞书电子表格的数据。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '表格 URL' },
          range: { type: 'string', description: '读取范围，如 Sheet1!A1:D10' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_sheet_tabs',
      description: '获取飞书表格的工作表列表（sheet tabs）。',
      parameters: {
        type: 'object',
        properties: {
          token: { type: 'string', description: '表格 token' }
        },
        required: ['token']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_dashboard_stats',
      description: '获取 GoBuddy 工作看板的统计数据（日程数、会议纪要数、文档数、表格数、待办数）。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_docs',
      description: '获取最近打开的飞书文档列表。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_tables',
      description: '获取最近打开的飞书表格列表。',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_meeting_notes',
      description: '获取最近的会议纪要列表（搜索飞书文档中的会议纪要）。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词，默认为"会议纪要"' },
          limit: { type: 'number', description: '返回数量，默认 10' }
        }
      }
    }
  },
  // ===== 编辑类工具 =====
  {
    type: 'function',
    function: {
      name: 'update_feishu_doc',
      description: '编辑飞书文档内容。支持覆盖、追加等模式。',
      parameters: {
        type: 'object',
        properties: {
          token: { type: 'string', description: '文档 token' },
          content: { type: 'string', description: '新内容（Markdown 格式）' },
          mode: { type: 'string', enum: ['overwrite', 'append'], description: '编辑模式：overwrite=覆盖，append=追加' }
        },
        required: ['token', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_feishu_sheet',
      description: '写入飞书电子表格数据。',
      parameters: {
        type: 'object',
        properties: {
          token: { type: 'string', description: '表格 token' },
          range: { type: 'string', description: '写入范围，如 Sheet1!A1:B2' },
          values: { type: 'array', description: '二维数组，如 [["A","B"],["1","2"]]' }
        },
        required: ['token', 'range', 'values']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'complete_feishu_task',
      description: '完成一个飞书待办任务。',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务 ID (guid)' }
        },
        required: ['taskId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_calendar_event',
      description: '创建一个日历日程。',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: '日程标题' },
          start: { type: 'string', description: '开始时间（ISO 8601）' },
          end: { type: 'string', description: '结束时间（ISO 8601）' },
          description: { type: 'string', description: '日程描述' }
        },
        required: ['summary', 'start', 'end']
      }
    }
  }
];

// 执行工具调用
async function executeToolCall(toolName, args) {
  const baseUrl = 'http://127.0.0.1:8081';
  try {
    switch (toolName) {
      case 'create_feishu_doc': {
        const r = await fetch(`${baseUrl}/api/feishu/docx/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: args.title, content: args.content || '' })
        });
        return await r.json();
      }
      case 'create_feishu_sheet': {
        const r = await fetch(`${baseUrl}/api/feishu/sheet/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: args.title })
        });
        return await r.json();
      }
      case 'search_feishu_docs': {
        const r = await fetch(`${baseUrl}/api/feishu/search?query=${encodeURIComponent(args.query)}&size=5`);
        return await r.json();
      }
      case 'get_feishu_tasks': {
        const status = args.status || 'uncompleted';
        const r = await fetch(`${baseUrl}/api/feishu/task?status=${status}`);
        return await r.json();
      }
      case 'create_feishu_task': {
        const r = await fetch(`${baseUrl}/api/feishu/task/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: args.summary, description: args.description, due: args.due })
        });
        return await r.json();
      }
      case 'get_calendar_events': {
        let url = `${baseUrl}/api/feishu/calendar/events`;
        const params = [];
        if (args.startTime) params.push(`startTime=${encodeURIComponent(args.startTime)}`);
        if (args.endTime) params.push(`endTime=${encodeURIComponent(args.endTime)}`);
        if (params.length) url += '?' + params.join('&');
        const r = await fetch(url);
        return await r.json();
      }
      // ===== 读取类工具 =====
      case 'read_feishu_doc': {
        const r = await fetch(`${baseUrl}/api/feishu/docx/${args.token}`);
        return await r.json();
      }
      case 'read_feishu_sheet': {
        const url = encodeURIComponent(args.url);
        const range = encodeURIComponent(args.range || 'Sheet1!A1:Z100');
        const r = await fetch(`${baseUrl}/api/feishu/sheet/read?url=${url}&range=${range}`);
        return await r.json();
      }
      case 'get_sheet_tabs': {
        const r = await fetch(`${baseUrl}/api/feishu/sheet/sheets/${args.token}`);
        return await r.json();
      }
      case 'get_dashboard_stats': {
        // 读取 localStorage 中的统计数据
        const stats = {};
        for (const tab of ['today', 'week', 'month']) {
          try {
            const raw = require('fs').readFileSync(
              require('path').join(getTmpDir(), '..', '.gobuddy-stats-' + tab + '.json'), 'utf8'
            );
            stats[tab] = JSON.parse(raw);
          } catch {}
        }
        // 如果没有缓存文件，直接从 API 获取
        const [taskRes, eventRes] = await Promise.all([
          fetch(`${baseUrl}/api/feishu/task?status=uncompleted`).then(r => r.json()).catch(() => ({ tasks: [] })),
          fetch(`${baseUrl}/api/feishu/calendar/events`).then(r => r.json()).catch(() => ({ events: [] }))
        ]);
        return {
          tasks: (taskRes.tasks || []).length,
          events: (eventRes.events || []).length,
          message: `当前有 ${(taskRes.tasks || []).length} 个待办任务，${(eventRes.events || []).length} 个日程`
        };
      }
      case 'get_recent_docs': {
        const r = await fetch(`${baseUrl}/api/feishu/search?query=文档&size=10`);
        const data = await r.json();
        return { docs: (data.items || []).map(d => ({ title: d.title, token: d.token, url: d.url })) };
      }
      case 'get_recent_tables': {
        const r = await fetch(`${baseUrl}/api/feishu/search?query=表格&size=10`);
        const data = await r.json();
        return { tables: (data.items || []).map(d => ({ title: d.title, token: d.token, url: d.url })) };
      }
      case 'get_meeting_notes': {
        const query = args.query || '会议纪要';
        const limit = args.limit || 10;
        const r = await fetch(`${baseUrl}/api/feishu/search?query=${encodeURIComponent(query)}&size=${limit}`);
        const data = await r.json();
        const items = (data.items || []).filter(d => /^(会议纪要|智能纪要)/.test(d.title || ''));
        // 拉取前几篇的摘要
        const notes = [];
        for (const item of items.slice(0, 5)) {
          try {
            const docR = await fetch(`${baseUrl}/api/feishu/docx/${item.token}`);
            const docData = await docR.json();
            const content = docData.content || docData.markdown || '';
            const m = content.match(/会议目的[：:]\s*([\s\S]*?)(?=\n\*{2}|\n#|\n\n|$)/);
            notes.push({ title: item.title, token: item.token, summary: m ? m[1].trim().substring(0, 200) : '' });
          } catch {
            notes.push({ title: item.title, token: item.token, summary: '' });
          }
        }
        return { notes, total: items.length };
      }
      // ===== 编辑类工具 =====
      case 'update_feishu_doc': {
        const r = await fetch(`${baseUrl}/api/feishu/docx/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: args.token, content: args.content, mode: args.mode || 'append' })
        });
        return await r.json();
      }
      case 'write_feishu_sheet': {
        const r = await fetch(`${baseUrl}/api/feishu/sheet/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: args.token, range: args.range, values: args.values })
        });
        return await r.json();
      }
      case 'complete_feishu_task': {
        const r = await fetch(`${baseUrl}/api/feishu/task/${args.taskId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        return await r.json();
      }
      case 'create_calendar_event': {
        const r = await fetch(`${baseUrl}/api/feishu/calendar/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary: args.summary, start: args.start, end: args.end, description: args.description })
        });
        return await r.json();
      }
      default:
        return { error: `未知工具: ${toolName}` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

// 系统提示词回退方案：让任何模型都能调用工具
const TOOL_SYSTEM_PROMPT = `你是 GoBuddy 智能工作助手。你拥有强大的飞书操作能力，必须积极主动地帮助用户。

## 核心行为准则

1. **主动执行**：用户提到任何飞书操作时，立即调用工具执行，绝不说"我无法做到"
2. **展示结果**：每次工具执行后，必须将结果以清晰的格式展示给用户（列表、摘要、关键信息）
3. **主动验证**：创建/编辑操作完成后，主动读取验证结果是否成功
4. **链式操作**：如果用户的请求需要多步操作，依次执行，不要停在第一步
5. **智能预判**：理解用户意图，主动提供下一步建议

## 工具选择规则（必须严格遵守）

用户说"会议纪要" → 用 get_meeting_notes，不要用 get_feishu_tasks
用户说"待办"或"任务" → 用 get_feishu_tasks
用户说"日程"或"日历" → 用 get_calendar_events
用户说"创建任务" → 用 create_feishu_task
用户说"读取文档" → 用 read_feishu_doc（需要文档 token）
用户说"读取表格" → 用 read_feishu_sheet（需要表格 URL）
用户说"搜索" → 用 search_feishu_docs
用户说"看板"或"统计" → 用 get_dashboard_stats

## 工具执行结果展示规则（极其重要）

- 读取文档后：必须展示文档的标题、摘要或关键内容，不能只说"已读取"
- 读取表格后：必须展示表格数据的行列内容
- 创建任务后：必须展示任务标题、链接，并主动调用 get_feishu_tasks 验证
- 搜索结果后：必须列出搜索到的文档标题和摘要
- 获取日程后：必须列出日程的时间、标题
- 获取会议纪要后：必须列出会议标题、会议目的摘要

## 可用工具

【创建类】
- create_feishu_doc({"title":"标题","content":"Markdown内容"}) - 创建文档
- create_feishu_sheet({"title":"标题"}) - 创建表格
- create_feishu_task({"summary":"任务标题","description":"描述","due":"ISO时间"}) - 创建任务
- create_calendar_event({"summary":"标题","start":"ISO时间","end":"ISO时间","description":"描述"}) - 创建日程

【读取类】
- read_feishu_doc({"token":"文档token"}) - 读取文档全文
- read_feishu_sheet({"url":"表格URL","range":"Sheet1!A1:D10"}) - 读取表格
- get_sheet_tabs({"token":"表格token"}) - 获取工作表列表
- search_feishu_docs({"query":"关键词"}) - 搜索文档
- get_feishu_tasks({"status":"uncompleted"}) - 获取待办任务
- get_calendar_events({"startTime":"ISO","endTime":"ISO"}) - 获取日程
- get_dashboard_stats({}) - 获取看板统计
- get_recent_docs({}) - 最近文档
- get_recent_tables({}) - 最近表格
- get_meeting_notes({"query":"会议纪要","limit":10}) - 会议纪要

【编辑类】
- update_feishu_doc({"token":"文档token","content":"新内容","mode":"append"}) - 编辑文档
- write_feishu_sheet({"token":"表格token","range":"Sheet1!A1","values":[["数据"]]}) - 写入表格
- complete_feishu_task({"taskId":"任务guid"}) - 完成任务

## 示例对话

用户：帮我读一下会议纪要
你：好的，我来读取会议纪要。
[[TOOL_CALL:get_meeting_notes({})]]
（收到结果后，列出每篇会议纪要的标题和会议目的摘要）

用户：帮我创建一个飞书文档
你：好的，马上创建。
[[TOOL_CALL:create_feishu_doc({"title":"新文档"})]]
（收到结果后，展示文档链接，并确认创建成功）

用户：帮我创建一个任务叫"完成报告"
你：好的，我来创建任务。
[[TOOL_CALL:create_feishu_task({"summary":"完成报告"})]]
（收到结果后，展示任务链接，然后主动调用 get_feishu_tasks 验证任务已创建）

用户：告诉我读取的结果
（直接用自然语言展示之前读取的内容，包括文档全文或表格数据）

用户：总结文档的内容，告诉我
（调用 read_feishu_doc 读取，然后用自然语言总结关键内容）

用户：检查一下飞书任务
[[TOOL_CALL:get_feishu_tasks({"status":"uncompleted"})]]
（列出所有待办任务的标题、状态、截止日期）

用户：帮我创建一个明天下午3点的会议
[[TOOL_CALL:create_calendar_event({"summary":"会议","start":"2026-05-16T15:00:00+08:00","end":"2026-05-16T16:00:00+08:00"})]]

## 极其重要的回复规则

当工具执行结果返回后，你必须：
1. 直接告诉用户操作结果（成功/失败、具体数据）
2. 绝对不能自我介绍、不能列出功能清单、不能说"有什么可以帮你的"
3. 绝对不能忽略工具结果，必须基于结果回答

正确示例：
- 创建任务后回复："任务已创建成功！标题：xxx，链接：xxx"
- 读取文档后回复："文档内容如下：xxx（展示内容摘要）"
- 获取任务后回复："你有以下待办任务：1. xxx 2. xxx"

错误示例（绝对不能这样做）：
- 创建任务后回复："你好！我是GoBuddy，我可以帮你做以下事情..."（这是错误的！）
- 忽略工具结果，输出一段自我介绍（这是错误的！）

## 其他规则
- 一次只输出一个工具指令
- 工具指令前后用自然语言说明你在做什么
- 读取操作直接执行，不需要确认
- 创建任务后，主动调用 get_feishu_tasks 验证
- 如果工具调用失败，告诉用户失败原因
- "会议纪要"≠"任务"，会议纪要用 get_meeting_notes，任务用 get_feishu_tasks
- 如果用户说"帮我创建一个飞书任务"，直接调用 create_feishu_task`;

// 调用 LLM（带工具支持 + 错误重试）
async function callLLM(endpoint, apiKey, model, messages, tools) {
  const body = { model, messages, temperature: 0.7 };
  if (tools && tools.length > 0) body.tools = tools;

  try {
    const llmRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      // 如果是 tools 参数导致的错误，去掉 tools 重试
      if (tools && tools.length > 0 && (llmRes.status === 400 || llmRes.status === 422)) {
        console.log('[AI Chat] tools 不支持，去掉 tools 重试');
        delete body.tools;
        const retryRes = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(body)
        });
        if (!retryRes.ok) throw new Error(`LLM API error ${retryRes.status}`);
        const retryData = await retryRes.json();
        return retryData.choices?.[0]?.message;
      }
      throw new Error(`LLM API error ${llmRes.status}: ${errText}`);
    }

    const data = await llmRes.json();
    return data.choices?.[0]?.message;
  } catch (e) {
    // 网络错误等，去掉 tools 重试一次
    if (tools && tools.length > 0 && body.tools) {
      console.log('[AI Chat] 调用失败，去掉 tools 重试:', e.message);
      delete body.tools;
      const retryRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });
      if (!retryRes.ok) throw new Error(`LLM API error ${retryRes.status}`);
      const retryData = await retryRes.json();
      return retryData.choices?.[0]?.message;
    }
    throw e;
  }
}

// 解析文本中的 [[TOOL_CALL:...]] 标记
function parseToolCallsFromText(text) {
  const regex = /\[\[TOOL_CALL:(\w+)\((\{.*?\})\)\]\]/gs;
  const calls = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1];
    let args = {};
    try { args = JSON.parse(match[2]); } catch {}
    calls.push({ id: 'tool_' + crypto.randomUUID().substring(0, 8), name, args });
  }
  return calls;
}

// SSE 流式调用 LLM（用于最终文本回复）
async function streamLLMResponse(endpoint, apiKey, model, messages, res) {
  const llmRes = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, messages, temperature: 0.7, stream: true })
  });

  if (!llmRes.ok) {
    const errText = await llmRes.text();
    res.write(`data: ${JSON.stringify({ type: 'error', content: errText })}\n\n`);
    return;
  }

  const reader = llmRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          res.write(`data: ${JSON.stringify({ type: 'text', content })}\n\n`);
        }
      } catch {}
    }
  }
}

// AI 对话端点（带工具调用循环）
app.post('/api/ai/chat', async (req, res) => {
  const { messages, baseURL, apiKey, model } = req.body;
  if (!baseURL || !apiKey || !model) {
    return res.status(400).json({ error: '缺少 baseURL / apiKey / model 参数' });
  }

  const endpoint = baseURL.replace(/\/$/, '') + '/chat/completions';

  // 设置 SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    // 关键词预处理：根据用户输入预判工具选择
    const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
    let toolHint = '';
    if (/会议纪要|智能纪要|会议目的/.test(lastUserMsg)) {
      toolHint = '\n\n【系统提示】用户提到了"会议纪要"，请使用 get_meeting_notes 工具，不要使用其他工具。';
    } else if (/创建.*任务|新建.*任务|添加.*任务|任务.*创建/.test(lastUserMsg)) {
      toolHint = '\n\n【系统提示】用户要创建任务，请使用 create_feishu_task 工具，从用户的话中提取任务标题作为 summary 参数。';
    } else if (/待办|任务列表|查看.*任务/.test(lastUserMsg)) {
      toolHint = '\n\n【系统提示】用户要查看任务，请使用 get_feishu_tasks 工具。';
    } else if (/日程|日历|会议安排/.test(lastUserMsg)) {
      toolHint = '\n\n【系统提示】用户要查看日程，请使用 get_calendar_events 工具。';
    } else if (/看板|统计|概览/.test(lastUserMsg)) {
      toolHint = '\n\n【系统提示】用户要查看看板统计，请使用 get_dashboard_stats 工具。';
    } else if (/搜索|查找|找文档/.test(lastUserMsg)) {
      toolHint = '\n\n【系统提示】用户要搜索文档，请使用 search_feishu_docs 工具。';
    } else if (/读取|查看|打开.*文档/.test(lastUserMsg)) {
      toolHint = '\n\n【系统提示】用户要读取文档，请使用 read_feishu_doc 工具（需要文档 token）。';
    } else if (/读取|查看|打开.*表格/.test(lastUserMsg)) {
      toolHint = '\n\n【系统提示】用户要读取表格，请使用 read_feishu_sheet 工具（需要表格 URL）。';
    }

    // 注入系统提示词（工具描述 + 回退格式），确保任何模型都能调用工具
    let currentMessages = [];
    const hasSystem = messages.length > 0 && messages[0].role === 'system';
    if (hasSystem) {
      currentMessages.push({ role: 'system', content: messages[0].content + '\n\n' + TOOL_SYSTEM_PROMPT + toolHint });
      currentMessages.push(...messages.slice(1));
    } else {
      currentMessages.push({ role: 'system', content: TOOL_SYSTEM_PROMPT + toolHint });
      currentMessages.push(...messages);
    }

    // 工具调用循环（最多 5 轮）
    for (let round = 0; round < 5; round++) {
      const reply = await callLLM(endpoint, apiKey, model, currentMessages, AI_TOOLS);

      // 检查原生 tool_calls
      if (reply.tool_calls && reply.tool_calls.length > 0) {
        currentMessages.push(reply);
        for (const tc of reply.tool_calls) {
          const fn = tc.function;
          let args = {};
          try { args = JSON.parse(fn.arguments || '{}'); } catch {}
          res.write(`data: ${JSON.stringify({ type: 'tool_call', id: tc.id, name: fn.name, args })}\n\n`);
          const result = await executeToolCall(fn.name, args);
          res.write(`data: ${JSON.stringify({ type: 'tool_result', id: tc.id, name: fn.name, result })}\n\n`);
          currentMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result).substring(0, 4000)
          });
        }
        continue; // 继续下一轮
      }

      // 没有原生 tool_calls → 检查文本中的 [[TOOL_CALL:...]] 标记
      const textContent = reply.content || '';
      const textToolCalls = parseToolCallsFromText(textContent);

      if (textToolCalls.length > 0) {
        // 有文本工具调用 → 执行
        // 先输出工具调用前的文本
        const beforeTool = textContent.split('[[TOOL_CALL:')[0].trim();
        if (beforeTool) {
          res.write(`data: ${JSON.stringify({ type: 'text', content: beforeTool })}\n\n`);
        }

        for (const tc of textToolCalls) {
          res.write(`data: ${JSON.stringify({ type: 'tool_call', id: tc.id, name: tc.name, args: tc.args })}\n\n`);
          const result = await executeToolCall(tc.name, tc.args);
          res.write(`data: ${JSON.stringify({ type: 'tool_result', id: tc.id, name: tc.name, result })}\n\n`);
          // 将工具结果追加到消息上下文
          currentMessages.push({ role: 'assistant', content: textContent });
          currentMessages.push({
            role: 'user',
            content: `【工具结果】${tc.name} 执行完成，结果：${JSON.stringify(result).substring(0, 2000)}\n\n请根据工具结果继续回答用户的问题。`
          });
        }
        continue; // 继续下一轮让模型根据结果回复
      }

      // 没有任何工具调用 → 流式输出最终文本
      currentMessages.push(reply);
      await streamLLMResponse(endpoint, apiKey, model, currentMessages, res);
      break;
    }

    res.write('data: [DONE]\n\n');
  } catch (e) {
    console.error('[AI Chat] error:', e.message);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', content: e.message })}\n\n`);
      res.write('data: [DONE]\n\n');
    }
  }

  res.end();
});

// ============ 启动服务 ============

const PORT = process.env.PORT || 8081;

function startServer(port) {
  return new Promise((resolve, reject) => {
    // 启动时清理旧临时文件
    cleanOldTempFiles();
    const server = app.listen(port || PORT, () => {
      console.log(`GoBuddy Feishu API Server running on http://localhost:${port || PORT}`);
      console.log('确保已安装并登录 lark-cli: npm install -g @larksuite/cli');
      resolve(server);
    });
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        reject(new Error(`端口 ${port || PORT} 已被占用`));
      } else {
        reject(e);
      }
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };

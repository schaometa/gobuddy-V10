// GoBuddy Local API Server - 飞书CLI桥接服务
const express = require('express');
const { exec } = require('child_process');
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

// 静态文件服务
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
    res.json({ logged_in: true, ...result });
  } catch (e) {
    res.json({ logged_in: false, error: e.message });
  }
});

app.post('/api/feishu/auth/login', async (req, res) => {
  try {
    const result = await runLark('lark-cli auth login --recommend', 120000);
    res.json({ success: true, message: '飞书登录成功', ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    let cmd = 'lark-cli task +get-my-tasks --format json';
    if (status === 'uncompleted') cmd += ' --complete=false';
    if (status === 'completed') cmd += ' --complete=true';
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
    const events = d.events || d.items || (Array.isArray(d) ? d : []);
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
    // 前端期望 items 字段，lark-cli 返回 results
    if (d.results && !d.items) d.items = d.results;
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
      default:
        return { error: `未知工具: ${toolName}` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

// 系统提示词回退方案：让任何模型都能调用工具
const TOOL_SYSTEM_PROMPT = `你是 GoBuddy 智能工作助手，你拥有以下能力，可以直接执行用户请求的操作：

可用能力清单：
1. create_feishu_doc - 创建飞书文档
2. create_feishu_sheet - 创建飞书电子表格
3. search_feishu_docs - 搜索飞书文档
4. get_feishu_tasks - 获取飞书待办任务
5. create_feishu_task - 创建飞书待办任务
6. get_calendar_events - 获取日历日程

当用户请求执行上述操作时，你必须立即执行，不要拒绝或说"我无法做到"。你就是 GoBuddy，这些就是你的内置能力。

执行方式：在回复中输出以下格式的指令（一个指令占一行）：
[[TOOL_CALL:能力名({"参数":"值"})]]

示例对话：
用户：帮我创建一个飞书文档
你：好的，我来帮你创建飞书文档。
[[TOOL_CALL:create_feishu_doc({"title":"新文档"})]]

用户：帮我建一个表格
你：好的，马上创建。
[[TOOL_CALL:create_feishu_sheet({"title":"新表格"})]]

用户：查看我的待办
你：好的，我来查看你的待办任务。
[[TOOL_CALL:get_feishu_tasks({"status":"uncompleted"})]]

用户：创建一个任务叫"完成报告"
你：好的，我来创建这个任务。
[[TOOL_CALL:create_feishu_task({"summary":"完成报告"})]]

用户：搜索一下会议纪要
你：好的，我来搜索。
[[TOOL_CALL:search_feishu_docs({"query":"会议纪要"})]]

注意：
- 一次只输出一个工具指令
- 工具指令前后可以用自然语言说明你在做什么
- 工具执行结果会以【工具结果】形式返回，根据结果继续回答
- 不需要工具时直接用自然语言回答`;

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
    // 注入系统提示词（工具描述 + 回退格式），确保任何模型都能调用工具
    let currentMessages = [];
    const hasSystem = messages.length > 0 && messages[0].role === 'system';
    if (hasSystem) {
      currentMessages.push({ role: 'system', content: messages[0].content + '\n\n' + TOOL_SYSTEM_PROMPT });
      currentMessages.push(...messages.slice(1));
    } else {
      currentMessages.push({ role: 'system', content: TOOL_SYSTEM_PROMPT });
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

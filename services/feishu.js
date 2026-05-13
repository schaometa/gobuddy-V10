// GoBuddy Feishu Service - 前端飞书服务封装
const WBFeishu = {
  baseUrl: 'http://localhost:8081/api/feishu',
  connected: false,
  lastCheck: 0,

  // 通用请求方法
  async request(path, options = {}) {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `请求失败: ${res.status}`);
      return data;
    } catch (e) {
      if (e.message === 'Failed to fetch') {
        throw new Error('无法连接到本地服务，请确保 server.js 已启动');
      }
      throw e;
    }
  },

  // 检查连接状态
  async checkConnection() {
    const now = Date.now();
    // 缓存30秒
    if (now - this.lastCheck < 30000) return this.connected;
    try {
      const res = await this.request('/auth/status');
      this.connected = res.logged_in === true;
      this.lastCheck = now;
      return this.connected;
    } catch {
      this.connected = false;
      this.lastCheck = now;
      return false;
    }
  },

  // 触发飞书登录（会打开浏览器进行OAuth）
  async login() {
    const res = await this.request('/auth/login', { method: 'POST' });
    // 清除缓存，下次检查重新获取状态
    this.lastCheck = 0;
    this.connected = true;
    return res;
  },

  // ============ 文档操作 ============

  // 读取文档内容
  async fetchDoc(token) {
    return this.request(`/docx/${token}`);
  },

  // 通过URL读取文档
  async fetchDocByUrl(url) {
    // 从URL提取token
    const match = url.match(/\/(?:docx|wiki)\/([a-zA-Z0-9]+)/);
    if (!match) throw new Error('无效的文档URL');
    return this.fetchDoc(match[1]);
  },

  // 创建文档
  async createDoc(title, content, options = {}) {
    return this.request('/docx/create', {
      method: 'POST',
      body: JSON.stringify({ title, content, ...options })
    });
  },

  // 更新文档
  async updateDoc(token, mode, content, select = null) {
    return this.request('/docx/update', {
      method: 'POST',
      body: JSON.stringify({ token, mode, content, select })
    });
  },

  // ============ 电子表格操作 ============

  // 读取电子表格
  async fetchSheet(url, range = 'Sheet1!A1:Z100') {
    return this.request(`/sheet/read?url=${encodeURIComponent(url)}&range=${encodeURIComponent(range)}`);
  },

  // 创建电子表格
  async createSheet(title, options = {}) {
    return this.request('/sheet/create', {
      method: 'POST',
      body: JSON.stringify({ title, ...options })
    });
  },

  // 写入电子表格
  async writeSheet(token, range, values) {
    return this.request('/sheet/write', {
      method: 'POST',
      body: JSON.stringify({ token, range, values })
    });
  },

  // 获取工作表列表
  async getSheets(token) {
    return this.request(`/sheet/sheets/${token}`);
  },

  // 获取电子表格元数据
  async getSheetMeta(token) {
    return this.request(`/sheet/meta/${token}`);
  },

  // 追加行到电子表格
  async appendSheet(token, sheetRef, values) {
    return this.request('/sheet/append', {
      method: 'POST',
      body: JSON.stringify({ token, sheetRef, values })
    });
  },

  // 增加行数
  async addSheetRows(token, sheetRef, count) {
    return this.request('/sheet/add-rows', {
      method: 'POST',
      body: JSON.stringify({ token, sheetRef, count })
    });
  },

  // 增加列数
  async addSheetCols(token, sheetRef, count) {
    return this.request('/sheet/add-cols', {
      method: 'POST',
      body: JSON.stringify({ token, sheetRef, count })
    });
  },

  // 查找替换
  async replaceInSheet(token, sheetRef, find, replace, options = {}) {
    return this.request('/sheet/replace', {
      method: 'POST',
      body: JSON.stringify({ token, sheetRef, find, replace, ...options })
    });
  },

  // 清空区域
  async clearSheet(token, sheetRef, ranges) {
    return this.request('/sheet/clear', {
      method: 'POST',
      body: JSON.stringify({ token, sheetRef, ranges })
    });
  },

  // 从URL提取表格token
  parseSheetUrl(url) {
    const match = url.match(/\/sheets\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  },

  // ============ 多维表格操作 ============

  // 获取多维表格元数据
  async fetchBitableMeta(token) {
    return this.request(`/bitable/meta/${token}`);
  },

  // 获取多维表格字段
  async getBitableFields(appToken, tableId) {
    return this.request(`/bitable/fields/${appToken}/${tableId}`);
  },

  // 获取多维表格记录
  async getBitableRecords(appToken, tableId) {
    return this.request(`/bitable/records/${appToken}/${tableId}`);
  },

  // 创建多维表格记录
  async createBitableRecord(appToken, tableId, fields) {
    return this.request(`/bitable/records/${appToken}/${tableId}`, {
      method: 'POST',
      body: JSON.stringify({ fields })
    });
  },

  // ============ 任务操作 ============

  // 获取任务列表
  async getTasks(status = 'uncompleted') {
    return this.request(`/task?status=${status}`);
  },

  // 获取未完成任务
  async getMyTasks() {
    return this.getTasks('uncompleted');
  },

  // 创建任务
  async createTask(summary, options = {}) {
    return this.request('/task/create', {
      method: 'POST',
      body: JSON.stringify({ summary, ...options })
    });
  },

  // 完成任务
  async completeTask(taskId) {
    return this.request(`/task/${taskId}/complete`, { method: 'POST' });
  },

  // 获取任务详情
  async getTaskDetail(taskId) {
    return this.request(`/task/${taskId}`);
  },

  // ============ 日历操作 ============

  // 获取日历列表
  async getCalendars() {
    return this.request('/calendar');
  },

  // 获取主日历
  async getPrimaryCalendar() {
    return this.request('/calendar/primary');
  },

  // 获取今日日程
  async getTodayEvents(calendarId = 'primary') {
    const today = dayjs().format('YYYY-MM-DD');
    return this.request(`/calendar/events?calendarId=${calendarId}&startTime=${today}T00:00:00%2B08:00&endTime=${today}T23:59:59%2B08:00`);
  },

  // 获取指定日期范围的日程
  async getEvents(startTime, endTime, calendarId = 'primary') {
    const encode = s => s ? s.replace(/\+/g, '%2B') : s;
    return this.request(`/calendar/events?calendarId=${calendarId}&startTime=${encode(startTime)}&endTime=${encode(endTime)}`);
  },

  // 创建日程
  async createEvent(summary, start, end, options = {}) {
    return this.request('/calendar/events', {
      method: 'POST',
      body: JSON.stringify({
        calendarId: 'primary',
        summary,
        start,
        end,
        ...options
      })
    });
  },

  // ============ 知识库操作 ============

  // 获取知识库列表
  async getWikiSpaces() {
    return this.request('/wiki/spaces');
  },

  // 获取知识库节点
  async getWikiNodes(spaceId, parent = null) {
    let url = `/wiki/nodes/${spaceId}`;
    if (parent) url += `?parent=${parent}`;
    return this.request(url);
  },

  // ============ 搜索操作 ============

  // 搜索文档
  async search(query, options = {}) {
    let url = `/search?query=${encodeURIComponent(query)}`;
    if (options.sort) url += `&sort=${options.sort}`;
    if (options.size) url += `&size=${options.size}`;
    return this.request(url);
  },

  // ============ 工具方法 ============

  // 从URL提取资源信息
  parseUrl(url) {
    if (!url) return null;
    // 去掉查询参数和锚点
    const clean = url.split('?')[0].split('#')[0];
    const patterns = {
      docx: /\/docx\/([a-zA-Z0-9_-]+)/,
      wiki: /\/wiki\/([a-zA-Z0-9_-]+)/,
      sheet: /\/sheets?\/([a-zA-Z0-9_-]+)/,
      bitable: /\/base\/([a-zA-Z0-9_-]+)/,
      folder: /\/drive\/folder\/([a-zA-Z0-9_-]+)/
    };

    for (const [type, pattern] of Object.entries(patterns)) {
      const match = clean.match(pattern);
      if (match) {
        return { type, token: match[1] };
      }
    }
    return null;
  },

  // 获取飞书资源的Web URL
  getWebUrl(type, token) {
    const baseUrls = {
      docx: 'https://feishu.cn/docx',
      wiki: 'https://feishu.cn/wiki',
      sheet: 'https://feishu.cn/sheets',
      bitable: 'https://feishu.cn/base'
    };
    return `${baseUrls[type] || baseUrls.docx}/${token}`;
  }
};

// Message Page Component - 讯息聚合模块（时间维度版）
const MessagePage = {
  name: 'MessagePage',
  setup() {
    const { ref, computed, onMounted, nextTick } = Vue;
    const syncing = ref(false);
    const lastSync = ref(null);
    const feishuConnected = ref(false);

    // 时间 Tab
    const activeTab = ref('today');

    // 原始数据
    const tasks = ref([]);
    const events = ref([]);
    const meetingDocs = ref([]);
    const searchStatus = ref('');

    // 时间范围计算
    const dateRange = computed(() => {
      const now = dayjs();
      switch (activeTab.value) {
        case 'today':
          return { start: now.startOf('day'), end: now.endOf('day'), label: '今日' };
        case 'week':
          return { start: now.startOf('week'), end: now.endOf('week'), label: '本周' };
        case 'month':
          return { start: now.startOf('month'), end: now.endOf('month'), label: '本月' }
      }
    });

    // 过滤后的任务（无 due 的任务也显示）
    const filteredTasks = computed(() => {
      const s = dateRange.value.start.clone().subtract(1, 'ms');
      const e = dateRange.value.end.clone().add(1, 'ms');
      return tasks.value.filter(t => {
        if (!t.due) return true; // 无截止日期的任务也显示
        const due = dayjs(t.due);
        return due.isAfter(s) && due.isBefore(e);
      });
    });

    // 过滤后的事件（客户端按 start_time 二次过滤）
    const filteredEvents = computed(() => {
      const s = dateRange.value.start.clone().subtract(1, 'ms');
      const e = dateRange.value.end.clone().add(1, 'ms');
      return events.value.filter(ev => {
        const t = ev.start_time || ev.startTime || '';
        if (!t) return false;
        const d = dayjs(t);
        return d.isAfter(s) && d.isBefore(e);
      });
    });

    // 统计
    const stats = computed(() => ({
      taskCount: filteredTasks.value.length,
      eventCount: filteredEvents.value.length,
      urgentTasks: filteredTasks.value.filter(t => {
        if (!t.due) return false;
        return dayjs(t.due).isBefore(dayjs().endOf('day'));
      }).length
    }));

    // Markdown 渲染
    const renderMarkdown = (text) => {
      if (!text) return '';
      try { return marked.parse(text); } catch { return text; }
    };

    // 从文档标题提取日期
    const extractDocDate = (title) => {
      if (!title) return '';
      const match = title.match(/(\d{4}-\d{2}-\d{2})/);
      return match ? match[1] : '';
    };

    // 从文档标题提取会议名称（去掉"会议纪要：日期 |"或"文字记录：日期 |"前缀）
    const extractMeetingName = (title) => {
      return title.replace(/^(会议纪要|智能纪要|文字记录)[：:]\s*\d{4}-\d{2}-\d{2}\s*[|｜]\s*/, '').trim();
    };

    // 从 markdown 内容中提取"会议目的"段落
    const extractSummary = (markdown) => {
      if (!markdown) return '';
      // 匹配 "**会议目的**：xxx" 或 "会议目的：xxx"，提取到下一个 ** 开头或换行
      const match = markdown.match(/\*{0,2}会议目的\*{0,2}[：:]\s*([\s\S]*?)(?=\n\*{2}|\n#|\n\n|$)/);
      if (match) return match[1].trim();
      return '';
    };

    // 检查飞书连接
    const checkFeishu = async () => {
      feishuConnected.value = await WBFeishu.checkConnection();
    };

    // 同步飞书数据
    // 三个 Tab 的日期范围定义
    const allTabs = [
      { id: 'today', label: '今日' },
      { id: 'week', label: '本周' },
      { id: 'month', label: '本月' }
    ];

    const getTabRange = (tabId) => {
      const now = dayjs();
      switch (tabId) {
        case 'today': return { start: now.startOf('day'), end: now.endOf('day'), label: '今日' };
        case 'week': return { start: now.startOf('week'), end: now.endOf('week'), label: '本周' };
        case 'month': return { start: now.startOf('month'), end: now.endOf('month'), label: '本月' };
      }
    };

    // 会议文档去重（搜索结果已经相关，不做日期过滤）
    const filterMeetingDocs = (allDocs, range) => {
      const seen = new Set();
      return allDocs.filter(d => {
        const name = extractMeetingName(d.title || '');
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      });
    };

    const syncFeishu = async () => {
      console.log('[同步] 开始同步飞书数据...');
      if (!feishuConnected.value) {
        console.log('[同步] 飞书未连接，中止');
        ElementPlus.ElMessage.error('飞书未连接，请先启动 server.js 并登录飞书');
        return;
      }

      syncing.value = true;
      const now = dayjs();
      const syncTime = now.format('HH:mm');

      try {
        // 月份范围（最大范围，覆盖所有 Tab）
        const monthRange = getTabRange('month');
        const monthStartStr = monthRange.start.format('YYYY-MM-DD') + 'T00:00:00+08:00';
        const monthEndStr = monthRange.end.format('YYYY-MM-DD') + 'T23:59:59+08:00';

        // 搜索会议纪要（不拼接日期，避免搜索无结果）
        const searchQueries = ['会议纪要', '智能纪要'];

        // 并行获取：任务 + 月度日程 + 多路搜索会议纪要
        const [taskRes, eventRes, ...searchResults] = await Promise.all([
          WBFeishu.getMyTasks().catch(() => ({ tasks: [] })),
          WBFeishu.getEvents(monthStartStr, monthEndStr).catch(() => ({ events: [] })),
          ...searchQueries.map(q => WBFeishu.search(q, { size: 10 }).catch(() => ({ items: [] })))
        ]);

        const allTasks = taskRes.tasks || [];
        const allEvents = eventRes.events || [];

        console.log('[同步] 任务:', allTasks.length, '条, 日程:', allEvents.length, '条');
        console.log('[同步] 搜索结果:', searchResults.map(r => (r.items || []).length));

        // 合并搜索结果并过滤
        const allDocs = searchResults.flatMap(r => r.items || r || []);
        const meetingOnly = allDocs.filter(d => /^(会议纪要|智能纪要)/.test(d.title || ''));
        console.log('[同步] 会议纪要匹配:', meetingOnly.length, '条');

        // 拉取所有会议文档内容（只拉一次，三个 Tab 共用）
        const allUnique = [];
        const seen = new Set();
        for (const d of meetingOnly) {
          const name = extractMeetingName(d.title || '');
          if (!seen.has(name)) { seen.add(name); allUnique.push(d); }
        }

        let allDocsWithContent = [];
        if (allUnique.length > 0) {
          allDocsWithContent = await Promise.all(allUnique.map(async (doc) => {
            try {
              const res = await WBFeishu.fetchDoc(doc.token);
              const markdown = res.markdown || res.content || res.text || '';
              const summary = extractSummary(markdown);
              return { ...doc, summary };
            } catch (e) {
              console.warn('[MessagePage] 文档内容获取失败:', doc.title, e);
              return { ...doc, summary: '' };
            }
          }));
          // 保留所有文档，summary 为空的显示占位提示
        }

        // 为每个 Tab 计算过滤后的数据并保存
        for (const tab of allTabs) {
          const range = getTabRange(tab.id);

          // 按日期过滤任务
          const tabTasks = allTasks.filter(t => {
            if (!t.due) return true; // 无截止日期的任务也保留
            const due = dayjs(t.due);
            return due.isAfter(range.start.subtract(1, 'ms')) && due.isBefore(range.end.add(1, 'ms'));
          });

          // 按日期过滤日程
          const tabEvents = allEvents.filter(e => {
            const t = e.start_time || e.startTime || '';
            if (!t) return false;
            const d = dayjs(t);
            return d.isAfter(range.start.subtract(1, 'ms')) && d.isBefore(range.end.add(1, 'ms'));
          });

          // 按日期过滤会议纪要
          const tabDocs = filterMeetingDocs(allDocsWithContent, range);

          // 保存到对应 Tab 的 localStorage
          const status = tabDocs.length > 0 ? `已获取 ${tabDocs.length} 篇会议纪要` : '未找到相关会议纪要';
          localStorage.setItem(`gobuddy-message-${tab.id}`, JSON.stringify({
            tasks: tabTasks,
            events: tabEvents,
            meetingDocs: tabDocs,
            lastSync: syncTime,
            searchStatus: status
          }));
        }

        // 加载当前 Tab 的数据到视图
        loadData(activeTab.value);
        console.log('[同步] 完成! 当前Tab:', activeTab.value);
        console.log('[同步] tasks:', tasks.value.length, 'events:', events.value.length, 'meetingDocs:', meetingDocs.value.length);
        ElementPlus.ElMessage.success('同步完成（今日/本周/本月已全部更新）');
      } catch (e) {
        ElementPlus.ElMessage.error('同步失败：' + e.message);
      }
      syncing.value = false;
    };

    // 完成任务
    const completeTask = async (taskId) => {
      try {
        await WBFeishu.completeTask(taskId);
        tasks.value = tasks.value.filter(t => t.guid !== taskId);
        saveData();
        ElementPlus.ElMessage.success('任务已完成');
      } catch (e) {
        ElementPlus.ElMessage.error('操作失败：' + e.message);
      }
    };

    // 格式化时间（日程用，周/月视图显示日期）
    const formatTime = (timeStr) => {
      if (!timeStr) return '';
      try { return dayjs(timeStr).format('HH:mm'); } catch { return timeStr; }
    };

    // 日程时间显示（今日只显示时间，周/月显示 日期+时间）
    const formatEventTime = (timeStr) => {
      if (!timeStr) return '';
      try {
        const d = dayjs(timeStr);
        if (activeTab.value === 'today') return d.format('HH:mm');
        if (d.isSame(dayjs(), 'day')) return '今日 ' + d.format('HH:mm');
        return d.format('MM/DD HH:mm');
      } catch { return timeStr; }
    };

    // 格式化日期
    const formatDate = (dateStr) => {
      if (!dateStr) return '无截止日期';
      try {
        const d = dayjs(dateStr);
        if (d.isSame(dayjs(), 'day')) return '今日 ' + d.format('HH:mm');
        if (d.isSame(dayjs().add(1, 'day'), 'day')) return '明日 ' + d.format('HH:mm');
        return d.format('MM/DD HH:mm');
      } catch { return dateStr; }
    };

    // 获取任务紧急程度
    const getTaskUrgency = (task) => {
      if (!task.due) return 'normal';
      const due = dayjs(task.due);
      if (due.isBefore(dayjs())) return 'overdue';
      if (due.isBefore(dayjs().endOf('day'))) return 'today';
      if (due.isBefore(dayjs().add(2, 'day'))) return 'tomorrow';
      return 'normal';
    };

    // 保存当前 Tab 数据到 localStorage
    const saveData = (tab) => {
      try {
        const key = `gobuddy-message-${tab || activeTab.value}`;
        localStorage.setItem(key, JSON.stringify({
          tasks: tasks.value,
          events: events.value,
          meetingDocs: meetingDocs.value,
          lastSync: lastSync.value,
          searchStatus: searchStatus.value
        }));
      } catch {}
    };

    // 从 localStorage 加载指定 Tab 数据
    const loadData = (tab) => {
      try {
        const key = `gobuddy-message-${tab}`;
        const raw = localStorage.getItem(key);
        if (!raw) return false;
        const data = JSON.parse(raw);
        tasks.value = data.tasks || [];
        events.value = data.events || [];
        meetingDocs.value = data.meetingDocs || [];
        lastSync.value = data.lastSync || null;
        searchStatus.value = data.searchStatus || '';
        return true;
      } catch { return false; }
    };

    // Tab 切换时加载对应缓存
    const switchTab = (tab) => {
      activeTab.value = tab;
      loadData(tab);
    };

    // 监听飞书连接成功事件
    window.addEventListener('feishu-connected', () => {
      feishuConnected.value = true;
    });
    // 监听飞书断开连接事件
    window.addEventListener('feishu-disconnected', () => {
      feishuConnected.value = false;
    });

    // 页面加载时恢复当前 Tab 缓存 + 检查连接
    onMounted(async () => {
      loadData(activeTab.value);
      await checkFeishu();
      // 首次加载：尝试从缓存读取，无缓存则自动同步
      const hasCache = loadData(activeTab.value);
      if (!hasCache && feishuConnected.value) {
        await syncFeishu();
      }
      nextTick(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); });
    });

    // 监听工作看板刷新事件，重新加载缓存数据
    window.addEventListener('dashboard-refreshed', () => {
      loadData(activeTab.value);
    });

    return {
      syncing, lastSync, feishuConnected,
      activeTab, dateRange,
      tasks, events, meetingDocs, searchStatus,
      filteredTasks, filteredEvents, stats,
      switchTab, syncFeishu, completeTask,
      formatTime, formatEventTime, formatDate, getTaskUrgency, extractMeetingName, extractDocDate, renderMarkdown
    };
  },
  template: `
    <div class="fade-in">
      <!-- 头部 -->
      <div style="display:flex;justify-content:flex-end;align-items:center;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:12px">
          <span v-if="lastSync" style="font-size:12px;color:#888D92">上次同步: {{ lastSync }}</span>
          <el-tag :type="feishuConnected ? 'success' : 'danger'" size="small">
            {{ feishuConnected ? '✓ 飞书已连接' : '✕ 飞书未连接' }}
          </el-tag>
          <el-button type="primary" @click="syncFeishu" :loading="syncing" :disabled="!feishuConnected">
            <i data-lucide="refresh-cw" style="width:14px;height:14px"></i> 同步飞书
          </el-button>
        </div>
      </div>

      <!-- 时间 Tab -->
      <div class="time-tabs" style="margin-bottom:20px">
        <div class="time-tab" :class="{ active: activeTab === 'today' }" @click="switchTab('today')">今日</div>
        <div class="time-tab" :class="{ active: activeTab === 'week' }" @click="switchTab('week')">本周</div>
        <div class="time-tab" :class="{ active: activeTab === 'month' }" @click="switchTab('month')">本月</div>
      </div>

      <!-- 统计卡片 -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px">
        <div class="stat-card">
          <div class="stat-icon" style="background:#E8F0FE;color:#3370FF"><i data-lucide="clipboard-list" style="width:24px;height:24px"></i></div>
          <div>
            <div class="stat-value">{{ stats.taskCount }}</div>
            <div class="stat-label">{{ dateRange.label }}待办</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#FFF0E0;color:#FF9500"><i data-lucide="calendar" style="width:24px;height:24px"></i></div>
          <div>
            <div class="stat-value">{{ stats.eventCount }}</div>
            <div class="stat-label">{{ dateRange.label }}日程</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#FEE2E2;color:#F54A45"><i data-lucide="alert-circle" style="width:24px;height:24px;color:#F54A45"></i></div>
          <div>
            <div class="stat-value">{{ stats.urgentTasks }}</div>
            <div class="stat-label">紧急事项</div>
          </div>
        </div>
      </div>

      <!-- 会议纪要 -->
      <div v-if="meetingDocs.length > 0 || searchStatus" style="margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <span style="font-size:16px;font-weight:600;color:#1C1F23"><i data-lucide="file-pen-line" style="width:16px;height:16px"></i> 会议纪要</span>
          <el-tag v-if="meetingDocs.length > 0" size="small">{{ meetingDocs.length }}篇</el-tag>
        </div>
        <div v-if="searchStatus && meetingDocs.length === 0" class="content-card" style="text-align:center;color:#888D92">
          {{ searchStatus }}
        </div>
        <div v-else style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px">
          <div v-for="doc in meetingDocs" :key="doc.token" class="meeting-card">
            <div class="meeting-card-title">
              {{ extractMeetingName(doc.title) || doc.title }}
              <span v-if="extractDocDate(doc.title)" class="meeting-date-tag">{{ extractDocDate(doc.title) }}</span>
            </div>
            <div v-if="doc.summary" class="meeting-card-summary" v-html="renderMarkdown(doc.summary)"></div>
            <div v-else class="meeting-card-summary" style="color:#bbb;font-style:italic">暂无会议目的</div>
            <a :href="'https://feishu.cn/docx/' + doc.token" target="_blank" class="meeting-card-link">
              查看原文 →
            </a>
          </div>
        </div>
      </div>

      <!-- 内容区 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <!-- 待办任务 -->
        <div class="content-card">
          <div class="card-header">
            <span class="card-title"><i data-lucide="clipboard-list" style="width:16px;height:16px"></i> 飞书待办</span>
            <el-tag size="small">{{ filteredTasks.length }}项</el-tag>
          </div>
          <div v-if="filteredTasks.length === 0" style="text-align:center;padding:40px;color:#888D92">
            {{ feishuConnected ? dateRange.label + '暂无待办任务' : '请先同步飞书' }}
          </div>
          <div v-else style="max-height:400px;overflow-y:auto">
            <div v-for="task in filteredTasks" :key="task.guid"
              class="message-item"
              :class="'urgency-' + getTaskUrgency(task)"
              style="display:flex;align-items:flex-start;padding:12px 0;border-bottom:1px solid #F0F1F5"
            >
              <div style="flex:1;min-width:0">
                <div style="font-size:14px;font-weight:500;color:#1C1F23;margin-bottom:4px">
                  {{ task.summary || task.title }}
                </div>
                <div style="font-size:12px;color:#888D92">
                  截止：{{ formatDate(task.due) }}
                </div>
              </div>
              <el-button
                type="success"
                size="small"
                @click="completeTask(task.guid)"
                style="flex-shrink:0;margin-left:8px"
              >
                完成
              </el-button>
            </div>
          </div>
        </div>

        <!-- 日程安排 -->
        <div class="content-card">
          <div class="card-header">
            <span class="card-title"><i data-lucide="calendar" style="width:16px;height:16px"></i> {{ dateRange.label }}日程</span>
            <el-tag size="small">{{ filteredEvents.length }}个</el-tag>
          </div>
          <div v-if="filteredEvents.length === 0" style="text-align:center;padding:40px;color:#888D92">
            {{ feishuConnected ? dateRange.label + '暂无日程' : '请先同步飞书' }}
          </div>
          <div v-else style="max-height:400px;overflow-y:auto">
            <div v-for="event in filteredEvents" :key="event.event_id"
              style="padding:12px 0;border-bottom:1px solid #F0F1F5"
            >
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                <span style="font-size:14px;font-weight:500;color:#3370FF">
                  {{ formatEventTime(event.startTime || event.start_time) }} - {{ formatTime(event.endTime || event.end_time) }}
                </span>
              </div>
              <div style="font-size:14px;color:#1C1F23">
                {{ event.summary || event.title }}
              </div>
              <div v-if="event.location" style="font-size:12px;color:#888D92;margin-top:4px">
                <i data-lucide="map-pin" style="width:14px;height:14px"></i> {{ event.location }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
};

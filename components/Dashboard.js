// Dashboard Component
const Dashboard = {
  name: 'Dashboard',
  emits: ['navigate'],
  setup(props, { emit }) {
    const { ref, watch, onMounted, onUnmounted, nextTick } = Vue;

    const recentNotes = ref([]);
    const allNotes = ref([]);
    const showAllNotes = ref(false);
    const loading = ref(true);
    const refreshing = ref(false);
    const viewMode = ref('day');

    // 笔记编辑状态
    const editingNoteId = ref(null);
    const editingNoteContent = ref('');

    // 统计数据
    const dashboardStats = ref({
      meetings: 0,
      events: 0,
      docs: 0,
      tables: 0,
      feishuTasks: 0
    });

    const viewModeToTab = { day: 'today', week: 'week', month: 'month' };

    const getTabRange = (tabId) => {
      const now = dayjs();
      switch (tabId) {
        case 'today': return { start: now.startOf('day'), end: now.endOf('day'), label: '今日' };
        case 'week': return { start: now.startOf('week'), end: now.endOf('week'), label: '本周' };
        case 'month': return { start: now.startOf('month'), end: now.endOf('month'), label: '本月' };
      }
    };

    const formatTime = (dateStr) => {
      try {
        const d = dayjs(dateStr);
        if (d.isSame(dayjs(), 'day')) return '今日';
        if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return '昨日';
        return d.format('MM/DD');
      } catch { return ''; }
    };

    // 从 localStorage 加载统计数据
    const loadStats = () => {
      const tab = viewModeToTab[viewMode.value];
      // 飞书数据
      try {
        const raw = localStorage.getItem(`gobuddy-message-${tab}`);
        if (raw) {
          const data = JSON.parse(raw);
          dashboardStats.value.meetings = (data.meetingDocs || []).length;
          dashboardStats.value.events = (data.events || []).length;
          dashboardStats.value.feishuTasks = (data.tasks || []).length;
        } else {
          dashboardStats.value.meetings = 0;
          dashboardStats.value.events = 0;
          dashboardStats.value.feishuTasks = 0;
        }
      } catch {
        dashboardStats.value.meetings = 0;
        dashboardStats.value.events = 0;
        dashboardStats.value.feishuTasks = 0;
      }
    };

    // 加载笔记
    const loadNotes = async () => {
      try {
        allNotes.value = await WBStorage.getNotes();
        recentNotes.value = allNotes.value.slice(0, 5);
      } catch {
        allNotes.value = [];
        recentNotes.value = [];
      }
    };

    // 按 viewMode 过滤笔记
    const filteredNotes = Vue.computed(() => {
      const range = getTabRange(viewModeToTab[viewMode.value]);
      return allNotes.value.filter(n => {
        const t = dayjs(n.createdAt);
        return t.isAfter(range.start.subtract(1, 'ms')) && t.isBefore(range.end.add(1, 'ms'));
      });
    });

    const toggleShowAllNotes = () => {
      showAllNotes.value = !showAllNotes.value;
    };

    // 笔记编辑
    const startEditNote = (note) => {
      editingNoteId.value = note.id;
      editingNoteContent.value = note.content;
    };
    const saveEditNote = async () => {
      if (!editingNoteContent.value.trim()) return;
      try {
        await WBStorage.updateNote(editingNoteId.value, editingNoteContent.value.trim());
        editingNoteId.value = null;
        await loadNotes();
        ElementPlus.ElMessage.success('笔记已更新');
      } catch (e) {
        ElementPlus.ElMessage.error('更新失败');
      }
    };
    const cancelEditNote = () => { editingNoteId.value = null; };
    const deleteNote = async (id) => {
      try {
        await WBStorage.deleteNote(id);
        await loadNotes();
        ElementPlus.ElMessage.success('笔记已删除');
      } catch (e) {
        ElementPlus.ElMessage.error('删除失败');
      }
    };

    // 加载文档和表格统计（与 DocumentPage / TablePage 同一数据源）
    const loadDocStats = () => {
      try {
        const range = getTabRange(viewModeToTab[viewMode.value]);
        // 飞书文档：从 localStorage recent-feishu-docs 读取（DocumentPage 同源）
        const docs = WBStorage.get('recent-feishu-docs', []);
        dashboardStats.value.docs = docs.filter(d => {
          const t = dayjs(d.time || d.createdAt);
          return t.isAfter(range.start.subtract(1, 'ms')) && t.isBefore(range.end.add(1, 'ms'));
        }).length;
        // 飞书表格：从 localStorage recent-feishu-tables 读取（TablePage 同源）
        const tables = WBStorage.get('recent-feishu-tables', []);
        dashboardStats.value.tables = tables.filter(t => {
          const time = dayjs(t.openedAt);
          return time.isAfter(range.start.subtract(1, 'ms')) && time.isBefore(range.end.add(1, 'ms'));
        }).length;
      } catch {
        dashboardStats.value.docs = 0;
        dashboardStats.value.tables = 0;
      }
    };

    // 主加载函数
    const loadData = async () => {
      loading.value = true;
      loadStats();
      await Promise.all([loadNotes(), loadDocStats()]);
      loading.value = false;
    };

    // viewMode 切换时重新加载统计
    watch(viewMode, () => {
      loadStats();
      loadDocStats();
    });

    // ===== 飞书同步逻辑 =====
    const extractMeetingName = (title) => {
      return (title || '').replace(/^(会议纪要|文字记录)[：:]\s*\d{4}-\d{2}-\d{2}\s*[|｜]\s*/, '').trim();
    };

    const extractSummary = (markdown) => {
      if (!markdown) return '';
      const match = markdown.match(/\*{0,2}会议目的\*{0,2}[：:]\s*([\s\S]*?)(?=\n\*{2}|\n#|\n\n|$)/);
      if (match) return match[1].trim();
      return '';
    };

    const filterMeetingDocs = (allDocs, range) => {
      const seen = new Set();
      return allDocs.filter(d => {
        const name = extractMeetingName(d.title || '');
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      });
    };

    const refreshFeishu = async () => {
      const feishuOk = await WBFeishu.checkConnection();
      if (!feishuOk) throw new Error('飞书未连接');

      const now = dayjs();
      const syncTime = now.format('HH:mm');
      const monthRange = getTabRange('month');
      const monthStartStr = monthRange.start.format('YYYY-MM-DD') + 'T00:00:00+08:00';
      const monthEndStr = monthRange.end.format('YYYY-MM-DD') + 'T23:59:59+08:00';

      // 搜索会议纪要（不拼接日期，避免搜索无结果）
      const searchQueries = ['会议纪要', '智能纪要'];

      const [taskRes, eventRes, ...searchResults] = await Promise.all([
        WBFeishu.getMyTasks().catch(() => ({ tasks: [] })),
        WBFeishu.getEvents(monthStartStr, monthEndStr).catch(() => ({ events: [] })),
        ...searchQueries.map(q => WBFeishu.search(q, { size: 20 }).catch(() => ({ items: [] })))
      ]);

      const allTasks = taskRes.tasks || [];
      const allEvents = eventRes.events || [];
      const allDocs = searchResults.flatMap(r => r.items || r || []);
      const meetingOnly = allDocs.filter(d => /^(会议纪要|智能纪要)/.test(d.title || ''));

      // 去重并拉取内容
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
            return { ...doc, summary: extractSummary(markdown) };
          } catch { return { ...doc, summary: '' }; }
        }));
        allDocsWithContent = allDocsWithContent.filter(d => d.summary);
      }

      // 按 Tab 分别保存
      for (const tabId of ['today', 'week', 'month']) {
        const range = getTabRange(tabId);
        const tabTasks = allTasks.filter(t => {
          if (!t.due) return true;
          const due = dayjs(t.due);
          return due.isAfter(range.start.subtract(1, 'ms')) && due.isBefore(range.end.add(1, 'ms'));
        });
        const tabEvents = allEvents.filter(e => {
          const t = e.start_time || e.startTime || '';
          if (!t) return false;
          const d = dayjs(t);
          return d.isAfter(range.start.subtract(1, 'ms')) && d.isBefore(range.end.add(1, 'ms'));
        });
        const tabDocs = filterMeetingDocs(allDocsWithContent, range);

        localStorage.setItem(`gobuddy-message-${tabId}`, JSON.stringify({
          tasks: tabTasks, events: tabEvents, meetingDocs: tabDocs,
          lastSync: syncTime,
          searchStatus: tabDocs.length > 0 ? `已获取 ${tabDocs.length} 篇会议纪要` : '未找到相关会议纪要'
        }));
      }
    };

    // 刷新全部
    const refresh = async () => {
      refreshing.value = true;
      let error = null;

      try {
        await refreshFeishu();
      } catch (e) {
        error = e.message;
      }

      // 从 localStorage 读取最新数据
      loadStats();
      await Promise.all([loadDocStats(), loadNotes()]);
      refreshing.value = false;

      // 通知其他模块数据已更新
      window.dispatchEvent(new CustomEvent('dashboard-refreshed'));

      if (!error) {
        ElementPlus.ElMessage.success('刷新完成');
      } else {
        ElementPlus.ElMessage.warning('部分刷新完成：' + error);
      }
    };

    // 监听数据刷新事件
    const onDashboardRefreshed = () => { loadData(); };
    window.addEventListener('dashboard-refreshed', onDashboardRefreshed);

    onMounted(() => {
      loadData();
      nextTick(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); });
    });

    onUnmounted(() => {
      window.removeEventListener('dashboard-refreshed', onDashboardRefreshed);
    });

    // Re-render Lucide icons when data changes
    watch([dashboardStats, recentNotes, filteredNotes, showAllNotes, viewMode], () => {
      nextTick(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); });
    });

    return {
      recentNotes, allNotes, showAllNotes, filteredNotes, loading, refreshing, viewMode, dashboardStats,
      editingNoteId, editingNoteContent,
      emit, loadData, refresh, formatTime, toggleShowAllNotes,
      startEditNote, saveEditNote, cancelEditNote, deleteNote
    };
  },
  template: `
    <div v-loading="loading" class="fade-in">
      <!-- Header -->
      <div style="display:flex;justify-content:flex-end;align-items:center;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:10px">
          <el-radio-group v-model="viewMode" size="small">
            <el-radio-button label="day">日</el-radio-button>
            <el-radio-button label="week">周</el-radio-button>
            <el-radio-button label="month">月</el-radio-button>
          </el-radio-group>
          <el-button type="primary" @click="refresh" :loading="refreshing"><i data-lucide="refresh-cw" style="width:14px;height:14px"></i> 刷新</el-button>
        </div>
      </div>

      <!-- Stat Cards -->
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:24px">
        <div class="stat-card">
          <div class="stat-icon" style="background:#FFF0E0;color:#FF9500"><i data-lucide="calendar" style="width:24px;height:24px"></i></div>
          <div>
            <div class="stat-value">{{ dashboardStats.events }}</div>
            <div class="stat-label">日程</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#E8F0FE;color:#3370FF"><i data-lucide="file-pen-line" style="width:24px;height:24px"></i></div>
          <div>
            <div class="stat-value">{{ dashboardStats.meetings }}</div>
            <div class="stat-label">会议纪要</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#E0F7E0;color:#52C41A"><i data-lucide="file-text" style="width:24px;height:24px"></i></div>
          <div>
            <div class="stat-value">{{ dashboardStats.docs }}</div>
            <div class="stat-label">飞书文档</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#E0F2FE;color:#0284C7"><i data-lucide="bar-chart-3" style="width:24px;height:24px"></i></div>
          <div>
            <div class="stat-value">{{ dashboardStats.tables }}</div>
            <div class="stat-label">飞书表格</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#F3E8FF;color:#9333EA"><i data-lucide="clipboard-list" style="width:24px;height:24px"></i></div>
          <div>
            <div class="stat-value">{{ dashboardStats.feishuTasks }}</div>
            <div class="stat-label">飞书待办</div>
          </div>
        </div>
      </div>

      <!-- Notes + Tasks -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <!-- Recent Notes -->
        <div class="content-card">
          <div class="card-header">
            <span class="card-title"><i data-lucide="pen-line" style="width:18px;height:18px"></i> 快捷笔记</span>
            <span style="font-size:12px;color:#888D92">{{ filteredNotes.length }}条</span>
          </div>
          <div v-if="filteredNotes.length === 0" style="text-align:center;padding:20px;color:#888D92">
            <i data-lucide="pen-line" style="width:48px;height:48px"></i><br>暂无笔记
          </div>
          <div v-for="note in (showAllNotes ? filteredNotes : filteredNotes.slice(0, 5))" :key="note.id"
            style="padding:10px 0;border-bottom:1px solid #F0F1F5">
            <!-- 查看模式 -->
            <div v-if="editingNoteId !== note.id" style="display:flex;align-items:center">
              <span style="font-size:14px;color:#1C1F23;flex:1">{{ note.content }}</span>
              <span style="font-size:12px;color:#BBB;flex-shrink:0;margin-left:8px">{{ formatTime(note.createdAt) }}</span>
              <el-button type="primary" link size="small" @click="startEditNote(note)" style="margin-left:6px">编辑</el-button>
              <el-button type="danger" link size="small" @click="deleteNote(note.id)">删除</el-button>
            </div>
            <!-- 编辑模式 -->
            <div v-else style="display:flex;gap:6px;align-items:center">
              <el-input v-model="editingNoteContent" size="small" style="flex:1" @keydown.enter="saveEditNote" />
              <el-button type="primary" size="small" @click="saveEditNote">保存</el-button>
              <el-button size="small" @click="cancelEditNote">取消</el-button>
            </div>
          </div>
          <div v-if="filteredNotes.length > 5" style="text-align:center;padding-top:8px">
            <el-button type="primary" link size="small" @click="toggleShowAllNotes">
              {{ showAllNotes ? '收起' : '显示全部 (' + filteredNotes.length + ')' }}
            </el-button>
          </div>
        </div>

        <!-- Tasks -->
        <div class="content-card">
          <div class="card-header">
            <span class="card-title"><i data-lucide="clipboard-list" style="width:18px;height:18px"></i> {{ viewMode === 'day' ? '今日' : viewMode === 'week' ? '本周' : '本月' }}待办</span>
          </div>
          <dashboard-tasks :view-mode="viewMode" @changed="loadData" />
        </div>
      </div>
    </div>
  `
};

// Inline sub-component for tasks
const DashboardTasks = {
  name: 'DashboardTasks',
  props: { viewMode: { type: String, default: 'day' } },
  emits: ['changed'],
  setup(props, { emit }) {
    const { ref, computed, onMounted } = Vue;
    const allTasks = ref([]);
    const newTask = ref('');

    const viewModeToTab = { day: 'today', week: 'week', month: 'month' };
    const getTabRange = (tabId) => {
      const now = dayjs();
      switch (tabId) {
        case 'today': return { start: now.startOf('day'), end: now.endOf('day') };
        case 'week': return { start: now.startOf('week'), end: now.endOf('week') };
        case 'month': return { start: now.startOf('month'), end: now.endOf('month') };
      }
    };

    const tasks = computed(() => {
      const range = getTabRange(viewModeToTab[props.viewMode]);
      return allTasks.value.filter(t => {
        const time = dayjs(t.createdAt);
        return time.isAfter(range.start.subtract(1, 'ms')) && time.isBefore(range.end.add(1, 'ms'));
      });
    });

    const loadTasks = async () => {
      try { allTasks.value = await WBStorage.getTasks(); } catch (e) { console.error('loadTasks error:', e); }
    };

    const addTask = async () => {
      const text = newTask.value.trim();
      if (!text) return;
      try {
        const id = await WBStorage.addTask({ title: text });
        console.log('[Dashboard] task added, id:', id);
        newTask.value = '';
        await loadTasks();
        emit('changed');
        ElementPlus.ElMessage.success('任务已添加');
      } catch (e) {
        console.error('[Dashboard] addTask error:', e);
        ElementPlus.ElMessage.error('添加失败：' + e.message);
      }
    };

    const completeTask = async (id) => {
      try {
        await WBStorage.completeTask(id);
        await loadTasks();
        emit('changed');
      } catch (e) { console.error('completeTask error:', e); }
    };

    const deleteTask = async (id) => {
      try {
        await WBStorage.deleteTask(id);
        await loadTasks();
        emit('changed');
      } catch (e) { console.error('deleteTask error:', e); }
    };

    onMounted(loadTasks);

    const formatDate = (dateStr) => {
      try {
        const d = dayjs(dateStr);
        if (d.isSame(dayjs(), 'day')) return '今日';
        if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return '昨日';
        return d.format('MM/DD');
      } catch { return ''; }
    };

    return { allTasks, tasks, newTask, addTask, completeTask, deleteTask, formatDate };
  },
  template: `
    <div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <el-input v-model="newTask" placeholder="添加新任务..." @keydown.enter="addTask" clearable />
        <el-button type="primary" @click="addTask">添加</el-button>
      </div>
      <div v-for="task in tasks" :key="task.id"
        style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #F0F1F5">
        <el-checkbox
          :model-value="task.completed"
          @change="completeTask(task.id)"
          style="margin-right:8px"
        />
        <span :style="{flex:1,textDecoration: task.completed ? 'line-through' : 'none', color: task.completed ? '#BBB' : '#333'}">
          {{ task.title }}
        </span>
        <span style="font-size:12px;color:#BBB;flex-shrink:0;margin-left:8px">{{ formatDate(task.createdAt) }}</span>
        <el-button type="danger" link size="small" @click="deleteTask(task.id)" style="margin-left:8px">删除</el-button>
      </div>
      <div v-if="tasks.length === 0" style="text-align:center;padding:16px;color:#888D92">
        暂无待办事项，添加一个吧！
      </div>
    </div>
  `
};

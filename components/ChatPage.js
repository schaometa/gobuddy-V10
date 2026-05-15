// GoBuddy AI Chat Component
const ChatPage = {
  name: 'ChatPage',
  setup() {
    const { ref, computed, onMounted, nextTick, watch } = Vue;

    // 对话列表
    const conversations = ref([]);
    const currentConvId = ref(null);
    const currentMessages = ref([]);
    const streaming = ref(false);
    const inputText = ref('');
    const abortController = ref(null);

    // 模型选择
    const providers = ref({});
    const activeProvider = ref('');
    const activeModel = ref('');

    // 加载对话列表
    const loadConversations = async () => {
      try {
        conversations.value = await WBStorage.getConversations();
      } catch (e) {
        console.error('[Chat] load conversations error:', e);
      }
    };

    // 加载 provider 配置
    const loadProviders = () => {
      providers.value = WBStorage.getProviders();
      const settings = WBStorage.getSettings();
      activeProvider.value = settings.activeProvider;
      activeModel.value = settings.activeModel;
    };

    // 获取当前 provider 的模型列表
    const modelList = computed(() => {
      const p = providers.value[activeProvider.value];
      if (!p || !p.models) return [];
      return Object.entries(p.models).map(([id, m]) => ({ id, name: m.name || id }));
    });

    // 新建对话
    const newConversation = () => {
      currentConvId.value = null;
      currentMessages.value = [];
    };

    // 打开对话
    const openConversation = async (id) => {
      const conv = await WBStorage.getConversation(id);
      if (conv) {
        currentConvId.value = id;
        currentMessages.value = conv.messages || [];
        nextTick(scrollToBottom);
      }
    };

    // 删除对话
    const deleteConversation = async (id) => {
      await WBStorage.deleteConversation(id);
      if (currentConvId.value === id) {
        newConversation();
      }
      await loadConversations();
    };

    // 保存当前对话
    const saveCurrentConversation = async () => {
      if (currentMessages.value.length === 0) return;
      const firstUserMsg = currentMessages.value.find(m => m.role === 'user');
      const title = firstUserMsg ? firstUserMsg.content.substring(0, 50) : '新对话';
      const conv = {
        id: currentConvId.value || undefined,
        title,
        messages: currentMessages.value,
        model: activeModel.value,
        provider: activeProvider.value
      };
      const id = await WBStorage.saveConversation(conv);
      if (!currentConvId.value) currentConvId.value = id;
      await loadConversations();
    };

    // 滚动到底部
    const scrollToBottom = () => {
      const el = document.getElementById('chat-messages-end');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    };

    // 停止生成
    const stopStreaming = () => {
      if (abortController.value) {
        abortController.value.abort();
        abortController.value = null;
      }
      streaming.value = false;
      // 移除空的 AI 占位消息
      const lastMsg = currentMessages.value[currentMessages.value.length - 1];
      if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.content) {
        currentMessages.value.pop();
      }
      saveCurrentConversation();
    };

    // 发送消息
    const sendMessage = async () => {
      const text = inputText.value.trim();
      if (!text || streaming.value) return;

      inputText.value = '';

      // 添加用户消息
      currentMessages.value.push({
        role: 'user',
        content: text,
        timestamp: new Date().toISOString()
      });

      // 添加 AI 占位消息
      currentMessages.value.push({
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString()
      });

      streaming.value = true;
      const controller = new AbortController();
      abortController.value = controller;
      nextTick(scrollToBottom);

      // 构建上下文消息（包含工具调用历史，转换为 OpenAI 格式）
      const contextMessages = currentMessages.value
        .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'tool_call' || m.role === 'tool_result')
        .slice(0, -1)
        .map(m => {
          if (m.role === 'user') return { role: 'user', content: m.content };
          if (m.role === 'assistant') return { role: 'assistant', content: m.content || '' };
          if (m.role === 'tool_call') return {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: m.toolId, type: 'function', function: { name: m.toolName, arguments: JSON.stringify(m.args || {}) } }]
          };
          if (m.role === 'tool_result') {
            let resultStr = typeof m.result === 'string' ? m.result : JSON.stringify(m.result);
            if (resultStr.length > 3000) {
              resultStr = resultStr.substring(0, 3000) + '\n... (结果过长已截断)';
            }
            return {
              role: 'tool',
              tool_call_id: m.toolId,
              content: resultStr
            };
          }
          return null;
        })
        .filter(Boolean);

      contextMessages.push({ role: 'user', content: text });

      // 工具名称中文映射
      const toolNameMap = {
        create_feishu_doc: '创建飞书文档',
        create_feishu_sheet: '创建飞书表格',
        search_feishu_docs: '搜索飞书文档',
        get_feishu_tasks: '获取待办任务',
        create_feishu_task: '创建待办任务',
        get_calendar_events: '获取日程',
        read_feishu_doc: '读取飞书文档',
        read_feishu_sheet: '读取表格数据',
        get_sheet_tabs: '获取工作表列表',
        get_dashboard_stats: '获取看板统计',
        get_recent_docs: '获取最近文档',
        get_recent_tables: '获取最近表格',
        get_meeting_notes: '获取会议纪要',
        update_feishu_doc: '编辑飞书文档',
        write_feishu_sheet: '写入表格数据',
        complete_feishu_task: '完成待办任务',
        create_calendar_event: '创建日程'
      };

      // 流式调用
      await WBAI.streamChat(contextMessages, {
        abortSignal: controller.signal,
        onChunk: (content) => {
          const lastMsg = currentMessages.value[currentMessages.value.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.content += content;
            nextTick(scrollToBottom);
          }
        },
        onToolCall: (tc) => {
          currentMessages.value.push({
            role: 'tool_call',
            toolId: tc.id,
            toolName: tc.name,
            toolLabel: toolNameMap[tc.name] || tc.name,
            args: tc.args,
            timestamp: new Date().toISOString()
          });
          nextTick(scrollToBottom);
        },
        onToolResult: (tr) => {
          const toolResult = tr.result || {};
          let summary = '';
          if (tr.name === 'read_feishu_doc') summary = (toolResult.content || toolResult.markdown || '').substring(0, 200) + '...';
          else if (tr.name === 'read_feishu_sheet') summary = `${(toolResult.values || []).length} 行数据`;
          else if (tr.name === 'get_meeting_notes') summary = `${(toolResult.notes || []).length} 篇会议纪要`;
          else if (tr.name === 'get_feishu_tasks') summary = `${(toolResult.tasks || []).length} 个任务`;
          else if (tr.name === 'get_calendar_events') summary = `${(toolResult.events || []).length} 个日程`;
          else if (tr.name === 'search_feishu_docs') summary = `${(toolResult.items || []).length} 条结果`;
          else if (tr.name === 'create_feishu_doc') summary = `文档已创建: ${toolResult.url || toolResult.token || ''}`;
          else if (tr.name === 'create_feishu_sheet') summary = `表格已创建: ${toolResult.url || toolResult.spreadsheetToken || ''}`;
          else if (tr.name === 'create_feishu_task') summary = `任务已创建: ${toolResult.guid || ''}`;
          else if (tr.name === 'complete_feishu_task') summary = '任务已完成';
          else summary = JSON.stringify(toolResult).substring(0, 150);

          currentMessages.value.push({
            role: 'tool_result',
            toolId: tr.id,
            toolName: tr.name,
            toolLabel: toolNameMap[tr.name] || tr.name,
            result: tr.result,
            resultSummary: summary,
            timestamp: new Date().toISOString()
          });

          // 同步到 GoBuddy 最近文档/表格列表
          const r = tr.result || {};
          if (tr.name === 'create_feishu_doc' && (r.token || r.doc_token)) {
            const token = r.token || r.doc_token;
            const url = r.url || WBFeishu.getWebUrl('docx', token);
            const title = r.title || tr.args?.title || '新文档';
            const recentDocs = WBStorage.get('recent-feishu-docs', []);
            recentDocs.unshift({ title, token, url, time: dayjs().format('YYYY-MM-DD HH:mm'), category: 'other', pinned: false });
            if (recentDocs.length > 20) recentDocs.pop();
            WBStorage.set('recent-feishu-docs', recentDocs);
          }
          if (tr.name === 'create_feishu_sheet' && (r.spreadsheetToken || r.token)) {
            const token = r.spreadsheetToken || r.token;
            const title = r.title || tr.args?.title || '新表格';
            const recentTables = WBStorage.get('recent-feishu-tables', []);
            recentTables.unshift({ token, title, type: 'sheet', openedAt: new Date().toISOString() });
            if (recentTables.length > 20) recentTables.pop();
            WBStorage.set('recent-feishu-tables', recentTables);
          }
          window.dispatchEvent(new CustomEvent('dashboard-refreshed'));
          window.dispatchEvent(new CustomEvent('feishu-connected'));

          // 添加新的 AI 占位消息（工具调用后 AI 会继续回复）
          currentMessages.value.push({
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString()
          });
          nextTick(scrollToBottom);
        },
        onDone: async () => {
          streaming.value = false;
          abortController.value = null;
          await saveCurrentConversation();
        },
        onError: (err) => {
          if (err.name === 'AbortError') return; // 用户主动停止
          streaming.value = false;
          abortController.value = null;
          const lastMsg = currentMessages.value[currentMessages.value.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.content = lastMsg.content || `错误：${WBAI.getErrorMessage(err)}`;
          }
          saveCurrentConversation();
        }
      });
    };

    // 渲染 Markdown
    const renderMarkdown = (text) => {
      if (!text) return '';
      try {
        if (typeof marked !== 'undefined') {
          marked.setOptions({ breaks: true, gfm: true });
          return marked.parse(text);
        }
      } catch {}
      return text.replace(/\n/g, '<br>');
    };

    // 格式化时间
    const formatTime = (ts) => {
      try {
        return dayjs(ts).format('HH:mm');
      } catch { return ''; }
    };

    const formatListTime = (ts) => {
      try {
        const d = dayjs(ts);
        if (d.isSame(dayjs(), 'day')) return d.format('HH:mm');
        if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return '昨天';
        return d.format('MM/DD');
      } catch { return ''; }
    };

    // 复制代码块
    const copyCode = (e) => {
      const btn = e.target.closest('.copy-code-btn');
      if (!btn) return;
      const code = btn.closest('.code-block-wrapper')?.querySelector('code');
      if (code) {
        navigator.clipboard.writeText(code.textContent);
        ElementPlus.ElMessage.success('已复制');
      }
    };

    onMounted(() => {
      loadConversations();
      loadProviders();
    });

    return {
      conversations, currentConvId, currentMessages, streaming, inputText,
      providers, activeProvider, activeModel, modelList,
      newConversation, openConversation, deleteConversation,
      sendMessage, stopStreaming, renderMarkdown, formatTime, formatListTime, copyCode
    };
  },
  template: `
    <div style="display:flex;height:calc(100vh - 60px);overflow:hidden">
      <!-- 左侧对话列表 -->
      <div style="width:240px;min-width:240px;border-right:1px solid #E6E8EA;display:flex;flex-direction:column;background:#FAFBFC;overflow:hidden">
        <div style="padding:12px;border-bottom:1px solid #E6E8EA;flex-shrink:0">
          <el-button type="primary" style="width:100%" @click="newConversation">
            <i data-lucide="plus" style="width:14px;height:14px;margin-right:4px"></i> 新对话
          </el-button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:8px">
          <div v-for="conv in conversations" :key="conv.id"
            @click="openConversation(conv.id)"
            style="padding:10px 12px;border-radius:6px;cursor:pointer;margin-bottom:4px;display:flex;align-items:center;justify-content:space-between;transition:background 0.2s"
            :style="{ background: currentConvId === conv.id ? '#E8F0FE' : 'transparent' }"
            @mouseenter="$event.currentTarget.style.background=currentConvId===conv.id?'#E8F0FE':'#F0F1F5'"
            @mouseleave="$event.currentTarget.style.background=currentConvId===conv.id?'#E8F0FE':'transparent'"
          >
            <div style="flex:1;overflow:hidden">
              <div style="font-size:13px;color:#1C1F23;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ conv.title }}</div>
              <div style="font-size:11px;color:#888D92;margin-top:2px">{{ formatListTime(conv.updatedAt) }}</div>
            </div>
            <el-button type="danger" link size="small" @click.stop="deleteConversation(conv.id)" style="flex-shrink:0;margin-left:4px">
              <i data-lucide="trash-2" style="width:12px;height:12px"></i>
            </el-button>
          </div>
          <div v-if="conversations.length===0" style="text-align:center;padding:40px 10px;color:#888D92;font-size:13px">
            暂无对话记录
          </div>
        </div>
      </div>

      <!-- 右侧对话区域 -->
      <div style="flex:1;display:flex;flex-direction:column;background:#fff;overflow:hidden">
        <!-- 顶部栏：模型选择 -->
        <div style="padding:10px 16px;border-bottom:1px solid #E6E8EA;display:flex;align-items:center;gap:12px;flex-shrink:0">
          <span style="font-size:12px;color:#888D92">模型：</span>
          <el-select v-model="activeProvider" size="small" style="width:140px">
            <el-option v-for="(p, name) in providers" :key="name" :label="name" :value="name" />
          </el-select>
          <el-select v-model="activeModel" size="small" style="width:200px">
            <el-option v-for="m in modelList" :key="m.id" :label="m.name" :value="m.id" />
          </el-select>
        </div>

        <!-- 消息列表 -->
        <div id="chat-messages" style="flex:1;overflow-y:auto;padding:16px 24px;min-height:0">
          <!-- 空状态 -->
          <div v-if="currentMessages.length===0" style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#888D92">
            <div style="font-size:48px;margin-bottom:16px"><i data-lucide="sparkles" style="width:48px;height:48px;color:#3370FF"></i></div>
            <div style="font-size:18px;font-weight:600;color:#1C1F23;margin-bottom:8px">AI 对话</div>
            <div style="font-size:14px">输入消息开始对话，支持 Markdown、代码高亮、飞书工具调用</div>
          </div>

          <!-- 消息列表 -->
          <div v-for="(msg, idx) in currentMessages" :key="idx" style="margin-bottom:16px;display:flex"
            :style="{ justifyContent: msg.role==='user' ? 'flex-end' : 'flex-start' }"
          >
            <!-- 用户消息 -->
            <div v-if="msg.role==='user'" style="max-width:70%;background:#3370FF;color:#fff;padding:10px 14px;border-radius:12px 12px 2px 12px;font-size:14px;line-height:1.6;white-space:pre-wrap">
              {{ msg.content }}
            </div>
            <!-- 工具调用卡片 -->
            <div v-else-if="msg.role==='tool_call'" style="max-width:80%;background:#FFF8E1;border:1px solid #FFE082;padding:10px 14px;border-radius:8px;font-size:13px">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                <i data-lucide="wrench" style="width:14px;height:14px;color:#F57C00"></i>
                <span style="font-weight:600;color:#E65100">正在执行：{{ msg.toolLabel }}</span>
                <span style="animation:blink 1s infinite;color:#F57C00">...</span>
              </div>
              <div style="color:#795548;font-size:12px" v-if="msg.args">{{ JSON.stringify(msg.args) }}</div>
            </div>
            <!-- 工具结果卡片 -->
            <div v-else-if="msg.role==='tool_result'" style="max-width:80%;background:#E8F5E9;border:1px solid #A5D6A7;padding:10px 14px;border-radius:8px;font-size:13px">
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                <i data-lucide="check-circle" style="width:14px;height:14px;color:#2E7D32"></i>
                <span style="font-weight:600;color:#1B5E20">完成：{{ msg.toolLabel }}</span>
              </div>
              <div style="color:#33691E;font-size:12px;max-height:150px;overflow-y:auto;white-space:pre-wrap;line-height:1.5">
                {{ msg.resultSummary || (typeof msg.result === 'object' ? JSON.stringify(msg.result).substring(0, 200) : msg.result) }}
              </div>
            </div>
            <!-- AI 消息 -->
            <div v-else style="max-width:80%;background:#F7F8FA;padding:10px 14px;border-radius:12px 12px 12px 2px;font-size:14px;line-height:1.7">
              <div v-if="!msg.content && streaming && idx===currentMessages.length-1" style="color:#888D92">
                <span style="animation:blink 1s infinite">思考中...</span>
              </div>
              <div v-else class="chat-markdown" v-html="renderMarkdown(msg.content)"></div>
              <div style="font-size:11px;color:#BBB;margin-top:4px;text-align:right">{{ formatTime(msg.timestamp) }}</div>
            </div>
          </div>
          <div id="chat-messages-end"></div>
        </div>

        <!-- 输入区域 -->
        <div style="padding:12px 24px 16px;border-top:2px solid #E6E8EA;background:#FAFBFC;flex-shrink:0">
          <div style="display:flex;gap:10px;align-items:stretch;max-width:900px;margin:0 auto">
            <el-input
              v-model="inputText"
              type="textarea"
              :rows="2"
              :autosize="{ minRows: 2, maxRows: 6 }"
              placeholder="输入消息与 AI 对话... (Enter 发送, Shift+Enter 换行)"
              :disabled="streaming"
              @keydown.enter.exact.prevent="sendMessage"
              style="flex:1"
            />
            <el-button v-if="streaming" type="danger" size="large" @click="stopStreaming" style="min-width:70px;font-size:14px">
              <i data-lucide="square" style="width:14px;height:14px;margin-right:4px"></i> 停止
            </el-button>
            <el-button v-else type="primary" size="large" @click="sendMessage" :disabled="!inputText.trim()" style="min-width:70px;font-size:14px">
              <i data-lucide="send" style="width:16px;height:16px"></i>
            </el-button>
          </div>
        </div>
      </div>

    </div>
  `
};

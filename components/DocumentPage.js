// Document Page Component - 智能文档模块（飞书文档嵌入版）
const DocumentPage = {
  name: 'DocumentPage',
  setup() {
    const { ref, onMounted, onUnmounted, nextTick } = Vue;
    const isElectron = ref(!!window.electronAPI);
    const feishuConnected = ref(false);
    const currentDocUrl = ref('');
    const currentDocToken = ref('');
    const showDocDialog = ref(false);
    const docTitle = ref('');
    const creating = ref(false);
    const recentDocs = ref([]);
    const recentDocsLoading = ref(false);
    const searchKeyword = ref('');
    const showAllDocs = ref(false);
    const selectedDocs = ref([]); // 批量选择
    const batchMode = ref(false); // 批量模式
    
    // 文档分类选项
    const docCategories = [
      { value: 'all', label: '全部' },
      { value: 'report', label: '📊 报告' },
      { value: 'meeting', label: '📝 会议记录' },
      { value: 'plan', label: '📑 方案' },
      { value: 'other', label: '📄 其他' }
    ];
    const activeCategory = ref('all');
    
    // 按日期分组的文档
    const groupedDocs = Vue.computed(() => {
      let docs = recentDocs.value;
      
      // 搜索过滤
      if (searchKeyword.value) {
        const keyword = searchKeyword.value.toLowerCase();
        docs = docs.filter(doc => doc.title.toLowerCase().includes(keyword));
      }
      
      // 分类过滤
      if (activeCategory.value !== 'all') {
        docs = docs.filter(doc => doc.category === activeCategory.value);
      }
      
      // 固定的排在前面
      docs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
      
      // 按日期分组
      const today = dayjs().startOf('day');
      const weekStart = dayjs().startOf('week');
      
      const groups = {
        today: [],
        thisWeek: [],
        earlier: []
      };
      
      docs.forEach(doc => {
        const docTime = dayjs(doc.time);
        if (docTime.isAfter(today)) {
          groups.today.push(doc);
        } else if (docTime.isAfter(weekStart)) {
          groups.thisWeek.push(doc);
        } else {
          groups.earlier.push(doc);
        }
      });
      
      return groups;
    });
    
    // 过滤后的文档（兼容旧代码）
    const filteredRecentDocs = Vue.computed(() => {
      let docs = recentDocs.value;
      if (searchKeyword.value) {
        const keyword = searchKeyword.value.toLowerCase();
        docs = docs.filter(doc => doc.title.toLowerCase().includes(keyword));
      }
      docs.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
      return showAllDocs.value ? docs : docs.slice(0, 5);
    });
    
    // AI写作模式
    const aiMode = ref('normal'); // normal, pyramid, ppt
    const aiProcessing = ref(false);
    const showPyramidDialog = ref(false);
    const showPptDialog = ref(false);
    
    // 金字塔原理相关
    const pyramidStep = ref(1);
    const pyramidAudience = ref('');
    const pyramidConclusion = ref('');
    const pyramidPurpose = ref('');
    
    // PPT相关
    const pptContent = ref('');
    const pptSettings = ref({
      scene: '',
      audience: '',
      keyPoints: '',
      pageCount: '8-10',
      style: '大字少话',
      color: '科技蓝',
      needTransition: true,
      needSummary: true
    });

    // 检查飞书连接
    const checkFeishu = async () => {
      try {
        feishuConnected.value = await WBFeishu.checkConnection();
      } catch (e) {
        feishuConnected.value = false;
      }
    };

    // 创建新文档
    const createNewDoc = async () => {
      if (!feishuConnected.value) {
        ElementPlus.ElMessage.error('飞书未连接，请先启动 server.js 并登录飞书');
        return;
      }

      creating.value = true;
      try {
        const title = docTitle.value || '新文档-' + dayjs().format('MMDD-HHmm');
        const result = await WBFeishu.createDoc(title, '');
        
        if (result && (result.token || result.doc_token)) {
          const token = result.token || result.doc_token;
          const url = result.url || WBFeishu.getWebUrl('docx', token);
          
          currentDocToken.value = token;
          currentDocUrl.value = url;
          showDocDialog.value = false;
          docTitle.value = '';
          
          // 添加到最近文档
          addToRecentDocs(title, token, url);
          
          ElementPlus.ElMessage.success('文档创建成功');
        }
      } catch (e) {
        console.error('创建文档失败:', e);
        ElementPlus.ElMessage.error('创建文档失败：' + e.message);
      }
      creating.value = false;
    };

    // 打开已有文档
    const openDoc = (url, token) => {
      currentDocUrl.value = url;
      if (token) currentDocToken.value = token;
    };

    // 关闭飞书文档视图
    const closeDoc = () => {
      currentDocUrl.value = '';
    };

    // 在新窗口打开飞书文档
    const openInNewWindow = () => {
      if (currentDocUrl.value) {
        window.open(currentDocUrl.value, '_blank');
      }
    };

    // 加载最近文档
    const loadRecentDocs = () => {
      const docs = WBStorage.get('recent-feishu-docs', []);
      recentDocs.value = docs;
    };

    // 刷新最近文档
    const refreshRecentDocs = async () => {
      if (!feishuConnected.value) {
        ElementPlus.ElMessage.warning('飞书未连接');
        return;
      }
      
      recentDocsLoading.value = true;
      try {
        const updatedDocs = [];
        for (const doc of recentDocs.value) {
          try {
            const docInfo = await WBFeishu.fetchDoc(doc.token);
            if (docInfo) {
              updatedDocs.push({
                ...doc,
                title: docInfo.title || doc.title,
                lastModified: docInfo.modified_time || doc.time
              });
            } else {
              updatedDocs.push(doc);
            }
          } catch (e) {
            // 文档可能已删除，保留原记录
            updatedDocs.push(doc);
          }
        }
        recentDocs.value = updatedDocs;
        WBStorage.set('recent-feishu-docs', recentDocs.value);
        ElementPlus.ElMessage.success('刷新完成');
      } catch (e) {
        console.error('刷新失败:', e);
        ElementPlus.ElMessage.error('刷新失败');
      }
      recentDocsLoading.value = false;
    };

    // 从最近文档中移除
    const removeFromRecentDocs = (token) => {
      recentDocs.value = recentDocs.value.filter(doc => doc.token !== token);
      WBStorage.set('recent-feishu-docs', recentDocs.value);
      ElementPlus.ElMessage.success('已移除');
    };

    // 清空最近文档
    const clearRecentDocs = () => {
      ElementPlus.ElMessageBox.confirm(
        '确定要清空最近文档列表吗？',
        '确认清空',
        { confirmButtonText: '清空', cancelButtonText: '取消', type: 'warning' }
      ).then(() => {
        recentDocs.value = [];
        WBStorage.set('recent-feishu-docs', []);
        ElementPlus.ElMessage.success('已清空');
      }).catch(() => {});
    };

    // 固定/取消固定文档
    const togglePinDoc = (token) => {
      const doc = recentDocs.value.find(d => d.token === token);
      if (doc) {
        doc.pinned = !doc.pinned;
        WBStorage.set('recent-feishu-docs', recentDocs.value);
      }
    };

    // 切换批量模式
    const toggleBatchMode = () => {
      batchMode.value = !batchMode.value;
      if (!batchMode.value) {
        selectedDocs.value = [];
      }
    };

    // 选择/取消选择文档
    const toggleSelectDoc = (token) => {
      const index = selectedDocs.value.indexOf(token);
      if (index === -1) {
        selectedDocs.value.push(token);
      } else {
        selectedDocs.value.splice(index, 1);
      }
    };

    // 全选/取消全选
    const toggleSelectAll = () => {
      const allDocs = recentDocs.value;
      if (selectedDocs.value.length === allDocs.length) {
        selectedDocs.value = [];
      } else {
        selectedDocs.value = allDocs.map(d => d.token);
      }
    };

    // 批量删除
    const batchDelete = () => {
      if (selectedDocs.value.length === 0) {
        ElementPlus.ElMessage.warning('请先选择要删除的文档');
        return;
      }
      
      ElementPlus.ElMessageBox.confirm(
        `确定要删除选中的 ${selectedDocs.value.length} 个文档吗？`,
        '批量删除',
        { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
      ).then(() => {
        recentDocs.value = recentDocs.value.filter(doc => !selectedDocs.value.includes(doc.token));
        WBStorage.set('recent-feishu-docs', recentDocs.value);
        selectedDocs.value = [];
        batchMode.value = false;
        ElementPlus.ElMessage.success('批量删除完成');
      }).catch(() => {});
    };

    // 设置文档分类
    const setDocCategory = (token, category) => {
      const doc = recentDocs.value.find(d => d.token === token);
      if (doc) {
        doc.category = category;
        WBStorage.set('recent-feishu-docs', recentDocs.value);
      }
    };

    // 快捷键处理
    const handleKeydown = (e) => {
      // Ctrl+F 聚焦搜索框
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        const searchInput = document.querySelector('.recent-docs-search input');
        if (searchInput) {
          searchInput.focus();
        }
      }
      // Escape 退出批量模式
      if (e.key === 'Escape' && batchMode.value) {
        batchMode.value = false;
        selectedDocs.value = [];
      }
    };

    // 添加到最近文档时自动分类
    const addToRecentDocs = (title, token, url) => {
      // 自动分类
      let category = 'other';
      const titleLower = title.toLowerCase();
      if (titleLower.includes('报告') || titleLower.includes('周报') || titleLower.includes('月报') || titleLower.includes('日报')) {
        category = 'report';
      } else if (titleLower.includes('会议') || titleLower.includes('纪要')) {
        category = 'meeting';
      } else if (titleLower.includes('方案') || titleLower.includes('计划')) {
        category = 'plan';
      }
      
      const doc = { 
        title, 
        token, 
        url, 
        time: dayjs().format('YYYY-MM-DD HH:mm'),
        category,
        pinned: false
      };
      
      recentDocs.value.unshift(doc);
      if (recentDocs.value.length > 20) {
        recentDocs.value.pop();
      }
      WBStorage.set('recent-feishu-docs', recentDocs.value);
    };

    // 获取分类图标
    const getCategoryIcon = (category) => {
      const icons = {
        report: '📊',
        meeting: '📝',
        plan: '📑',
        other: '📄'
      };
      return icons[category] || '📄';
    };

    // 获取分类名称
    const getCategoryName = (category) => {
      const names = {
        report: '报告',
        meeting: '会议记录',
        plan: '方案',
        other: '其他'
      };
      return names[category] || '其他';
    };

    // 从URL获取文档token
    const getTokenFromUrl = (url) => {
      const match = url.match(/\/(?:docx|wiki)\/([a-zA-Z0-9]+)/);
      return match ? match[1] : null;
    };

    // 导入飞书文档
    const importFromFeishu = async () => {
      const { value: url } = await ElementPlus.ElMessageBox.prompt(
        '请输入飞书文档URL',
        '导入飞书文档',
        {
          confirmButtonText: '导入',
          cancelButtonText: '取消',
          inputPlaceholder: 'https://feishu.cn/docx/xxx 或 https://feishu.cn/wiki/xxx'
        }
      );
      
      if (url) {
        const token = getTokenFromUrl(url);
        if (token) {
          currentDocUrl.value = url;
          currentDocToken.value = token;
          // 获取文档实际标题
          let title = '';
          try {
            const doc = await WBFeishu.fetchDoc(token);
            if (doc && doc.title) title = doc.title;
          } catch {}
          // fetchDoc 可能返回空标题，尝试从文档内容提取
          if (!title) {
            try {
              const doc = await WBFeishu.fetchDoc(token);
              const content = doc?.markdown || doc?.content || '';
              const firstLine = content.split('\n').find(l => l.trim().replace(/^#+\s*/, ''));
              if (firstLine) title = firstLine.trim().replace(/^#+\s*/, '').substring(0, 50);
            } catch {}
          }
          if (!title) title = '导入的文档';
          addToRecentDocs(title, token, url);
          ElementPlus.ElMessage.success('文档导入成功');
        } else {
          ElementPlus.ElMessage.error('无效的飞书文档URL');
        }
      }
    };

    // AI整理文档（从飞书读取内容，AI整理后覆盖或新建）
    const aiOrganize = async () => {
      if (!currentDocToken.value) {
        ElementPlus.ElMessage.warning('请先打开或创建一个飞书文档');
        return;
      }

      const provider = WBStorage.getActiveProvider();
      if (!provider || !provider.apiKey) {
        ElementPlus.ElMessage.error('请先在设置中配置 AI Provider');
        return;
      }

      // 询问覆盖还是新建
      let saveMode;
      try {
        const result = await ElementPlus.ElMessageBox.confirm(
          'AI整理完成后，如何保存？',
          '保存方式',
          {
            confirmButtonText: '覆盖原文档',
            cancelButtonText: '新建文档',
            distinguishCancelAndClose: true,
            type: 'info',
          }
        );
        saveMode = 'overwrite';
      } catch (action) {
        if (action === 'cancel') {
          saveMode = 'new';
        } else {
          return; // 用户关闭对话框
        }
      }

      let loading = null;
      try {
        loading = ElementPlus.ElLoading.service({
          lock: true,
          text: '正在读取文档内容...',
          background: 'rgba(0, 0, 0, 0.7)'
        });

        const docContent = await WBFeishu.fetchDoc(currentDocToken.value);
        if (!docContent || !docContent.markdown) {
          ElementPlus.ElMessage.error('无法读取文档内容');
          return;
        }

        loading.setText('AI正在整理文档...');
        const organized = await WBAI.organizeDocument(docContent.markdown, 'pyramid');

        if (saveMode === 'overwrite') {
          loading.setText('正在覆盖原文档...');
          await WBFeishu.updateDoc(currentDocToken.value, 'overwrite', organized);
          loading.close();
          loading = null;
          ElementPlus.ElMessage.success('AI整理完成，原文档已覆盖');
        } else {
          loading.setText('正在创建新文档...');
          const title = 'AI整理 - ' + (docContent.title || '未命名文档');
          const result = await WBFeishu.createDoc(title, organized);
          loading.close();
          loading = null;
          const token = result?.token || result?.doc_token;
          if (token) {
            const url = result.url || WBFeishu.getWebUrl('docx', token);
            currentDocToken.value = token;
            currentDocUrl.value = url;
            addToRecentDocs(title, token, url);
            ElementPlus.ElMessage.success('AI整理完成，已打开新文档');
          } else {
            ElementPlus.ElMessage.success('AI整理完成，新文档已创建');
          }
        }
      } catch (e) {
        console.error('AI整理失败:', e);
        ElementPlus.ElMessage.error('AI整理失败：' + e.message);
      } finally {
        if (loading) loading.close();
      }
    };

    // 金字塔原理写作
    const startPyramidWriting = () => {
      pyramidStep.value = 1;
      pyramidAudience.value = '';
      pyramidConclusion.value = '';
      pyramidPurpose.value = '';
      showPyramidDialog.value = true;
    };

    const nextPyramidStep = () => {
      if (pyramidStep.value === 1 && !pyramidAudience.value) {
        ElementPlus.ElMessage.warning('请先回答受众问题');
        return;
      }
      if (pyramidStep.value === 2 && !pyramidConclusion.value) {
        ElementPlus.ElMessage.warning('请先输入核心结论');
        return;
      }
      pyramidStep.value++;
    };

    const generatePyramidDoc = async () => {
      const provider = WBStorage.getActiveProvider();
      if (!provider || !provider.apiKey) {
        ElementPlus.ElMessage.error('请先在设置中配置 AI Provider');
        return;
      }

      aiProcessing.value = true;
      let loading = null;
      try {
        loading = ElementPlus.ElLoading.service({
          lock: true,
          text: 'AI正在按金字塔原理撰写文档...',
          background: 'rgba(0, 0, 0, 0.7)'
        });

        const prompt = `请按金字塔原理撰写一篇飞书文档。

受众：${pyramidAudience.value}
核心结论：${pyramidConclusion.value}
写作目的：${pyramidPurpose.value || '传达结论'}

要求：
1. 结论先行：核心结论放在最前面，用callout块突出
2. 以上统下：每个论点都是其下层内容的总结
3. 归类分组（MECE）：论点相互独立，覆盖完整
4. 逻辑递进：按重要性/时间/逻辑排列
5. 使用SCQA框架：情境-冲突-问题-答案
6. 输出飞书扩展Markdown格式（使用callout、表格等）

请直接输出完整的文档内容。`;

        let result = await WBAI.call(prompt, '你是专业的文档写作专家，擅长金字塔原理写作。');

        loading.setText('正在创建飞书文档...');

        // 去掉AI可能返回的代码块包裹
        result = result.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

        // 创建新文档
        const title = '金字塔文档-' + dayjs().format('MMDD-HHmm');
        const createResult = await WBFeishu.createDoc(title, result);
        
        if (createResult && (createResult.token || createResult.doc_token)) {
          const token = createResult.token || createResult.doc_token;
          const url = createResult.url || WBFeishu.getWebUrl('docx', token);
          
          currentDocToken.value = token;
          currentDocUrl.value = url;
          addToRecentDocs(title, token, url);
          
          showPyramidDialog.value = false;
          loading.close();
          loading = null;
          ElementPlus.ElMessage.success('金字塔文档生成成功');
        }
      } catch (e) {
        console.error('生成失败:', e);
        ElementPlus.ElMessage.error('生成失败：' + e.message);
      } finally {
        if (loading) loading.close();
        aiProcessing.value = false;
      }
    };

    // 文档转PPT
    const startDocToPpt = () => {
      showPptDialog.value = true;
    };

    const generatePpt = async () => {
      const provider = WBStorage.getActiveProvider();
      if (!provider || !provider.apiKey) {
        ElementPlus.ElMessage.error('请先在设置中配置 AI Provider');
        return;
      }

      // 获取文档内容
      let content = pptContent.value;
      if (!content && currentDocToken.value) {
        try {
          const docContent = await WBFeishu.fetchDoc(currentDocToken.value);
          if (docContent && docContent.markdown) {
            content = docContent.markdown;
          }
        } catch (e) {
          console.error('读取文档失败:', e);
        }
      }

      if (!content) {
        ElementPlus.ElMessage.warning('请先输入内容或打开飞书文档');
        return;
      }

      aiProcessing.value = true;
      let loading = null;
      try {
        loading = ElementPlus.ElLoading.service({
          lock: true,
          text: 'AI正在生成HTML幻灯片...',
          background: 'rgba(0, 0, 0, 0.7)'
        });

        const prompt = `请将以下文档内容转换为HTML幻灯片。

文档内容：
${content}

要求：
1. 场景：${pptSettings.value.scene || '内部汇报'}
2. 受众：${pptSettings.value.audience || '管理层'}
3. 核心点：${pptSettings.value.keyPoints || '自动提取'}
4. 页数：${pptSettings.value.pageCount}页
5. 风格：${pptSettings.value.style}
6. 配色：${pptSettings.value.color}
7. 翻页特效：${pptSettings.value.needTransition ? '是' : '否'}
8. 金句总结：${pptSettings.value.needSummary ? '是' : '否'}

请生成完整的HTML幻灯片代码，要求：
- 使用现代CSS样式
- 支持键盘翻页（左右箭头）
- 响应式布局
- 美观的视觉效果
- 每页内容精炼，突出重点

请直接输出完整的HTML代码。`;

        loading.setText('AI正在生成幻灯片...');
        let result;
        try {
          result = await WBAI.call(prompt, '你是专业的PPT设计专家，擅长将文档转换为精美的HTML幻灯片。');
        } catch (e) {
          throw new Error('AI生成失败：' + (WBAI.getErrorMessage(e) || e.message));
        }

        if (!result || result.length < 50) {
          throw new Error('AI返回内容为空或过短，请重试');
        }

        loading.setText('正在创建飞书文档...');

        // 去掉AI可能返回的代码块包裹，再重新包裹
        result = result.replace(/^```(?:html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

        // 创建新文档保存PPT代码
        const title = 'HTML幻灯片-' + dayjs().format('MMDD-HHmm');
        const docContent = '```html\n' + result + '\n```\n\n## 使用说明\n\n1. 复制上面的HTML代码\n2. 保存为 `.html` 文件\n3. 用浏览器打开即可演示\n4. 使用左右箭头键翻页';

        let createResult;
        try {
          createResult = await WBFeishu.createDoc(title, docContent);
        } catch (e) {
          throw new Error('创建飞书文档失败：' + e.message);
        }
        
        if (createResult && (createResult.token || createResult.doc_token)) {
          const token = createResult.token || createResult.doc_token;
          const url = createResult.url || WBFeishu.getWebUrl('docx', token);
          
          currentDocToken.value = token;
          currentDocUrl.value = url;
          addToRecentDocs(title, token, url);
          
          showPptDialog.value = false;
          loading.close();
          loading = null;
          ElementPlus.ElMessage.success('HTML幻灯片生成成功');
        }
      } catch (e) {
        console.error('生成失败:', e);
        ElementPlus.ElMessage.error('生成失败：' + e.message);
      } finally {
        if (loading) loading.close();
        aiProcessing.value = false;
      }
    };

    // 监听飞书连接成功事件
    window.addEventListener('feishu-connected', () => {
      feishuConnected.value = true;
    });

    // 监听数据刷新事件（AI 创建文档后同步）
    const onDashboardRefreshed = () => { loadRecentDocs(); };
    window.addEventListener('dashboard-refreshed', onDashboardRefreshed);

    onMounted(async () => {
      await checkFeishu();
      loadRecentDocs();
      // 添加快捷键监听
      document.addEventListener('keydown', handleKeydown);
      nextTick(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); });
      // Watch for data changes to re-render Lucide icons
      Vue.watch([recentDocs, batchMode, currentDocUrl, feishuConnected], () => {
        nextTick(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); });
      });
    });

    onUnmounted(() => {
      document.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('dashboard-refreshed', onDashboardRefreshed);
    });

    return {
      isElectron, feishuConnected, currentDocUrl, currentDocToken,
      showDocDialog, docTitle, creating,
      recentDocs, recentDocsLoading, searchKeyword, showAllDocs, filteredRecentDocs,
      selectedDocs, batchMode, docCategories, activeCategory, groupedDocs,
      aiMode, aiProcessing,
      showPyramidDialog, pyramidStep, pyramidAudience, pyramidConclusion, pyramidPurpose,
      showPptDialog, pptContent, pptSettings,
      createNewDoc, openDoc, closeDoc, openInNewWindow,
      importFromFeishu, aiOrganize,
      startPyramidWriting, nextPyramidStep, generatePyramidDoc,
      startDocToPpt, generatePpt,
      refreshRecentDocs, removeFromRecentDocs, clearRecentDocs, togglePinDoc,
      toggleBatchMode, toggleSelectDoc, toggleSelectAll, batchDelete,
      setDocCategory, getCategoryIcon, getCategoryName
    };
  },
  template: `
    <div class="fade-in">
      <div style="display:flex;justify-content:flex-end;align-items:center;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:8px">
          <el-tag :type="feishuConnected ? 'success' : 'danger'" size="small">
            {{ feishuConnected ? '✓ 飞书已连接' : '✕ 飞书未连接' }}
          </el-tag>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:240px 1fr;gap:20px">
        <!-- 左侧：操作面板 -->
        <div>
          <!-- 新建文档 -->
          <div class="content-card" style="margin-bottom:16px">
            <div class="card-title" style="margin-bottom:12px"><i data-lucide="file-plus" style="width:16px;height:16px"></i> 新建文档</div>
            <el-input
              v-model="docTitle"
              placeholder="输入文档标题"
              style="margin-bottom:12px"
            />
            <el-button
              type="primary"
              style="width:100%"
              @click="createNewDoc"
              :loading="creating"
              :disabled="!feishuConnected"
            >
              创建飞书文档
            </el-button>
          </div>

          <!-- 导入文档 -->
          <div class="content-card" style="margin-bottom:16px">
            <div class="card-title" style="margin-bottom:12px"><i data-lucide="download" style="width:16px;height:16px"></i> 导入文档</div>
            <el-button
              style="width:100%"
              @click="importFromFeishu"
              :disabled="!feishuConnected"
            >
              从飞书导入
            </el-button>
          </div>

          <!-- AI整理 -->
          <div class="content-card" style="margin-bottom:16px">
            <div class="card-title" style="margin-bottom:12px"><i data-lucide="sparkles" style="width:16px;height:16px"></i> AI功能</div>
            <div style="display:flex;flex-direction:column;gap:8px">
              <button
                @click="aiOrganize"
                :disabled="!currentDocToken"
                class="ai-action-btn success"
              >
                <i data-lucide="wand-2" style="width:14px;height:14px"></i> AI一键整理文档
              </button>
              <button
                @click="startPyramidWriting"
                :disabled="!feishuConnected"
                class="ai-action-btn primary"
              >
                <i data-lucide="triangle" style="width:14px;height:14px"></i> 金字塔原理写作
              </button>
              <button
                @click="startDocToPpt"
                :disabled="!feishuConnected"
                class="ai-action-btn warning"
              >
                <i data-lucide="presentation" style="width:14px;height:14px"></i> 文档转HTML PPT
              </button>
            </div>
          </div>

          <!-- 最近文档 -->
          <div class="content-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <span style="font-size:14px;font-weight:600;color:#1C1F23">最近文档</span>
              <div style="display:flex;gap:8px;align-items:center">
                <el-tooltip content="刷新" placement="top">
                  <el-button size="small" circle @click="refreshRecentDocs" :loading="recentDocsLoading">
                    <i data-lucide="refresh-cw" style="width:14px;height:14px"></i>
                  </el-button>
                </el-tooltip>
                <el-tooltip :content="batchMode ? '退出批量' : '批量操作'" placement="top">
                  <el-button size="small" circle @click="toggleBatchMode" :type="batchMode ? 'primary' : ''">
                    <i data-lucide="check-square" style="width:14px;height:14px"></i>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="清空列表" placement="top">
                  <el-button size="small" circle @click="clearRecentDocs" :disabled="recentDocs.length===0">
                    <i data-lucide="trash-2" style="width:14px;height:14px"></i>
                  </el-button>
                </el-tooltip>
              </div>
            </div>
            
            <!-- 搜索框 -->
            <el-input
              v-model="searchKeyword"
              placeholder="搜索文档... (Ctrl+F)"
              size="small"
              clearable
              class="recent-docs-search"
              style="margin-bottom:12px"
            />
            
            <!-- 分类筛选 -->
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px">
              <el-tag
                v-for="cat in docCategories"
                :key="cat.value"
                :type="activeCategory === cat.value ? 'primary' : 'info'"
                size="small"
                style="cursor:pointer"
                @click="activeCategory = cat.value"
              >
                {{ cat.label }}
              </el-tag>
            </div>
            
            <!-- 批量操作栏 -->
            <div v-if="batchMode" style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:#E8EDFF;border-radius:6px;margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:8px">
                <el-checkbox
                  :model-value="selectedDocs.length === recentDocs.length && recentDocs.length > 0"
                  @change="toggleSelectAll"
                  label="全选"
                />
                <span style="font-size:12px;color:#555B61">已选 {{ selectedDocs.length }} 项</span>
              </div>
              <el-button size="small" type="danger" @click="batchDelete" :disabled="selectedDocs.length===0">
                删除选中
              </el-button>
            </div>
            
            <!-- 今日文档 -->
            <div v-if="groupedDocs.today.length > 0" style="margin-bottom:12px">
              <div style="font-size:12px;color:#888D92;margin-bottom:8px"><i data-lucide="calendar" style="width:14px;height:14px"></i> 今日</div>
              <div v-for="doc in groupedDocs.today" :key="doc.token"
                style="padding:8px 0;border-bottom:1px solid #F0F1F5;position:relative"
                :style="{background: doc.pinned ? '#E8EDFF' : 'transparent'}"
              >
                <div style="display:flex;align-items:flex-start;gap:8px">
                  <!-- 批量选择框 -->
                  <el-checkbox v-if="batchMode" :model-value="selectedDocs.includes(doc.token)" @change="toggleSelectDoc(doc.token)" />
                  
                  <!-- 分类图标 -->
                  <span style="font-size:14px;cursor:pointer" :title="getCategoryName(doc.category)">
                    {{ getCategoryIcon(doc.category) }}
                  </span>
                  
                  <!-- 固定图标 -->
                  <span v-if="doc.pinned" style="color:#3370FF;font-size:12px;cursor:pointer" @click="togglePinDoc(doc.token)"><i data-lucide="pin" style="width:14px;height:14px"></i></span>
                  
                  <!-- 文档信息 -->
                  <div style="flex:1;min-width:0;cursor:pointer" @click="openDoc(doc.url, doc.token)">
                    <div style="font-size:14px;font-weight:500;color:#1C1F23;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                      {{ doc.title }}
                    </div>
                    <div style="font-size:12px;color:#888D92">{{ doc.time }}</div>
                  </div>
                  
                  <!-- 操作按钮 -->
                  <div v-if="!batchMode" style="display:flex;gap:4px;flex-shrink:0">
                    <el-button size="small" link @click.stop="togglePinDoc(doc.token)" :title="doc.pinned ? '取消固定' : '固定'">
                      <i :data-lucide="doc.pinned ? 'pin-off' : 'pin'" style="width:14px;height:14px"></i>
                    </el-button>
                    <el-button size="small" link type="danger" @click.stop="removeFromRecentDocs(doc.token)" title="移除">
                      ✕
                    </el-button>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- 本周文档 -->
            <div v-if="groupedDocs.thisWeek.length > 0" style="margin-bottom:12px">
              <div style="font-size:12px;color:#888D92;margin-bottom:8px"><i data-lucide="calendar" style="width:14px;height:14px"></i> 本周</div>
              <div v-for="doc in groupedDocs.thisWeek" :key="doc.token"
                style="padding:8px 0;border-bottom:1px solid #F0F1F5;position:relative"
                :style="{background: doc.pinned ? '#E8EDFF' : 'transparent'}"
              >
                <div style="display:flex;align-items:flex-start;gap:8px">
                  <el-checkbox v-if="batchMode" :model-value="selectedDocs.includes(doc.token)" @change="toggleSelectDoc(doc.token)" />
                  <span style="font-size:14px;cursor:pointer" :title="getCategoryName(doc.category)">{{ getCategoryIcon(doc.category) }}</span>
                  <span v-if="doc.pinned" style="color:#3370FF;font-size:12px;cursor:pointer" @click="togglePinDoc(doc.token)"><i data-lucide="pin" style="width:14px;height:14px"></i></span>
                  <div style="flex:1;min-width:0;cursor:pointer" @click="openDoc(doc.url, doc.token)">
                    <div style="font-size:14px;font-weight:500;color:#1C1F23;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ doc.title }}</div>
                    <div style="font-size:12px;color:#888D92">{{ doc.time }}</div>
                  </div>
                  <div v-if="!batchMode" style="display:flex;gap:4px;flex-shrink:0">
                    <el-button size="small" link @click.stop="togglePinDoc(doc.token)"><i :data-lucide="doc.pinned ? 'pin-off' : 'pin'" style="width:14px;height:14px"></i></el-button>
                    <el-button size="small" link type="danger" @click.stop="removeFromRecentDocs(doc.token)">✕</el-button>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- 更早文档 -->
            <div v-if="groupedDocs.earlier.length > 0">
              <div style="font-size:12px;color:#888D92;margin-bottom:8px"><i data-lucide="calendar" style="width:14px;height:14px"></i> 更早</div>
              <div v-for="doc in (showAllDocs ? groupedDocs.earlier : groupedDocs.earlier.slice(0, 3))" :key="doc.token"
                style="padding:8px 0;border-bottom:1px solid #F0F1F5;position:relative"
                :style="{background: doc.pinned ? '#E8EDFF' : 'transparent'}"
              >
                <div style="display:flex;align-items:flex-start;gap:8px">
                  <el-checkbox v-if="batchMode" :model-value="selectedDocs.includes(doc.token)" @change="toggleSelectDoc(doc.token)" />
                  <span style="font-size:14px;cursor:pointer" :title="getCategoryName(doc.category)">{{ getCategoryIcon(doc.category) }}</span>
                  <span v-if="doc.pinned" style="color:#3370FF;font-size:12px;cursor:pointer" @click="togglePinDoc(doc.token)"><i data-lucide="pin" style="width:14px;height:14px"></i></span>
                  <div style="flex:1;min-width:0;cursor:pointer" @click="openDoc(doc.url, doc.token)">
                    <div style="font-size:14px;font-weight:500;color:#1C1F23;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ doc.title }}</div>
                    <div style="font-size:12px;color:#888D92">{{ doc.time }}</div>
                  </div>
                  <div v-if="!batchMode" style="display:flex;gap:4px;flex-shrink:0">
                    <el-button size="small" link @click.stop="togglePinDoc(doc.token)"><i :data-lucide="doc.pinned ? 'pin-off' : 'pin'" style="width:14px;height:14px"></i></el-button>
                    <el-button size="small" link type="danger" @click.stop="removeFromRecentDocs(doc.token)">✕</el-button>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- 空状态 -->
            <div v-if="filteredRecentDocs.length === 0" style="text-align:center;padding:16px;color:#888D92">
              {{ searchKeyword ? '没有匹配的文档' : '暂无最近文档' }}
            </div>
            
            <!-- 显示更多/收起 -->
            <div v-if="groupedDocs.earlier.length > 3" style="text-align:center;margin-top:8px">
              <el-button link type="primary" size="small" @click="showAllDocs = !showAllDocs">
                {{ showAllDocs ? '收起' : '显示全部 (' + recentDocs.length + ')' }}
              </el-button>
            </div>
          </div>
        </div>

        <!-- 右侧：飞书文档编辑区 -->
        <div>
          <div class="content-card" style="padding:0;overflow:hidden">
            <!-- 文档操作栏 -->
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#F7F8FA;border-bottom:1px solid #E6E8EA">
              <div style="font-size:14px;font-weight:500;color:#1C1F23">
                <i data-lucide="file-text" style="width:16px;height:16px"></i> {{ currentDocUrl ? '飞书文档编辑' : '飞书文档' }}
              </div>
              <div style="display:flex;gap:8px">
                <el-button v-if="currentDocUrl" size="small" @click="openInNewWindow">
                  <i data-lucide="external-link" style="width:14px;height:14px"></i> 在新窗口打开
                </el-button>
                <el-button v-if="currentDocUrl" size="small" @click="currentDocUrl=''">
                  ✕ 关闭文档
                </el-button>
              </div>
            </div>

            <!-- 飞书文档（浏览器: iframe / Electron: webview） -->
            <div v-if="currentDocUrl" style="height:calc(100vh - 200px);min-height:600px">
              <iframe v-if="!isElectron" :src="currentDocUrl" style="width:100%;height:100%;border:none" allow="clipboard-read;clipboard-write"></iframe>
              <webview v-else :src="currentDocUrl" style="width:100%;height:100%" allowpopups></webview>
            </div>

            <!-- 空状态 -->
            <div v-else style="height:calc(100vh - 200px);min-height:600px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#F7F8FA">
              <div style="font-size:64px;margin-bottom:16px"><i data-lucide="file-pen-line" style="width:48px;height:48px"></i></div>
              <div style="font-size:18px;font-weight:600;color:#1C1F23;margin-bottom:8px">开始撰写文档</div>
              <div style="font-size:14px;color:#888D92;margin-bottom:24px;text-align:center;line-height:1.6">
                创建新的飞书文档，或从最近文档中打开<br>
                支持所有飞书文档功能：表格、图片、@提及等
              </div>
              <div style="display:flex;gap:12px">
                <el-button type="primary" @click="showDocDialog=true" :disabled="!feishuConnected">
                  <i data-lucide="file-plus" style="width:14px;height:14px"></i> 创建新文档
                </el-button>
                <el-button @click="importFromFeishu" :disabled="!feishuConnected">
                  <i data-lucide="download" style="width:14px;height:14px"></i> 导入已有文档
                </el-button>
              </div>
            </div>
          </div>

          <!-- 使用提示 -->
          <div class="content-card" style="margin-top:16px">
            <div class="card-title" style="margin-bottom:8px"><i data-lucide="lightbulb" style="width:16px;height:16px"></i> 使用提示</div>
            <div style="font-size:13px;color:#555B61;line-height:1.8">
              <ul style="margin:0;padding-left:20px">
                <li><strong>创建文档</strong>：点击左侧"创建飞书文档"按钮</li>
                <li><strong>编辑文档</strong>：直接在右侧飞书编辑器中编辑</li>
                <li><strong>表格图片</strong>：支持所有飞书原生功能</li>
                <li><strong>AI整理</strong>：点击"AI一键整理"自动优化文档结构</li>
                <li><strong>新窗口打开</strong>：点击"在新窗口打开"获得完整编辑体验</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <!-- 创建文档弹窗 -->
      <el-dialog v-model="showDocDialog" title="创建飞书文档" width="400px">
        <el-form label-width="80px">
          <el-form-item label="文档标题">
            <el-input v-model="docTitle" placeholder="请输入文档标题" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showDocDialog=false">取消</el-button>
          <el-button type="primary" @click="createNewDoc" :loading="creating">创建</el-button>
        </template>
      </el-dialog>

      <!-- 金字塔原理写作弹窗 -->
      <el-dialog v-model="showPyramidDialog" width="600px"><template #header><span><i data-lucide="triangle" style="width:16px;height:16px"></i> 金字塔原理写作</span></template>
        <div v-if="pyramidStep===1">
          <h4 style="margin-bottom:12px">第一步：明确受众</h4>
          <p style="color:#555B61;margin-bottom:16px">这篇文档主要给谁看？是需要做决策的（比如老板、评审委员会），还是需要执行的（比如工程师、分析师）？</p>
          <el-input
            v-model="pyramidAudience"
            type="textarea"
            :rows="3"
            placeholder="例如：给技术总监看，需要他审批项目方案..."
          />
        </div>
        <div v-if="pyramidStep===2">
          <h4 style="margin-bottom:12px">第二步：核心结论</h4>
          <p style="color:#555B61;margin-bottom:16px">整篇文档最重要的一句话是什么？请用一个完整的判断句表达。</p>
          <el-input
            v-model="pyramidConclusion"
            type="textarea"
            :rows="3"
            placeholder="例如：建议采用方案A，因为成本低30%且风险可控..."
          />
        </div>
        <div v-if="pyramidStep===3">
          <h4 style="margin-bottom:12px">第三步：写作目的（可选）</h4>
          <p style="color:#555B61;margin-bottom:16px">这篇文档是为了说服对方接受结论，还是传递分析过程，还是推动具体决策？</p>
          <el-input
            v-model="pyramidPurpose"
            type="textarea"
            :rows="3"
            placeholder="例如：说服评审委员会批准预算..."
          />
        </div>
        <template #footer>
          <el-button v-if="pyramidStep>1" @click="pyramidStep--">上一步</el-button>
          <el-button v-if="pyramidStep<3" type="primary" @click="nextPyramidStep">下一步</el-button>
          <el-button v-if="pyramidStep===3" type="primary" @click="generatePyramidDoc" :loading="aiProcessing">
            生成文档
          </el-button>
        </template>
      </el-dialog>

      <!-- 文档转PPT弹窗 -->
      <el-dialog v-model="showPptDialog" width="600px"><template #header><span><i data-lucide="presentation" style="width:16px;height:16px"></i> 文档转HTML PPT</span></template>
        <el-form label-width="100px">
          <el-form-item label="文档内容">
            <el-input
              v-model="pptContent"
              type="textarea"
              :rows="4"
              placeholder="粘贴文档内容，或留空使用当前打开的飞书文档"
            />
          </el-form-item>
          <el-form-item label="使用场景">
            <el-select v-model="pptSettings.scene" placeholder="选择场景">
              <el-option label="内部汇报" value="内部汇报" />
              <el-option label="客户提案" value="客户提案" />
              <el-option label="产品发布" value="产品发布" />
              <el-option label="培训分享" value="培训分享" />
            </el-select>
          </el-form-item>
          <el-form-item label="目标受众">
            <el-input v-model="pptSettings.audience" placeholder="例如：管理层、技术团队、客户" />
          </el-form-item>
          <el-form-item label="核心要点">
            <el-input v-model="pptSettings.keyPoints" placeholder="最想让听众记住的3个核心点" />
          </el-form-item>
          <el-form-item label="页数">
            <el-select v-model="pptSettings.pageCount">
              <el-option label="5-7页" value="5-7" />
              <el-option label="8-10页" value="8-10" />
              <el-option label="11-15页" value="11-15" />
            </el-select>
          </el-form-item>
          <el-form-item label="风格">
            <el-radio-group v-model="pptSettings.style">
              <el-radio label="大字少话">大字少话</el-radio>
              <el-radio label="内容详细">内容详细</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="配色方案">
            <el-select v-model="pptSettings.color">
              <el-option label="科技蓝" value="科技蓝" />
              <el-option label="生态绿" value="生态绿" />
              <el-option label="简约黑白" value="简约黑白" />
              <el-option label="活力橙" value="活力橙" />
            </el-select>
          </el-form-item>
          <el-form-item label="翻页特效">
            <el-switch v-model="pptSettings.needTransition" />
          </el-form-item>
          <el-form-item label="金句总结">
            <el-switch v-model="pptSettings.needSummary" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showPptDialog=false">取消</el-button>
          <el-button type="primary" @click="generatePpt" :loading="aiProcessing">
            生成HTML幻灯片
          </el-button>
        </template>
      </el-dialog>
    </div>
  `
};

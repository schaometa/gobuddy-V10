// Table Page Component - 飞书在线表格模块（嵌入式编辑 + AI分析处理）
const TablePage = {
  name: 'TablePage',
  setup() {
    const { ref, computed, onMounted, onUnmounted, nextTick } = Vue;

    const isElectron = ref(!!window.electronAPI);

    // ============ 飞书连接与嵌入 ============
    const feishuConnected = ref(false);
    const feishuUrl = ref('');
    const embeddedSheetUrl = ref('');
    const embeddedSheetToken = ref('');
    const showCreateSheetDialog = ref(false);
    const newSheetTitle = ref('');
    const aiProcessing = ref(false);

    // ============ 当前表格数据（从飞书读取） ============
    const currentSheetData = ref({ headers: [], rows: [] });
    const sheetDataLoaded = ref(false);
    const sheetList = ref([]);
    const activeSheetId = ref('');

    // ============ AI功能状态 ============
    const showAiMenu = ref(false);

    // AI分析
    const showAnalysisPanel = ref(false);
    const analysisQuestion = ref('');
    const analysisLoading = ref(false);
    const analysisHistory = ref([]);

    // AI处理
    const showProcessDialog = ref(false);
    const processInstruction = ref('');

    // 图表
    const showChartPanel = ref(false);
    const chartSuggestions = ref([]);
    const activeChartIdx = ref(0);
    let chartInstance = null;
    const manualChartType = ref('bar');

    // 数据校验
    const showValidationDialog = ref(false);
    const validationResults = ref([]);
    const validationLoading = ref(false);

    // 智能填充
    const showAutoFillDialog = ref(false);
    const autoFillColumn = ref('');
    const autoFilling = ref(false);

    // 汇总统计
    const showSummaryDialog = ref(false);
    const summaryInstruction = ref('');
    const summaryResult = ref(null);
    const summaryLoading = ref(false);

    // 公式建议
    const showFormulaDialog = ref(false);
    const formulaResult = ref('');
    const formulaLoading = ref(false);

    // AI生成表格
    const showGenerateDialog = ref(false);
    const generateInput = ref('');

    // ============ 计算属性 ============
    const hasSheet = computed(() => !!embeddedSheetUrl.value);
    const hasSheetData = computed(() => currentSheetData.value.headers.length > 0);

    // ============ 工具函数 ============
    const colIndexToLetter = (idx) => {
      let result = '';
      let i = idx;
      while (i >= 0) {
        result = String.fromCharCode(65 + (i % 26)) + result;
        i = Math.floor(i / 26) - 1;
      }
      return result;
    };

    // ============ 飞书连接 ============
    const checkFeishu = async () => {
      feishuConnected.value = await WBFeishu.checkConnection();
    };

    // ============ 读取当前飞书表格数据 ============
    // 获取 sheet 列表
    const loadSheetList = async () => {
      const token = embeddedSheetToken.value;
      if (!token) return;
      try {
        const result = await WBFeishu.getSheets(token);
        sheetList.value = (result.sheets || []).filter(s => !s.hidden);
        if (sheetList.value.length > 0 && !activeSheetId.value) {
          activeSheetId.value = sheetList.value[0].sheet_id || sheetList.value[0].sheetId;
        }
      } catch (e) {
        console.log('[TablePage] 获取sheet列表失败:', e.message);
        sheetList.value = [];
      }
    };

    // 切换 sheet
    const switchSheet = async (sheetId) => {
      activeSheetId.value = sheetId;
      sheetDataLoaded.value = false;
      await loadSheetData();
    };

    // 读取当前 sheet 数据
    const loadSheetData = async () => {
      if (!embeddedSheetToken.value) return false;
      const token = embeddedSheetToken.value;
      const sheetName = activeSheetId.value || 'Sheet1';
      const range = `${sheetName}!A1:Z200`;

      // 尝试1: 作为电子表格读取
      try {
        const sheetUrl = `https://feishu.cn/sheets/${token}`;
        const result = await WBFeishu.fetchSheet(sheetUrl, range);
        if (result.values && result.values.length > 0) {
          const filtered = result.values.filter(row => row.some(cell => cell != null && cell !== ''));
          if (filtered.length > 0) {
            currentSheetData.value = {
              headers: filtered[0].map(String),
              rows: filtered.slice(1).map(row => row.map(String))
            };
            sheetDataLoaded.value = true;
            return true;
          }
        }
        // 数据为空但调用成功
        currentSheetData.value = { headers: [], rows: [] };
        sheetDataLoaded.value = true;
        return true;
      } catch (e) {
        console.log('[TablePage] 表格读取失败:', e.message);
      }

      // 尝试2: 作为文档读取
      try {
        const docResult = await WBFeishu.fetchDoc(token);
        const content = docResult.markdown || docResult.content || docResult.text || '';
        if (content) {
          const lines = content.split('\n').filter(l => l.trim());
          currentSheetData.value = {
            headers: ['内容'],
            rows: lines.map(l => [l])
          };
          sheetDataLoaded.value = true;
          return true;
        }
      } catch (e) {
        console.error('文档读取也失败:', e);
      }
      return false;
    };

    // ============ 写回飞书表格 ============
    const writeBackToSheet = async (data) => {
      if (!embeddedSheetToken.value) return false;
      try {
        const values = [data.headers, ...data.rows];
        const colLetter = colIndexToLetter(data.headers.length - 1);
        const sheetName = activeSheetId.value || 'Sheet1';
        const range = `${sheetName}!A1:${colLetter}${values.length}`;
        await WBFeishu.writeSheet(embeddedSheetToken.value, range, values);
        return true;
      } catch (e) {
        console.error('写回飞书表格失败:', e);
        return false;
      }
    };

    // ============ 创建飞书表格 ============
    const createFeishuSheet = async () => {
      if (!feishuConnected.value) {
        ElementPlus.ElMessage.error('飞书未连接');
        return;
      }
      const title = newSheetTitle.value.trim() || '表格-' + dayjs().format('MM-DD HH:mm');
      aiProcessing.value = true;
      try {
        const result = await WBFeishu.createSheet(title);
        if (result.spreadsheetToken) {
          embeddedSheetToken.value = result.spreadsheetToken;
          embeddedSheetUrl.value = WBFeishu.getWebUrl('sheet', result.spreadsheetToken);
          showCreateSheetDialog.value = false;
          newSheetTitle.value = '';
          sheetDataLoaded.value = false;
          activeSheetId.value = '';
          addToRecentTables(result.spreadsheetToken, title);
          await loadSheetList();
          await loadSheetData();
          ElementPlus.ElMessage.success('飞书表格已创建');
        }
      } catch (e) {
        ElementPlus.ElMessage.error('创建失败：' + e.message);
      }
      aiProcessing.value = false;
    };

    // ============ 打开飞书表格 ============
    const openFeishuSheet = async () => {
      if (!feishuUrl.value.trim()) {
        ElementPlus.ElMessage.warning('请输入飞书表格URL');
        return;
      }
      const parsed = WBFeishu.parseUrl(feishuUrl.value);
      if (!parsed) {
        ElementPlus.ElMessage.warning('请输入有效的飞书URL');
        return;
      }
      // 支持 sheet、wiki、bitable 类型
      const token = parsed.token;
      embeddedSheetToken.value = token;
      embeddedSheetUrl.value = WBFeishu.getWebUrl(parsed.type === 'sheet' ? 'sheet' : parsed.type, token);
      sheetDataLoaded.value = false;
      activeSheetId.value = '';
      sheetList.value = [];
      // 加载 sheet 列表和数据
      await loadSheetList();
      await loadSheetData();
      // 获取表格标题
      let title = token;
      try {
        const meta = await WBFeishu.getSheetMeta(token);
        if (meta.title) title = meta.title;
        else if (meta.spreadsheet?.title) title = meta.spreadsheet.title;
        else if (meta.spreadsheet?.spreadsheet?.title) title = meta.spreadsheet.spreadsheet.title;
      } catch {
        // meta 失败时用 token 作为标题
      }
      addToRecentTables(token, title, parsed.type);
    };

    // ============ 关闭飞书表格 ============
    const closeFeishuSheet = () => {
      embeddedSheetUrl.value = '';
      embeddedSheetToken.value = '';
      currentSheetData.value = { headers: [], rows: [] };
      sheetDataLoaded.value = false;
    };

    // ============ AI功能统一入口 ============
    const requireSheetData = async () => {
      if (!hasSheet.value) {
        ElementPlus.ElMessage.warning('请先打开一个飞书表格');
        return false;
      }
      if (!sheetDataLoaded.value) {
        ElementPlus.ElMessage.info('正在读取表格数据...');
        const ok = await loadSheetData();
        if (!ok) {
          ElementPlus.ElMessage.error('无法读取表格数据，请检查飞书连接和表格权限');
          return false;
        }
      }
      if (!hasSheetData.value) {
        ElementPlus.ElMessage.warning('表格数据为空，请确认表格中有数据后点击"刷新数据"重试');
        return false;
      }
      return true;
    };

    const checkApiKey = () => {
      const apiKey = WBStorage.getApiKey();
      if (!apiKey) {
        ElementPlus.ElMessage.error('请先在设置中配置 API Key');
        return false;
      }
      return true;
    };

    // ============ AI生成表格到飞书 ============
    const aiGenerateToSheet = async () => {
      if (!generateInput.value.trim()) {
        ElementPlus.ElMessage.warning('请描述你要生成的表格');
        return;
      }
      if (!checkApiKey()) return;
      if (!feishuConnected.value) {
        ElementPlus.ElMessage.error('飞书未连接');
        return;
      }
      aiProcessing.value = true;
      try {
        // 1. AI生成表格数据
        ElementPlus.ElMessage.info('正在生成表格数据...');
        let tableData;
        try {
          tableData = await WBAI.generateTable(generateInput.value);
        } catch (e) {
          throw new Error('AI生成失败：' + (WBAI.getErrorMessage(e) || e.message));
        }
        if (!tableData || !tableData.headers || !tableData.rows) {
          throw new Error('AI 返回的数据格式不正确');
        }
        // 2. 创建飞书表格
        const title = 'AI生成-' + dayjs().format('MM-DD HH:mm');
        let result;
        try {
          result = await WBFeishu.createSheet(title);
        } catch (e) {
          throw new Error('创建飞书表格失败：' + e.message);
        }
        if (!result.spreadsheetToken) {
          throw new Error('创建飞书表格失败：未返回表格ID');
        }
        // 3. 写入数据（使用 sheet_id 而非 sheet 名称）
        try {
          const values = [tableData.headers, ...tableData.rows];
          const colLetter = colIndexToLetter(tableData.headers.length - 1);
          // 获取 sheet_id
          const sheetInfo = await WBFeishu.getSheets(result.spreadsheetToken);
          const firstSheet = (sheetInfo.sheets || [])[0];
          const sheetId = firstSheet?.sheet_id || firstSheet?.sheetId || 'Sheet1';
          const range = `${sheetId}!A1:${colLetter}${values.length}`;
          await WBFeishu.writeSheet(result.spreadsheetToken, range, values);
        } catch (e) {
          throw new Error('写入表格数据失败：' + e.message);
        }
        // 4. 嵌入打开 + 添加到最近表格
        embeddedSheetToken.value = result.spreadsheetToken;
        embeddedSheetUrl.value = WBFeishu.getWebUrl('sheet', result.spreadsheetToken);
        activeSheetId.value = '';
        addToRecentTables(result.spreadsheetToken, title);
        await loadSheetList();
        await loadSheetData();
        showGenerateDialog.value = false;
        generateInput.value = '';
        ElementPlus.ElMessage.success('AI表格已生成并创建到飞书');
      } catch (e) {
        console.error('[TablePage] AI生成表格错误:', e);
        ElementPlus.ElMessage.error(e.message || '生成失败');
      }
      aiProcessing.value = false;
    };

    // ============ AI数据分析 ============
    const askAnalysis = async () => {
      if (!analysisQuestion.value.trim()) {
        ElementPlus.ElMessage.warning('请输入分析问题');
        return;
      }
      if (!await requireSheetData()) return;
      if (!checkApiKey()) return;
      analysisLoading.value = true;
      try {
        const result = await WBAI.analyzeTable(currentSheetData.value, analysisQuestion.value);
        analysisHistory.value.unshift({
          question: analysisQuestion.value,
          answer: result,
          time: dayjs().format('HH:mm')
        });
        if (analysisHistory.value.length > 20) analysisHistory.value.pop();
        analysisQuestion.value = '';
      } catch (e) {
        ElementPlus.ElMessage.error(WBAI.getErrorMessage(e));
      }
      analysisLoading.value = false;
    };

    const setQuickQuestion = (q) => { analysisQuestion.value = q; };

    // 格式化分析结果（Markdown → HTML）
    const formatAnalysis = (text) => {
      if (!text) return '';
      try {
        // 转义 HTML 特殊字符后再解析 markdown
        return typeof marked !== 'undefined' ? marked.parse(text) : text.replace(/\n/g, '<br>');
      } catch {
        return text.replace(/\n/g, '<br>');
      }
    };

    // 复制分析结果
    const copyAnalysis = async (text) => {
      try {
        // 去除 markdown 格式符号后复制纯文本
        const plain = text.replace(/\*\*/g, '').replace(/\*/g, '');
        await navigator.clipboard.writeText(plain);
        ElementPlus.ElMessage.success('已复制到剪贴板');
      } catch {
        ElementPlus.ElMessage.error('复制失败');
      }
    };

    // ============ AI处理表格 ============
    const aiProcess = async () => {
      if (!processInstruction.value.trim()) {
        ElementPlus.ElMessage.warning('请输入处理指令');
        return;
      }
      if (!await requireSheetData()) return;
      if (!checkApiKey()) return;
      aiProcessing.value = true;
      try {
        const result = await WBAI.processTable(currentSheetData.value, processInstruction.value);
        // 写回飞书
        const ok = await writeBackToSheet(result);
        if (ok) {
          sheetDataLoaded.value = false;
          showProcessDialog.value = false;
          processInstruction.value = '';
          ElementPlus.ElMessage.success('AI处理完成，已写回飞书表格');
        } else {
          ElementPlus.ElMessage.error('AI处理成功但写回飞书失败');
        }
      } catch (e) {
        ElementPlus.ElMessage.error(WBAI.getErrorMessage(e));
      }
      aiProcessing.value = false;
    };

    // ============ 图表生成 ============
    const buildChartConfig = (chartSpec) => {
      const { type, title, xField, yFields } = chartSpec;
      const data = currentSheetData.value;
      const xIdx = data.headers.indexOf(xField);
      const yIndices = yFields.map(f => data.headers.indexOf(f)).filter(i => i >= 0);
      if (xIdx < 0 || yIndices.length === 0) return null;

      const labels = data.rows.map(r => r[xIdx]);
      const colors = [
        '#3370FF', '#67C23A', '#FF9500', '#F56C6C', '#909399',
        '#36CFC9', '#597EF7', '#FF85C0', '#FFC53D', '#73D13D'
      ];

      const datasets = yIndices.map((yIdx, i) => ({
        label: data.headers[yIdx],
        data: data.rows.map(r => Number(r[yIdx]) || 0),
        backgroundColor: type === 'pie' || type === 'doughnut'
          ? colors.slice(0, labels.length)
          : colors[i % colors.length] + '33',
        borderColor: colors[i % colors.length],
        borderWidth: 2
      }));

      return {
        type,
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: { display: true, text: title, font: { size: 16 } },
            legend: { position: 'top' }
          }
        }
      };
    };

    const generateCharts = async () => {
      if (!await requireSheetData()) return;
      if (!checkApiKey()) return;
      showChartPanel.value = true;
      chartSuggestions.value = [];

      try {
        const suggestions = await WBAI.suggestCharts(currentSheetData.value);
        if (suggestions.length > 0) chartSuggestions.value = suggestions;
      } catch (e) { /* fallback below */ }

      if (chartSuggestions.value.length === 0) {
        const types = currentSheetData.value.headers.map((_, colIdx) => {
          const vals = currentSheetData.value.rows.slice(0, 5).map(r => r[colIdx]).filter(Boolean);
          return vals.every(v => !isNaN(Number(v)) && v.trim() !== '') ? 'number' : 'text';
        });
        const numCols = currentSheetData.value.headers.filter((_, i) => types[i] === 'number');
        const textCols = currentSheetData.value.headers.filter((_, i) => types[i] !== 'number');
        if (numCols.length > 0 && textCols.length > 0) {
          chartSuggestions.value = [{
            type: 'bar', title: '数据对比',
            xField: textCols[0], yFields: numCols.slice(0, 3),
            reason: '自动推荐：分类数据适合柱状图'
          }];
        }
      }
      if (chartSuggestions.value.length > 0) {
        nextTick(() => renderChart(0));
      }
    };

    const renderChart = (idx) => {
      activeChartIdx.value = idx;
      const spec = chartSuggestions.value[idx];
      if (!spec) return;
      const config = buildChartConfig(spec);
      if (!config) return;
      nextTick(() => {
        const canvas = document.getElementById('table-chart-canvas');
        if (!canvas) return;
        if (chartInstance) chartInstance.destroy();
        chartInstance = new Chart(canvas.getContext('2d'), config);
      });
    };

    const switchManualChart = (type) => {
      const spec = chartSuggestions.value[activeChartIdx.value];
      if (!spec) return;
      const config = buildChartConfig({ ...spec, type });
      if (!config) return;
      nextTick(() => {
        const canvas = document.getElementById('table-chart-canvas');
        if (!canvas) return;
        if (chartInstance) chartInstance.destroy();
        chartInstance = new Chart(canvas.getContext('2d'), config);
      });
    };

    const destroyChart = () => {
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    };

    const exportChartAsImage = () => {
      if (!chartInstance) return;
      const link = document.createElement('a');
      link.download = 'chart-' + dayjs().format('YYYY-MM-DD') + '.png';
      link.href = chartInstance.toBase64Image();
      link.click();
    };

    const onChartDialogOpened = () => {
      if (chartSuggestions.value.length > 0) renderChart(activeChartIdx.value);
    };

    // ============ 数据校验 ============
    const runValidation = async () => {
      if (!await requireSheetData()) return;
      if (!checkApiKey()) return;
      validationLoading.value = true;
      showValidationDialog.value = true;
      try {
        validationResults.value = await WBAI.validateData(currentSheetData.value);
        if (validationResults.value.length === 0) {
          ElementPlus.ElMessage.success('数据质量良好，未发现问题');
        }
      } catch (e) {
        ElementPlus.ElMessage.error(WBAI.getErrorMessage(e));
      }
      validationLoading.value = false;
    };

    const applyFix = async (issue) => {
      if (issue.row != null && issue.column) {
        const colIdx = currentSheetData.value.headers.indexOf(issue.column);
        if (colIdx >= 0 && issue.suggestion) {
          currentSheetData.value.rows[issue.row][colIdx] = issue.suggestion;
          validationResults.value = validationResults.value.filter(r => r !== issue);
          // 写回飞书
          const ok = await writeBackToSheet(currentSheetData.value);
          if (ok) {
            ElementPlus.ElMessage.success('已修复并同步到飞书');
          } else {
            ElementPlus.ElMessage.success('已修复本地数据，但写回飞书失败');
          }
        }
      }
    };

    // ============ 智能填充 ============
    const startAutoFill = async () => {
      if (!await requireSheetData()) return;
      autoFillColumn.value = '';
      showAutoFillDialog.value = true;
    };

    const runAutoFill = async () => {
      if (!autoFillColumn.value) {
        ElementPlus.ElMessage.warning('请选择要填充的列');
        return;
      }
      if (!checkApiKey()) return;
      autoFilling.value = true;
      try {
        const result = await WBAI.autoFill(currentSheetData.value, autoFillColumn.value);
        if (result.headers && result.rows) {
          const ok = await writeBackToSheet(result);
          if (ok) {
            currentSheetData.value = result;
            sheetDataLoaded.value = true;
            showAutoFillDialog.value = false;
            ElementPlus.ElMessage.success('智能填充完成，已同步到飞书');
          }
        }
      } catch (e) {
        ElementPlus.ElMessage.error(WBAI.getErrorMessage(e));
      }
      autoFilling.value = false;
    };

    // ============ 汇总统计 ============
    const runSummary = async () => {
      if (!summaryInstruction.value.trim()) {
        ElementPlus.ElMessage.warning('请输入汇总指令');
        return;
      }
      if (!await requireSheetData()) return;
      if (!checkApiKey()) return;
      summaryLoading.value = true;
      try {
        summaryResult.value = await WBAI.generateSummary(currentSheetData.value, summaryInstruction.value);
      } catch (e) {
        ElementPlus.ElMessage.error(WBAI.getErrorMessage(e));
      }
      summaryLoading.value = false;
    };

    const applySummaryToSheet = async () => {
      if (summaryResult.value && summaryResult.value.table) {
        const ok = await writeBackToSheet(summaryResult.value.table);
        if (ok) {
          currentSheetData.value = summaryResult.value.table;
          showSummaryDialog.value = false;
          summaryResult.value = null;
          summaryInstruction.value = '';
          ElementPlus.ElMessage.success('汇总结果已写入飞书表格');
        }
      }
    };

    // ============ 公式建议 ============
    const suggestFormula = async () => {
      if (!await requireSheetData()) return;
      if (!checkApiKey()) return;
      formulaLoading.value = true;
      showFormulaDialog.value = true;
      try {
        formulaResult.value = await WBAI.call(
          `根据以下表格的列名和数据类型，推荐常用的数据计算公式或新增列建议：\n列名：${currentSheetData.value.headers.join(', ')}\n数据类型：${WBAI._inferColumnTypes(currentSheetData.value)}\n数据样例（前3行）：\n${JSON.stringify(currentSheetData.value.rows.slice(0, 3))}`,
          '你是数据分析专家，擅长推荐实用的数据计算公式。请以中文输出，每条建议包含：建议的列名、计算逻辑、适用场景。格式清晰易读。'
        );
      } catch (e) {
        ElementPlus.ElMessage.error(WBAI.getErrorMessage(e));
      }
      formulaLoading.value = false;
    };

    // ============ 导出分析报告 ============
    const exportInsights = async () => {
      if (analysisHistory.value.length === 0) {
        ElementPlus.ElMessage.warning('请先进行数据分析');
        return;
      }
      const content = analysisHistory.value.map(item =>
        `### ${item.question}\n\n${item.answer}\n`
      ).join('\n---\n\n');
      const fullContent = `# 表格数据分析报告\n\n**生成时间：${dayjs().format('YYYY-MM-DD HH:mm')}**\n\n**数据概览：${currentSheetData.value.rows.length}行 x ${currentSheetData.value.headers.length}列**\n\n---\n\n${content}`;

      if (feishuConnected.value) {
        try {
          const title = '表格分析报告-' + dayjs().format('MMDD-HHmm');
          const result = await WBFeishu.createDoc(title, fullContent);
          if (result && (result.token || result.doc_token)) {
            ElementPlus.ElMessage.success('分析报告已保存到飞书文档');
            window.open(WBFeishu.getWebUrl('docx', result.token || result.doc_token), '_blank');
            return;
          }
        } catch (e) { /* fallback */ }
      }
      WBExport.exportMarkdown(fullContent, 'table-analysis-' + dayjs().format('YYYY-MM-DD'));
      ElementPlus.ElMessage.success('分析报告已导出');
    };

    // ============ AI命令分发 ============
    const handleAiCommand = (cmd) => {
      switch (cmd) {
        case 'generate': showGenerateDialog.value = true; break;
        case 'process': showProcessDialog.value = true; break;
        case 'analyze': showAnalysisPanel.value = true; break;
        case 'chart': generateCharts(); break;
        case 'validate': runValidation(); break;
        case 'autofill': startAutoFill(); break;
        case 'summary': showSummaryDialog.value = true; summaryResult.value = null; summaryInstruction.value = ''; break;
        case 'formula': suggestFormula(); break;
        case 'exportInsights': exportInsights(); break;
      }
    };

    // ============ 最近表格 ============
    const recentTables = ref([]);

    const loadRecentTables = () => {
      recentTables.value = WBStorage.get('recent-feishu-tables', []);
    };

    const addToRecentTables = (token, title, type = 'sheet') => {
      const list = recentTables.value.filter(t => t.token !== token);
      list.unshift({ token, title: title || token, type, openedAt: new Date().toISOString() });
      if (list.length > 20) list.pop();
      recentTables.value = list;
      WBStorage.set('recent-feishu-tables', list);
    };

    const openRecentTable = async (token, title) => {
      const item = recentTables.value.find(t => t.token === token);
      const type = item?.type || 'sheet';
      embeddedSheetToken.value = token;
      embeddedSheetUrl.value = WBFeishu.getWebUrl(type, token);
      sheetDataLoaded.value = false;
      activeSheetId.value = '';
      sheetList.value = [];
      await loadSheetList();
      await loadSheetData();
      addToRecentTables(token, title, type);
    };

    const removeFromRecentTables = (token) => {
      recentTables.value = recentTables.value.filter(t => t.token !== token);
      WBStorage.set('recent-feishu-tables', recentTables.value);
    };

    const clearRecentTables = () => {
      recentTables.value = [];
      WBStorage.set('recent-feishu-tables', []);
    };

    // 监听飞书连接成功事件
    window.addEventListener('feishu-connected', () => {
      feishuConnected.value = true;
    });

    // 监听数据刷新事件（AI 创建表格后同步）
    const onDashboardRefreshed = () => { loadRecentTables(); };
    window.addEventListener('dashboard-refreshed', onDashboardRefreshed);

    // ============ 生命周期 ============
    onMounted(() => {
      checkFeishu();
      loadRecentTables();
      nextTick(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); });
    });

    onUnmounted(() => {
      window.removeEventListener('dashboard-refreshed', onDashboardRefreshed);
    });

    return {
      isElectron, feishuConnected, feishuUrl, embeddedSheetUrl, embeddedSheetToken,
      showCreateSheetDialog, newSheetTitle, aiProcessing,
      currentSheetData, sheetDataLoaded, hasSheet, hasSheetData,
      sheetList, activeSheetId, switchSheet,
      showAnalysisPanel, analysisQuestion, analysisLoading, analysisHistory,
      showProcessDialog, processInstruction,
      showChartPanel, chartSuggestions, activeChartIdx, manualChartType,
      showValidationDialog, validationResults, validationLoading,
      showAutoFillDialog, autoFillColumn, autoFilling,
      showSummaryDialog, summaryInstruction, summaryResult, summaryLoading,
      showFormulaDialog, formulaResult, formulaLoading,
      showGenerateDialog, generateInput,
      recentTables, openRecentTable, removeFromRecentTables, clearRecentTables,
      createFeishuSheet, openFeishuSheet, closeFeishuSheet, loadSheetData,
      handleAiCommand, setQuickQuestion,
      aiGenerateToSheet, aiProcess, askAnalysis, formatAnalysis, copyAnalysis,
      generateCharts, renderChart, switchManualChart, destroyChart, exportChartAsImage, onChartDialogOpened,
      runValidation, applyFix,
      runAutoFill,
      runSummary, applySummaryToSheet,
      suggestFormula,
      exportInsights
    };
  },
  template: `
    <div class="fade-in" style="display:grid;grid-template-columns:280px 1fr;gap:16px;height:calc(100vh - 120px)">
      <!-- ===== 左侧面板 ===== -->
      <div class="table-left-panel" style="overflow-y:auto">
        <!-- 飞书连接状态 -->
        <div style="margin-bottom:16px">
          <el-tag :type="feishuConnected ? 'success' : 'danger'" size="small" style="width:100%;text-align:center">
            {{ feishuConnected ? '✓ 飞书已连接' : '✕ 飞书未连接' }}
          </el-tag>
        </div>

        <!-- 新建飞书表格 -->
        <div class="panel-section">
          <div class="panel-section-title"><i data-lucide="table-2" style="width:16px;height:16px"></i> 飞书在线表格</div>
          <div class="source-card">
            <el-button size="small" type="primary" @click="showCreateSheetDialog = true" :disabled="!feishuConnected" style="width:100%">
              <i data-lucide="plus" style="width:14px;height:14px"></i> 新建空白表格
            </el-button>
          </div>
        </div>

        <!-- 打开已有表格 -->
        <div class="panel-section" style="margin-top:12px">
          <div class="panel-section-title"><i data-lucide="external-link" style="width:16px;height:16px"></i> 打开已有表格</div>
          <div class="source-card">
            <el-input
              v-model="feishuUrl"
              placeholder="粘贴飞书表格URL"
              size="small"
              style="margin-bottom:8px"
            />
            <el-button size="small" @click="openFeishuSheet" :disabled="!feishuConnected" style="width:100%">
              打开
            </el-button>
          </div>
        </div>

        <!-- AI功能菜单 -->
        <div class="panel-section" style="margin-top:12px">
          <div class="panel-section-title"><i data-lucide="sparkles" style="width:16px;height:16px"></i> AI功能</div>
          <div class="source-card" style="padding:8px">
            <div style="display:flex;flex-direction:column;gap:4px">
              <el-button size="small" @click="showGenerateDialog = true" style="width:100%;justify-content:flex-start"><i data-lucide="sparkles" style="width:14px;height:14px"></i> AI生成表格</el-button>
              <el-divider style="margin:4px 0" />
              <el-button size="small" @click="handleAiCommand('analyze')" style="width:100%;justify-content:flex-start"><i data-lucide="search" style="width:14px;height:14px"></i> 数据分析</el-button>
              <el-button size="small" @click="handleAiCommand('exportInsights')" style="width:100%;justify-content:flex-start"><i data-lucide="file-text" style="width:14px;height:14px"></i> 导出分析报告</el-button>
            </div>
          </div>
        </div>

        <!-- 最近表格 -->
        <div class="content-card" style="margin-top:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="font-size:14px;font-weight:600;color:#1C1F23">最近表格</span>
            <el-tooltip content="清空列表" placement="top">
              <el-button size="small" circle @click="clearRecentTables" :disabled="recentTables.length===0"><i data-lucide="trash-2" style="width:14px;height:14px"></i></el-button>
            </el-tooltip>
          </div>
          <div v-if="recentTables.length === 0" style="text-align:center;padding:16px;color:#888D92;font-size:13px">
            <i data-lucide="bar-chart-3" style="width:14px;height:14px"></i> 暂无最近表格
          </div>
          <div v-else>
            <div v-for="table in recentTables" :key="table.token"
              style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #F0F1F5;cursor:pointer"
              @click="openRecentTable(table.token, table.title)">
              <span style="flex:1;font-size:13px;color:#1C1F23;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                {{ table.title }}
              </span>
              <el-button type="danger" link size="small" @click.stop="removeFromRecentTables(table.token)" style="margin-left:4px">删除</el-button>
            </div>
          </div>
        </div>
      </div>

      <!-- ===== 主区域 ===== -->
      <div style="display:flex;flex-direction:column;overflow:hidden">
        <!-- 标题栏 -->
        <div v-if="hasSheet" style="display:flex;justify-content:flex-end;align-items:center;margin-bottom:12px">
          <div style="display:flex;gap:8px">
            <el-button size="small" @click="loadSheetData" :loading="aiProcessing"><i data-lucide="refresh-cw" style="width:14px;height:14px"></i> 刷新数据</el-button>
            <el-button size="small" type="danger" @click="closeFeishuSheet">✕ 关闭表格</el-button>
          </div>
        </div>

        <!-- Sheet 选择器 -->
        <div v-if="hasSheet && sheetList.length > 0" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
          <el-button v-for="sheet in sheetList" :key="sheet.sheet_id || sheet.sheetId"
            size="small"
            :type="activeSheetId === (sheet.sheet_id || sheet.sheetId) ? 'primary' : 'default'"
            @click="switchSheet(sheet.sheet_id || sheet.sheetId)">
            {{ sheet.title || sheet.name }}
          </el-button>
        </div>

        <!-- 飞书表格（浏览器: iframe / Electron: webview） -->
        <div v-if="hasSheet" style="flex:1;overflow:hidden;background:#fff;border-radius:8px;border:1px solid #E6E8EA">
          <iframe v-if="!isElectron" :src="embeddedSheetUrl" style="width:100%;height:100%;border:none" allow="clipboard-read;clipboard-write"></iframe>
          <webview v-else :src="embeddedSheetUrl" style="width:100%;height:100%" allowpopups></webview>
        </div>

        <!-- 空状态 -->
        <div v-else style="flex:1;display:flex;align-items:center;justify-content:center;background:#fff;border-radius:8px;border:1px solid #E6E8EA">
          <div style="text-align:center">
            <div style="font-size:48px;margin-bottom:16px"><i data-lucide="bar-chart-3" style="width:48px;height:48px"></i></div>
            <div style="font-size:16px;color:#555B61;margin-bottom:8px">打开或创建一个飞书表格</div>
            <div style="font-size:14px;color:#888D92;margin-bottom:20px">在左侧选择新建空白表格、AI生成表格，或粘贴已有表格URL</div>
            <div style="display:flex;gap:12px;justify-content:center">
              <el-button type="primary" @click="showCreateSheetDialog = true" :disabled="!feishuConnected"><i data-lucide="plus" style="width:14px;height:14px"></i> 新建空白表格</el-button>
              <el-button @click="showGenerateDialog = true" :disabled="!feishuConnected"><i data-lucide="sparkles" style="width:14px;height:14px"></i> AI生成表格</el-button>
            </div>
          </div>
        </div>
      </div>

      <!-- ===== 弹窗区域 ===== -->

      <!-- 新建飞书表格弹窗 -->
      <el-dialog v-model="showCreateSheetDialog" title="" width="420px"><template #title><i data-lucide="plus" style="width:16px;height:16px"></i> 新建飞书表格</template>
        <div style="margin-bottom:12px">
          <div style="font-size:14px;color:#555B61;margin-bottom:8px">表格标题：</div>
          <el-input v-model="newSheetTitle" placeholder="留空则自动生成标题" @keyup.enter="createFeishuSheet" />
        </div>
        <template #footer>
          <el-button @click="showCreateSheetDialog = false">取消</el-button>
          <el-button type="primary" @click="createFeishuSheet" :loading="aiProcessing">创建</el-button>
        </template>
      </el-dialog>

      <!-- AI生成表格弹窗 -->
      <el-dialog v-model="showGenerateDialog" title="" width="480px"><template #title><i data-lucide="sparkles" style="width:16px;height:16px"></i> AI生成表格</template>
        <div style="margin-bottom:12px">
          <div style="font-size:14px;color:#555B61;margin-bottom:8px">描述你要生成的表格：</div>
          <el-input v-model="generateInput" type="textarea" :rows="3" placeholder="例如：生成本周项目进度表，包含项目名、负责人、进度百分比、风险项" @keyup.enter="aiGenerateToSheet" />
        </div>
        <div style="font-size:12px;color:#888D92"><i data-lucide="lightbulb" style="width:14px;height:14px"></i> AI将自动生成表格数据并创建为飞书表格</div>
        <template #footer>
          <el-button @click="showGenerateDialog = false">取消</el-button>
          <el-button type="primary" @click="aiGenerateToSheet" :loading="aiProcessing">生成</el-button>
        </template>
      </el-dialog>

      <!-- AI数据分析弹窗 -->
      <el-dialog v-model="showAnalysisPanel" title="" width="640px"><template #title><i data-lucide="search" style="width:16px;height:16px"></i> 数据智能分析</template>
        <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
          <el-tag v-for="q in ['数据概览总结', '检测异常数据', '发现数据趋势', '数据改进建议']" :key="q" style="cursor:pointer" effect="plain" @click="setQuickQuestion(q)">{{ q }}</el-tag>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <el-input v-model="analysisQuestion" placeholder="输入你的分析问题..." @keyup.enter="askAnalysis" />
          <el-button type="primary" @click="askAnalysis" :loading="analysisLoading">分析</el-button>
        </div>
        <div style="max-height:400px;overflow-y:auto">
          <div v-for="(item, idx) in analysisHistory" :key="idx" style="margin-bottom:16px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
              <div style="color:#3370FF;font-size:13px"><i data-lucide="help-circle" style="width:14px;height:14px"></i> {{ item.question }} <span style="color:#888D92;font-size:11px;margin-left:8px">{{ item.time }}</span></div>
              <el-button size="small" link @click="copyAnalysis(item.answer)" style="font-size:12px"><i data-lucide="copy" style="width:12px;height:12px"></i> 复制</el-button>
            </div>
            <div class="analysis-result" style="background:#F7F8FA;padding:12px;border-radius:8px;font-size:14px;line-height:1.8" v-html="formatAnalysis(item.answer)"></div>
          </div>
          <div v-if="analysisHistory.length===0" style="text-align:center;padding:40px;color:#888D92">输入问题，AI将分析你的表格数据</div>
        </div>
      </el-dialog>

      <!-- AI智能处理弹窗 -->
      <el-dialog v-model="showProcessDialog" title="" width="480px"><template #title><i data-lucide="wrench" style="width:16px;height:16px"></i> AI智能处理</template>
        <div style="margin-bottom:12px">
          <div style="font-size:14px;color:#555B61;margin-bottom:8px">告诉AI你想对表格做什么处理：</div>
          <el-input v-model="processInstruction" type="textarea" :rows="3" placeholder="例如：&#10;- 按销售额从高到低排序&#10;- 添加一列"总计"计算单价*数量&#10;- 筛选出状态为"进行中"的行" />
        </div>
        <div style="font-size:12px;color:#888D92"><i data-lucide="lightbulb" style="width:14px;height:14px"></i> 处理结果将直接写回飞书表格</div>
        <template #footer>
          <el-button @click="showProcessDialog = false">取消</el-button>
          <el-button type="primary" @click="aiProcess" :loading="aiProcessing">执行处理</el-button>
        </template>
      </el-dialog>

      <!-- 图表生成弹窗 -->
      <el-dialog v-model="showChartPanel" title="" width="800px" @closed="destroyChart" @opened="onChartDialogOpened"><template #title><i data-lucide="trending-up" style="width:16px;height:16px"></i> AI图表生成</template>
        <div v-if="chartSuggestions.length > 0" style="margin-bottom:16px">
          <el-radio-group v-model="activeChartIdx" @change="renderChart" size="small">
            <el-radio-button v-for="(s, idx) in chartSuggestions" :key="idx" :label="idx">{{ s.title }}</el-radio-button>
          </el-radio-group>
          <div style="font-size:12px;color:#888D92;margin-top:8px">{{ chartSuggestions[activeChartIdx]?.reason }}</div>
        </div>
        <div v-else-if="!aiProcessing" style="text-align:center;padding:40px;color:#888D92">暂无图表推荐</div>
        <div style="position:relative;height:400px;background:#F7F8FA;border-radius:8px;padding:16px">
          <canvas id="table-chart-canvas"></canvas>
        </div>
        <div style="margin-top:16px;display:flex;gap:8px;align-items:center">
          <span style="font-size:13px;color:#555B61">手动切换：</span>
          <el-select v-model="manualChartType" size="small" style="width:120px" @change="switchManualChart">
            <el-option label="柱状图" value="bar" />
            <el-option label="折线图" value="line" />
            <el-option label="饼图" value="pie" />
            <el-option label="环形图" value="doughnut" />
            <el-option label="雷达图" value="radar" />
            <el-option label="散点图" value="scatter" />
          </el-select>
          <el-button size="small" @click="exportChartAsImage" style="margin-left:auto"><i data-lucide="image" style="width:14px;height:14px"></i> 导出图片</el-button>
        </div>
      </el-dialog>

      <!-- 数据校验弹窗 -->
      <el-dialog v-model="showValidationDialog" title="" width="560px"><template #title><i data-lucide="check-circle-2" style="width:16px;height:16px"></i> 数据校验</template>
        <div v-if="validationLoading" style="text-align:center;padding:40px">
          <div style="animation:spin 1s linear infinite;display:inline-block">⟳</div>
          <div style="margin-top:8px;color:#888D92">AI正在检查数据质量...</div>
        </div>
        <div v-else-if="validationResults.length === 0" style="text-align:center;padding:40px;color:#67C23A">
          <div style="font-size:36px;margin-bottom:8px"><i data-lucide="check-circle-2" style="width:48px;height:48px;color:#34C759"></i></div>
          <div>数据质量良好，未发现问题</div>
        </div>
        <div v-else style="max-height:400px;overflow-y:auto">
          <div v-for="(issue, idx) in validationResults" :key="idx" class="validation-issue">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div>
                <div style="font-weight:500;margin-bottom:4px">第{{ issue.row + 1 }}行 · {{ issue.column }}</div>
                <div style="font-size:13px;color:#555B61">{{ issue.issue }}</div>
                <div v-if="issue.suggestion" style="font-size:13px;color:#67C23A;margin-top:4px">建议：{{ issue.suggestion }}</div>
              </div>
              <el-button size="small" type="primary" @click="applyFix(issue)" v-if="issue.suggestion">修复</el-button>
            </div>
          </div>
        </div>
        <template #footer>
          <el-button @click="showValidationDialog = false">关闭</el-button>
        </template>
      </el-dialog>

      <!-- 智能填充弹窗 -->
      <el-dialog v-model="showAutoFillDialog" title="" width="480px"><template #title><i data-lucide="pen-tool" style="width:16px;height:16px"></i> 智能填充</template>
        <div style="margin-bottom:16px">
          <div style="font-size:14px;color:#555B61;margin-bottom:8px">选择需要填充空值的列：</div>
          <el-select v-model="autoFillColumn" placeholder="选择列" style="width:100%">
            <el-option v-for="h in currentSheetData.headers" :key="h" :label="h" :value="h" />
          </el-select>
        </div>
        <div style="font-size:12px;color:#888D92"><i data-lucide="lightbulb" style="width:14px;height:14px"></i> AI将根据已有数据模式填充空值，结果直接写回飞书</div>
        <template #footer>
          <el-button @click="showAutoFillDialog = false">取消</el-button>
          <el-button type="primary" @click="runAutoFill" :loading="autoFilling">开始填充</el-button>
        </template>
      </el-dialog>

      <!-- 汇总统计弹窗 -->
      <el-dialog v-model="showSummaryDialog" title="" width="560px"><template #title><i data-lucide="bar-chart-3" style="width:16px;height:16px"></i> 汇总统计</template>
        <div style="margin-bottom:12px">
          <div style="font-size:14px;color:#555B61;margin-bottom:8px">描述你想要的汇总方式：</div>
          <el-input v-model="summaryInstruction" type="textarea" :rows="2" placeholder="例如：&#10;- 按部门汇总销售额&#10;- 计算每列的平均值和总和" @keyup.enter="runSummary" />
          <el-button type="primary" size="small" @click="runSummary" :loading="summaryLoading" style="margin-top:8px">生成汇总</el-button>
        </div>
        <div v-if="summaryResult" style="background:#F7F8FA;padding:12px;border-radius:8px">
          <div style="font-size:14px;line-height:1.8;white-space:pre-wrap;margin-bottom:12px">{{ summaryResult.summary }}</div>
          <el-table v-if="summaryResult.table" :data="summaryResult.table.rows" border size="small" style="width:100%">
            <el-table-column v-for="(h, idx) in summaryResult.table.headers" :key="idx" :label="h" :prop="String(idx)" min-width="100" />
          </el-table>
        </div>
        <template #footer>
          <el-button @click="showSummaryDialog = false">关闭</el-button>
          <el-button v-if="summaryResult && summaryResult.table" type="success" @click="applySummaryToSheet">写入飞书表格</el-button>
        </template>
      </el-dialog>

      <!-- 公式建议弹窗 -->
      <el-dialog v-model="showFormulaDialog" title="" width="560px"><template #title><i data-lucide="calculator" style="width:16px;height:16px"></i> 公式建议</template>
        <div v-if="formulaLoading" style="text-align:center;padding:40px">
          <div style="animation:spin 1s linear infinite;display:inline-block">⟳</div>
          <div style="margin-top:8px;color:#888D92">AI正在分析数据结构...</div>
        </div>
        <div v-else style="background:#F7F8FA;padding:16px;border-radius:8px;font-size:14px;line-height:1.8;white-space:pre-wrap;max-height:400px;overflow-y:auto">
          {{ formulaResult || '暂无建议' }}
        </div>
        <template #footer>
          <el-button @click="showFormulaDialog = false">关闭</el-button>
        </template>
      </el-dialog>
    </div>
  `
};

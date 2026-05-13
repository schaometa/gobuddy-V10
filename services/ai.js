// GoBuddy AI Service
const WBAI = {
  // 获取当前活跃的provider配置
  getActiveConfig() {
    const provider = WBStorage.getActiveProvider();
    const model = WBStorage.getActiveModel();
    return {
      name: provider.name,
      baseURL: provider.baseURL,
      apiKey: provider.apiKey,
      model: model
    };
  },

  async call(prompt, systemPrompt = '') {
    const config = this.getActiveConfig();

    if (!config.apiKey) {
      throw new Error('NO_API_KEY');
    }

    // 构建endpoint URL
    const endpoint = config.baseURL.replace(/\/$/, '') + '/chat/completions';
    const model = config.model;

    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({ model, messages, temperature: 0.7 })
      });

      if (!response.ok) {
        if (response.status === 401) throw new Error('INVALID_KEY');
        if (response.status === 429) throw new Error('RATE_LIMIT');
        if (response.status === 402) throw new Error('QUOTA_EXCEEDED');
        throw new Error('API_ERROR:' + response.status);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      if (error.message.startsWith('NO_API_KEY') ||
          error.message.startsWith('INVALID_KEY') ||
          error.message.startsWith('RATE_LIMIT') ||
          error.message.startsWith('QUOTA_EXCEEDED') ||
          error.message.startsWith('API_ERROR')) {
        throw error;
      }
      throw new Error('NETWORK_ERROR');
    }
  },

  async testConnection(config) {
    const endpoint = config.baseURL.replace(/\/$/, '') + '/chat/completions';
    const model = config.model;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5
        })
      });

      if (!response.ok) {
        if (response.status === 401) return { success: false, error: 'API Key 无效' };
        if (response.status === 429) return { success: false, error: '请求过于频繁，请稍后再试' };
        return { success: false, error: 'API 错误: ' + response.status };
      }

      return { success: true };
    } catch {
      return { success: false, error: '网络连接失败，请检查网络' };
    }
  },

  // Document writing
  async writeDocument(type, description) {
    const systemPrompt = `你是一个专业的工作文档撰写助手。用户会告诉你文档类型和需求，你需要生成一份结构清晰、内容专业的工作文档。
请使用 Markdown 格式输出，包含适当的标题、分段和要点。语言简洁专业。`;

    return this.call(
      `文档类型：${type}\n需求：${description}`,
      systemPrompt
    );
  },

  // Generate table data
  async generateTable(description) {
    const systemPrompt = `你是一个表格数据生成助手。用户描述需要的表格，你需要生成对应的表格数据。
请严格按以下 JSON 格式输出，不要输出任何其他内容：
{"headers": ["列名1", "列名2", ...], "rows": [["数据1", "数据2", ...], ...]}`;

    const result = await this.call(
      `请生成表格：${description}`,
      systemPrompt
    );

    try {
      let jsonStr = result.trim();
      // 去掉 ```json ... ``` 或 ``` 包裹
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      // 提取 JSON 对象
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.headers && parsed.rows) return parsed;
        if (Array.isArray(parsed) && parsed.length > 0) {
          // AI返回了数组格式，转换为 headers+rows
          return { headers: Object.keys(parsed[0]), rows: parsed.map(r => Object.values(r)) };
        }
      }
      // 尝试解析为 CSV/表格格式
      const lines = jsonStr.split('\n').filter(l => l.trim());
      if (lines.length >= 2) {
        const headers = lines[0].split(/[,\t|]/).map(s => s.trim());
        const rows = lines.slice(1).map(l => l.split(/[,\t|]/).map(s => s.trim()));
        if (headers.length > 1) return { headers, rows };
      }
      throw new Error('无法解析为表格数据');
    } catch (e) {
      console.error('[WBAI] generateTable parse error:', e.message, 'raw:', result.substring(0, 200));
      return { headers: ['内容'], rows: [[result]] };
    }
  },

  // Summarize messages
  async summarizeMessages(messages) {
    const systemPrompt = '你是一个消息摘要助手。请用简洁的中文总结以下消息的核心内容，不超过3句话。';
    const content = messages.map(m => `[${m.source}] ${m.sender}: ${m.content}`).join('\n');
    return this.call(content, systemPrompt);
  },

  // Generate report
  async generateReport(type, stats, notes, messages) {
    const systemPrompt = `你是一个工作报告生成助手。根据用户的工作数据生成${type}。
请使用 Markdown 格式，结构包含：工作概要、完成事项、重点讯息、下一步计划。
语言简洁专业，重点突出，避免空话套话。`;

    const prompt = `报告类型：${type}
=== 工作数据 ===
完成事项数：${stats.completedTasks}
专注时长：${stats.focusDisplay}
处理消息：${stats.messagesProcessed}
番茄钟数：${stats.pomodoroCount}

=== 快捷笔记 ===
${notes.map(n => '- ' + n.content).join('\n') || '无'}

=== 重要讯息 ===
${messages.map(m => '- [' + m.source + '] ' + m.sender + ': ' + m.content).join('\n') || '无'}`;

    return this.call(prompt, systemPrompt);
  },

  // ============ 文档整理功能 ============

  // 文档整理 - 金字塔原理
  async organizeDocument(content, method = 'pyramid') {
    const methods = {
      pyramid: `请用金字塔原理整理以下文档内容，要求：
1. 结论先行：核心观点放在最前面
2. 以上统下：每个论点都有论据支撑
3. 归类分组：同类内容归为一组
4. 逻辑递进：按重要性或时间顺序排列

**重要：必须保留原始内容中的所有图片、表格、链接和特殊格式。图片标签如<image .../>必须原样保留，表格必须完整保留。**

请直接输出整理后的Markdown内容，不要添加额外说明。`,

      structured: `请用结构化方式整理以下文档内容，要求：
1. 提取关键信息
2. 按主题分类
3. 使用标题层级组织
4. 添加要点总结

**重要：必须保留原始内容中的所有图片、表格、链接和特殊格式。图片标签如<image .../>必须原样保留，表格必须完整保留。**

请直接输出整理后的Markdown内容，不要添加额外说明。`,

      timeline: `请按时间线整理以下文档内容，要求：
1. 按时间顺序排列事件
2. 标注关键时间节点
3. 突出重要里程碑

**重要：必须保留原始内容中的所有图片、表格、链接和特殊格式。图片标签如<image .../>必须原样保留，表格必须完整保留。**

请直接输出整理后的Markdown内容，不要添加额外说明。`,

      meeting: `请将以下内容整理为规范的会议纪要格式，包含：
1. 会议基本信息（主题、时间、参会人员）
2. 各议题讨论要点
3. 决议事项
4. 待办事项（含责任人和截止时间）

**重要：必须保留原始内容中的所有图片、表格、链接和特殊格式。图片标签如<image .../>必须原样保留，表格必须完整保留。**

请直接输出整理后的Markdown内容，不要添加额外说明。`
    };

    return this.call(
      `${methods[method] || methods.pyramid}\\n\n原始内容：\n${content}`,
      '你是专业的文档结构化专家，擅长运用金字塔原理和结构化思维整理文档。你必须保留原始内容中的所有图片、表格和特殊格式。'
    );
  },

  // ============ 表格处理功能 ============

  // 表格数据处理
  async processTable(tableData, instruction) {
    const systemPrompt = `你是表格数据处理专家。用户会给你表格数据和处理指令，请返回处理后的数据。
请严格按以下 JSON 格式输出，不要输出任何其他内容：
{"headers": ["列名1", "列名2", ...], "rows": [["数据1", "数据2", ...], ...]}`;

    const result = await this.call(
      `请对以下表格数据执行"${instruction}"操作。

当前表格数据：
${JSON.stringify(tableData, null, 2)}`,
      systemPrompt
    );

    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Parse error');
    } catch {
      return tableData;
    }
  },

  // 表格数据分析（增强版）
  async analyzeTable(tableData, question) {
    const truncated = this._truncateTable(tableData);
    const systemPrompt = `你是数据分析专家。当前表格包含以下结构：
- 列名：${tableData.headers.join(', ')}
- 数据行数：${tableData.rows.length}
- 数据类型：${this._inferColumnTypes(tableData)}

请根据表格数据进行分析，给出简洁明确的回答。如果涉及数字计算，请给出具体数值。`;

    return this.call(
      `表格数据：\n${JSON.stringify(truncated, null, 2)}\n\n问题：${question}`,
      systemPrompt
    );
  },

  // AI推荐图表类型
  async suggestCharts(tableData) {
    const truncated = this._truncateTable(tableData);
    const systemPrompt = `你是数据可视化专家。根据表格数据，推荐最适合的图表类型和配置。
请严格按以下 JSON 数组格式输出，不要输出任何其他内容：
[{"type": "bar|line|pie|doughnut|radar|scatter", "title": "图表标题", "xField": "用作X轴的列名", "yFields": ["用作Y轴的列名"], "reason": "推荐理由"}]
最多推荐3个图表。`;

    const result = await this.call(
      `表格数据：\n${JSON.stringify(truncated, null, 2)}`,
      systemPrompt
    );

    try {
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}
    return [];
  },

  // AI数据质量校验
  async validateData(tableData) {
    const truncated = this._truncateTable(tableData);
    const systemPrompt = `你是数据质量检查专家。检查表格数据中的问题，包括：
- 格式不一致（日期、数字格式混用）
- 明显的错误值（负数年龄、未来生日等）
- 重复数据
- 缺失值
请以 JSON 数组格式输出问题列表，不要输出任何其他内容：
[{"row": 行号(从0开始), "column": "列名", "issue": "问题描述", "suggestion": "建议修改为"}]`;

    const result = await this.call(
      `表格数据：\n${JSON.stringify(truncated, null, 2)}`,
      systemPrompt
    );

    try {
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}
    return [];
  },

  // AI智能填充空值
  async autoFill(tableData, targetCol) {
    const truncated = this._truncateTable(tableData);
    const systemPrompt = `你是数据填充专家。根据表格中已有的数据模式，填充指定列中的空值。
请严格按以下 JSON 格式输出完整表格（包含所有原始数据和填充后的数据），不要输出任何其他内容：
{"headers": ["列名1", ...], "rows": [["数据1", ...], ...]}`;

    const result = await this.call(
      `请填充以下表格中"${targetCol}"列的空值：\n${JSON.stringify(truncated, null, 2)}`,
      systemPrompt
    );

    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}
    return tableData;
  },

  // AI汇总统计
  async generateSummary(tableData, instruction) {
    const truncated = this._truncateTable(tableData);
    const systemPrompt = `你是数据汇总专家。根据指令对表格数据进行汇总分析。
请严格按以下 JSON 格式输出，不要输出任何其他内容：
{"summary": "汇总文字说明", "table": {"headers": ["列名1", ...], "rows": [["数据1", ...], ...]}}`;

    const result = await this.call(
      `请对以下数据执行"${instruction}"汇总：\n${JSON.stringify(truncated, null, 2)}`,
      systemPrompt
    );

    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}
    return { summary: result, table: null };
  },

  // 推断列数据类型
  _inferColumnTypes(tableData) {
    if (!tableData.rows || tableData.rows.length === 0) return '未知';
    return tableData.headers.map((header, idx) => {
      const sample = tableData.rows.slice(0, 5).map(r => r[idx]).filter(Boolean);
      if (sample.length === 0) return `${header}(文本)`;
      const allNums = sample.every(v => !isNaN(Number(v)) && v.trim() !== '');
      const allDates = sample.every(v => !isNaN(Date.parse(v)));
      if (allNums) return `${header}(数字)`;
      if (allDates) return `${header}(日期)`;
      return `${header}(文本)`;
    }).join(', ');
  },

  // 截断大数据表（避免超出AI token限制）
  _truncateTable(tableData, maxRows = 50) {
    if (!tableData.rows || tableData.rows.length <= maxRows) return tableData;
    return {
      headers: tableData.headers,
      rows: tableData.rows.slice(0, maxRows),
      _note: `仅显示前${maxRows}行，共${tableData.rows.length}行`
    };
  },

  // ============ 工作摘要功能 ============

  // 生成工作摘要（支持会议纪要和讨论内容）
  async generateWorkSummary(tasks, events, messages, meetingDocs = [], discussionSummary = '') {
    const taskList = tasks.map(t =>
      `- ${t.summary || t.title} (截止: ${t.due || '无'}, 状态: ${t.status || '待办'})`
    ).join('\n');

    const eventList = events.map(e => {
      const start = e.startTime || e.start_time || '';
      const end = e.endTime || e.end_time || '';
      return `- ${start}-${end} ${e.summary || e.title}`;
    }).join('\n');

    const msgList = messages.map(m =>
      `- ${m.content || m.text}`
    ).join('\n');

    const meetingList = meetingDocs.map(d => {
      const title = d.title || d.name || '未知文档';
      const content = d.content || '';
      // 截取前3000字符避免超出token限制
      const truncated = content.length > 3000 ? content.slice(0, 3000) + '...(已截断)' : content;
      return truncated ? `【${title}】\n${truncated}` : `- ${title}`;
    }).join('\n\n');

    let prompt = `请根据以下工作数据，生成简洁的工作摘要和优先级建议：

【待办任务】
${taskList || '无'}

【日程安排】
${eventList || '无'}`;

    if (msgList) {
      prompt += `\n\n【消息通知】\n${msgList}`;
    }

    if (meetingList) {
      prompt += `\n\n【相关会议纪要/文档】\n${meetingList}`;
    }

    if (discussionSummary) {
      prompt += `\n\n【群讨论摘要】\n${discussionSummary}`;
    }

    prompt += `

要求：
1. 2-3句话总结工作重点
2. 按紧急程度排序建议
3. 提醒需要注意的时间节点
4. 如有会议纪要，提炼关键决议和待办
5. 语气友好专业`;

    return this.call(
      prompt,
      '你是资深工作助理，擅长分析工作数据并给出优先级建议。请直接输出摘要。'
    );
  },

  // 任务优先级分析
  async analyzeTaskPriority(tasks) {
    return this.call(
      `请分析以下任务列表，按紧急重要程度排序，并给出执行建议：

${tasks.map((t, i) => `${i + 1}. ${t.summary || t.title} (截止: ${t.due || '无'})`).join('\n')}`,
      '你是任务管理专家，请使用四象限法则分析任务优先级，给出简洁的执行建议。'
    );
  },

  // 流式对话（通过后端 SSE 代理，支持工具调用）
  async streamChat(messages, { onChunk, onToolCall, onToolResult, onDone, onError }) {
    const config = this.getActiveConfig();
    if (!config.apiKey) { onError?.('NO_API_KEY'); return; }

    try {
      const response = await fetch('http://localhost:8081/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          baseURL: config.baseURL,
          apiKey: config.apiKey,
          model: config.model
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        onError?.(err.error || `HTTP ${response.status}`);
        return;
      }

      const reader = response.body.getReader();
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
          if (data === '[DONE]') { onDone?.(); return; }
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'text' && parsed.content) {
              onChunk?.(parsed.content);
            } else if (parsed.type === 'tool_call') {
              onToolCall?.(parsed);
            } else if (parsed.type === 'tool_result') {
              onToolResult?.(parsed);
            } else if (parsed.type === 'error') {
              onError?.(parsed.content);
            }
          } catch {}
        }
      }
      onDone?.();
    } catch (e) {
      onError?.(e.message);
    }
  },

  getErrorMessage(error) {
    if (typeof error !== 'string') return 'AI 服务暂时不可用';
    switch (error) {
      case 'NO_API_KEY': return '请先在设置中配置 API Key';
      case 'INVALID_KEY': return 'API Key 无效，请检查设置';
      case 'RATE_LIMIT': return '请求过于频繁，请稍后再试';
      case 'QUOTA_EXCEEDED': return 'API 额度已用完，请检查账户余额';
      case 'NETWORK_ERROR': return '网络连接失败，请检查网络设置';
      case '无法连接到本地服务，请确保 server.js 已启动': return '无法连接到本地服务，请确保 server.js 已启动';
      default: return 'AI 服务暂时不可用，请稍后再试';
    }
  }
};

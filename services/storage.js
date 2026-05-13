// GoBuddy Storage Service
const WBStorage = {
  // localStorage helpers
  get(key, defaultVal = null) {
    try {
      const val = localStorage.getItem('gobuddy-' + key);
      return val ? JSON.parse(val) : defaultVal;
    } catch {
      return defaultVal;
    }
  },

  set(key, val) {
    localStorage.setItem('gobuddy-' + key, JSON.stringify(val));
  },

  remove(key) {
    localStorage.removeItem('gobuddy-' + key);
  },

  // Settings
  getSettings() {
    return this.get('settings', {
      activeProvider: 'DeepSeek',
      activeModel: 'deepseek-chat',
      waterReminder: 45,
      sitReminder: 60,
      storageMode: 'local',
      welcomeDone: false
    });
  },

  saveSettings(settings) {
    this.set('settings', settings);
  },

  // AI Provider配置管理（支持任何 OpenAI 兼容 API）
  getProviders() {
    return this.get('providers', {
      'DeepSeek': {
        name: 'DeepSeek',
        baseURL: 'https://api.deepseek.com/v1',
        apiKey: '',
        models: {
          'deepseek-chat': { name: 'DeepSeek-V3' },
          'deepseek-reasoner': { name: 'DeepSeek-R1' }
        }
      },
      'OpenAI': {
        name: 'OpenAI',
        baseURL: 'https://api.openai.com/v1',
        apiKey: '',
        models: {
          'gpt-4o': { name: 'GPT-4o' },
          'gpt-4o-mini': { name: 'GPT-4o-mini' },
          'gpt-4-turbo': { name: 'GPT-4 Turbo' }
        }
      },
      'Claude': {
        name: 'Claude',
        baseURL: 'https://api.anthropic.com/v1',
        apiKey: '',
        models: {
          'claude-sonnet-4-6': { name: 'Claude Sonnet 4.6' },
          'claude-haiku-4-5': { name: 'Claude Haiku 4.5' }
        }
      },
      'Moonshot': {
        name: 'Moonshot',
        baseURL: 'https://api.moonshot.cn/v1',
        apiKey: '',
        models: {
          'moonshot-v1-8k': { name: 'Moonshot V1 8K' },
          'moonshot-v1-32k': { name: 'Moonshot V1 32K' }
        }
      }
    });
  },

  saveProviders(providers) {
    this.set('providers', providers);
  },

  getActiveProvider() {
    const settings = this.getSettings();
    const providers = this.getProviders();
    const providerName = settings.activeProvider || 'DeepSeek';
    return providers[providerName] || Object.values(providers)[0];
  },

  getActiveModel() {
    const settings = this.getSettings();
    return settings.activeModel || 'deepseek-chat';
  },

  getApiKey() {
    const provider = this.getActiveProvider();
    return provider ? provider.apiKey : '';
  },

  setActiveProvider(providerName, modelName) {
    const settings = this.getSettings();
    settings.activeProvider = providerName;
    settings.activeModel = modelName;
    this.saveSettings(settings);
  },

  updateProvider(name, config) {
    const providers = this.getProviders();
    providers[name] = { ...providers[name], ...config };
    this.saveProviders(providers);
  },

  addProvider(name, config) {
    const providers = this.getProviders();
    providers[name] = config;
    this.saveProviders(providers);
  },

  removeProvider(name) {
    const providers = this.getProviders();
    delete providers[name];
    this.saveProviders(providers);
  },

  // IndexedDB via Dexie
  db: null,

  initDB() {
    if (this.db) return;
    try {
      this.db = new Dexie('gobuddy-db');
      this.db.version(1).stores({
        tasks: '++id, title, completed, completedAt, createdAt',
        notes: '++id, content, createdAt',
        pomodoroRecords: '++id, startTime, endTime, completed, createdAt',
        messages: '++id, source, sender, priority, processed, createdAt',
        documents: '++id, type, title, content, createdAt',
        tables: '++id, title, data, createdAt'
      });
      this.db.version(2).stores({
        tasks: '++id, title, completed, completedAt, createdAt',
        notes: '++id, content, createdAt',
        pomodoroRecords: '++id, startTime, endTime, completed, createdAt',
        messages: '++id, source, sender, priority, processed, createdAt',
        documents: '++id, type, title, content, createdAt',
        tables: '++id, title, data, createdAt',
        conversations: '++id, title, updatedAt'
      });
      console.log('[Storage] DB initialized');
    } catch (e) {
      console.error('[Storage] DB init error:', e);
    }
  },

  // Tasks
  async addTask(task) {
    try {
      this.initDB();
      const result = await this.db.tasks.add({
        ...task,
        completed: false,
        createdAt: new Date().toISOString()
      });
      console.log('[Storage] addTask success, id:', result);
      return result;
    } catch (e) {
      console.error('[Storage] addTask error:', e);
      throw e;
    }
  },

  async getTasks(filter = {}) {
    try {
      this.initDB();
      if (filter.completed !== undefined) {
        return await this.db.tasks.where('completed').equals(filter.completed ? 1 : 0).reverse().sortBy('createdAt');
      }
      return await this.db.tasks.orderBy('createdAt').reverse().toArray();
    } catch (e) {
      console.error('getTasks error:', e);
      return [];
    }
  },

  async completeTask(id) {
    try {
      this.initDB();
      return await this.db.tasks.update(id, { completed: true, completedAt: new Date().toISOString() });
    } catch (e) {
      console.error('[Storage] completeTask error:', e);
      throw e;
    }
  },

  async deleteTask(id) {
    try {
      this.initDB();
      return await this.db.tasks.delete(id);
    } catch (e) {
      console.error('[Storage] deleteTask error:', e);
      throw e;
    }
  },

  // Notes
  async addNote(content) {
    try {
      this.initDB();
      const result = await this.db.notes.add({
        content,
        createdAt: new Date().toISOString()
      });
      console.log('[Storage] addNote success, id:', result);
      return result;
    } catch (e) {
      console.error('addNote error:', e);
    }
  },

  async getNotes(since = null) {
    try {
      this.initDB();
      if (since) {
        return await this.db.notes.where('createdAt').above(since).reverse().sortBy('createdAt');
      }
      return await this.db.notes.orderBy('createdAt').reverse().toArray();
    } catch (e) {
      console.error('getNotes error:', e);
      return [];
    }
  },

  async updateNote(id, content) {
    try {
      this.initDB();
      return await this.db.notes.update(id, { content });
    } catch (e) {
      console.error('[Storage] updateNote error:', e);
      throw e;
    }
  },

  async deleteNote(id) {
    try {
      this.initDB();
      return await this.db.notes.delete(id);
    } catch (e) {
      console.error('[Storage] deleteNote error:', e);
      throw e;
    }
  },

  // Conversations
  async saveConversation(conv) {
    this.initDB();
    conv.updatedAt = new Date().toISOString();
    if (conv.id) {
      await this.db.conversations.update(conv.id, conv);
      return conv.id;
    }
    conv.createdAt = conv.updatedAt;
    return this.db.conversations.add(conv);
  },

  async getConversations() {
    this.initDB();
    return this.db.conversations.orderBy('updatedAt').reverse().toArray();
  },

  async getConversation(id) {
    this.initDB();
    return this.db.conversations.get(id);
  },

  async deleteConversation(id) {
    this.initDB();
    return this.db.conversations.delete(id);
  },

  // Pomodoro
  async addPomodoro(startTime, endTime, completed = true) {
    this.initDB();
    return this.db.pomodoroRecords.add({
      startTime,
      endTime,
      completed,
      createdAt: new Date().toISOString()
    });
  },

  async getPomodoros(since = null) {
    this.initDB();
    if (since) {
      return this.db.pomodoroRecords.where('createdAt').above(since).reverse().sortBy('createdAt');
    }
    return this.db.pomodoroRecords.orderBy('createdAt').reverse().toArray();
  },

  // Messages
  async addMessage(msg) {
    this.initDB();
    return this.db.messages.add({
      ...msg,
      processed: false,
      createdAt: new Date().toISOString()
    });
  },

  async getMessages(filter = {}) {
    try {
      this.initDB();
      if (filter.processed !== undefined) {
        return await this.db.messages.where('processed').equals(filter.processed ? 1 : 0).reverse().sortBy('createdAt');
      }
      return await this.db.messages.orderBy('createdAt').reverse().toArray();
    } catch (e) {
      console.error('getMessages error:', e);
      return [];
    }
  },

  async processMessage(id) {
    this.initDB();
    return this.db.messages.update(id, { processed: true });
  },

  async deleteMessage(id) {
    this.initDB();
    return this.db.messages.delete(id);
  },

  // Documents
  async addDocument(doc) {
    this.initDB();
    return this.db.documents.add({
      ...doc,
      createdAt: new Date().toISOString()
    });
  },

  async getDocuments(type = null) {
    try {
      this.initDB();
      if (type) {
        return await this.db.documents.where('type').equals(type).reverse().sortBy('createdAt');
      }
      return await this.db.documents.orderBy('createdAt').reverse().toArray();
    } catch (e) {
      console.error('getDocuments error:', e);
      return [];
    }
  },

  async deleteDocument(id) {
    this.initDB();
    return this.db.documents.delete(id);
  },

  // Tables
  async addTable(table) {
    this.initDB();
    return this.db.tables.add({
      ...table,
      createdAt: new Date().toISOString()
    });
  },

  async getTables() {
    try {
      this.initDB();
      return await this.db.tables.orderBy('createdAt').reverse().toArray();
    } catch (e) {
      console.error('getTables error:', e);
      return [];
    }
  },

  async deleteTable(id) {
    this.initDB();
    return this.db.tables.delete(id);
  },


  // Export all data
  async exportAll() {
    this.initDB();
    const data = {
      tasks: await this.db.tasks.toArray(),
      notes: await this.db.notes.toArray(),
      pomodoroRecords: await this.db.pomodoroRecords.toArray(),
      messages: await this.db.messages.toArray(),
      documents: await this.db.documents.toArray(),
      tables: await this.db.tables.toArray(),
      settings: this.getSettings(),
      exportDate: new Date().toISOString()
    };
    return data;
  },

  // Import data
  async importAll(data) {
    this.initDB();
    await this.db.tasks.bulkAdd(data.tasks || []);
    await this.db.notes.bulkAdd(data.notes || []);
    await this.db.pomodoroRecords.bulkAdd(data.pomodoroRecords || []);
    await this.db.messages.bulkAdd(data.messages || []);
    await this.db.documents.bulkAdd(data.documents || []);
    await this.db.tables.bulkAdd(data.tables || []);
    if (data.settings) this.saveSettings(data.settings);
  }
};

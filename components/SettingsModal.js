// Settings Modal Component - 多Provider配置版
const SettingsModal = {
  name: 'SettingsModal',
  props: ['visible'],
  emits: ['close', 'saved'],
  setup(props, { emit }) {
    const { ref, watch, computed, onMounted, nextTick } = Vue;

    // Provider配置
    const providers = ref({});
    const activeProvider = ref('');
    const activeModel = ref('');
    const editingProvider = ref(null);
    const showAddDialog = ref(false);

    // 测试状态
    const testing = ref(false);
    const testResult = ref(null);

    // 新增Provider表单
    const newProvider = ref({
      name: '',
      baseURL: '',
      apiKey: '',
      models: {}
    });
    const newModelKey = ref('');
    const newModelName = ref('');

    // 加载设置
    const loadSettings = () => {
      providers.value = WBStorage.getProviders();
      const settings = WBStorage.getSettings();
      activeProvider.value = settings.activeProvider || 'DeepSeek';
      activeModel.value = settings.activeModel || 'deepseek-chat';
    };

    // 当前Provider的模型列表
    const currentModels = computed(() => {
      const provider = providers.value[activeProvider.value];
      return provider ? provider.models : {};
    });

    // 切换Provider
    const switchProvider = (name) => {
      activeProvider.value = name;
      const models = Object.keys(providers.value[name]?.models || {});
      if (models.length > 0) {
        activeModel.value = models[0];
      }
    };

    // 测试连接
    const testConnection = async () => {
      const provider = providers.value[activeProvider.value];
      if (!provider || !provider.apiKey) {
        testResult.value = { success: false, error: '请先输入 API Key' };
        return;
      }

      testing.value = true;
      testResult.value = null;
      try {
        testResult.value = await WBAI.testConnection({
          baseURL: provider.baseURL,
          apiKey: provider.apiKey,
          model: activeModel.value
        });
      } catch (e) {
        testResult.value = { success: false, error: '测试失败：' + e.message };
      }
      testing.value = false;
    };

    // 更新Provider的API Key
    const updateApiKey = (name, key) => {
      if (providers.value[name]) {
        providers.value[name].apiKey = key;
      }
    };

    // 更新Provider的Base URL
    const updateBaseURL = (name, url) => {
      if (providers.value[name]) {
        providers.value[name].baseURL = url;
      }
    };

    // 添加新模型
    const addModel = () => {
      if (!newModelKey.value.trim() || !newModelName.value.trim()) {
        ElementPlus.ElMessage.warning('请输入模型ID和名称');
        return;
      }
      if (providers.value[activeProvider.value]) {
        providers.value[activeProvider.value].models[newModelKey.value] = {
          name: newModelName.value
        };
        newModelKey.value = '';
        newModelName.value = '';
      }
    };

    // 删除模型
    const removeModel = (providerName, modelKey) => {
      if (providers.value[providerName]) {
        delete providers.value[providerName].models[modelKey];
      }
    };

    // 添加新Provider
    const addProvider = () => {
      if (!newProvider.value.name.trim() || !newProvider.value.baseURL.trim()) {
        ElementPlus.ElMessage.warning('请输入Provider名称和Base URL');
        return;
      }
      const name = newProvider.value.name;
      providers.value[name] = {
        name: name,
        baseURL: newProvider.value.baseURL,
        apiKey: newProvider.value.apiKey,
        models: {}
      };
      showAddDialog.value = false;
      newProvider.value = { name: '', baseURL: '', apiKey: '', models: {} };
      activeProvider.value = name;
      ElementPlus.ElMessage.success('Provider添加成功');
    };

    // 删除Provider
    const deleteProvider = (name) => {
      if (Object.keys(providers.value).length <= 1) {
        ElementPlus.ElMessage.warning('至少保留一个Provider');
        return;
      }
      delete providers.value[name];
      if (activeProvider.value === name) {
        activeProvider.value = Object.keys(providers.value)[0];
        const models = Object.keys(providers.value[activeProvider.value]?.models || {});
        activeModel.value = models[0] || '';
      }
    };

    // 保存设置
    const save = () => {
      // 保存Provider配置
      WBStorage.saveProviders(providers.value);

      // 保存设置
      WBStorage.saveSettings({
        activeProvider: activeProvider.value,
        activeModel: activeModel.value,
        storageMode: 'local',
        welcomeDone: true
      });

      emit('saved');
      emit('close');
      ElementPlus.ElMessage.success('设置已保存');
    };

    // 监听弹窗显示
    watch(() => props.visible, (val) => {
      if (val) {
        loadSettings();
        testResult.value = null;
        nextTick(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); });
      }
    });

    onMounted(() => {
      nextTick(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); });
    });

    return {
      providers, activeProvider, activeModel,
      currentModels, editingProvider,
      showAddDialog, newProvider, newModelKey, newModelName,
      testing, testResult,
      switchProvider, testConnection,
      updateApiKey, updateBaseURL,
      addModel, removeModel,
      addProvider, deleteProvider,
      save, emit
    };
  },
  template: `
    <el-dialog
      :model-value="visible"
      @update:model-value="emit('close')"
      width="680px"
      :close-on-click-modal="true"
    >
      <template #title><i data-lucide="settings" style="width:16px;height:16px"></i> 设置</template>
      <div style="padding: 8px 0">
        <!-- AI Provider设置 -->
        <h4 style="margin-bottom:16px;color:#3370FF"><i data-lucide="sparkles" style="width:16px;height:16px"></i> AI 服务配置</h4>

        <!-- Provider选择 -->
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
          <el-tag
            v-for="(provider, name) in providers"
            :key="name"
            :type="activeProvider === name ? '' : 'info'"
            style="cursor:pointer"
            @click="switchProvider(name)"
            closable
            @close="deleteProvider(name)"
          >
            {{ name }}
          </el-tag>
          <el-button size="small" @click="showAddDialog = true">+ 添加Provider</el-button>
        </div>

        <!-- 当前Provider配置 -->
        <div v-if="providers[activeProvider]" style="background:#F8FAFF;padding:16px;border-radius:8px;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h5 style="margin:0">{{ activeProvider }}</h5>
            <el-tag size="small" type="success">当前使用</el-tag>
          </div>

          <el-form label-position="top" size="small">
            <el-form-item label="Base URL">
              <el-input
                :model-value="providers[activeProvider].baseURL"
                @input="updateBaseURL(activeProvider, $event)"
                placeholder="https://api.deepseek.com/v1"
              />
            </el-form-item>

            <el-form-item label="API Key">
              <el-input
                :model-value="providers[activeProvider].apiKey"
                @input="updateApiKey(activeProvider, $event)"
                type="password"
                show-password
                placeholder="请输入 API Key"
              />
            </el-form-item>

            <el-form-item label="模型选择">
              <el-select v-model="activeModel" style="width:100%">
                <el-option
                  v-for="(model, key) in currentModels"
                  :key="key"
                  :label="model.name + ' (' + key + ')'"
                  :value="key"
                />
              </el-select>
            </el-form-item>

            <!-- 模型管理 -->
            <el-form-item label="模型管理">
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
                <el-tag
                  v-for="(model, key) in currentModels"
                  :key="key"
                  closable
                  @close="removeModel(activeProvider, key)"
                >
                  {{ model.name }}
                </el-tag>
              </div>
              <div style="display:flex;gap:8px">
                <el-input v-model="newModelKey" placeholder="模型ID" size="small" />
                <el-input v-model="newModelName" placeholder="显示名称" size="small" />
                <el-button size="small" @click="addModel">添加</el-button>
              </div>
            </el-form-item>
          </el-form>

          <!-- 测试连接 -->
          <div style="display:flex;gap:8px;align-items:center;margin-top:12px">
            <el-button @click="testConnection" :loading="testing">测试连接</el-button>
            <div v-if="testResult" style="display:flex;align-items:center;gap:4px">
              <span :style="{color: testResult.success ? '#34C759' : '#F54A45', fontSize:'16px'}">{{ testResult.success ? '✓' : '✕' }}</span>
              <span :style="{color: testResult.success ? '#34C759' : '#F54A45', fontSize:'13px'}">
                {{ testResult.success ? '连接成功' : testResult.error }}
              </span>
            </div>
          </div>
        </div>

      </div>

      <template #footer>
        <el-button @click="emit('close')">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>

      <!-- 添加Provider弹窗 -->
      <el-dialog
        v-model="showAddDialog"
        title="添加 AI Provider"
        width="480px"
        append-to-body
      >
        <el-form label-position="top">
          <el-form-item label="Provider名称" required>
            <el-input v-model="newProvider.name" placeholder="如: MyProvider" />
          </el-form-item>
          <el-form-item label="Base URL" required>
            <el-input v-model="newProvider.baseURL" placeholder="https://api.example.com/v1" />
          </el-form-item>
          <el-form-item label="API Key">
            <el-input v-model="newProvider.apiKey" type="password" show-password placeholder="请输入 API Key" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showAddDialog = false">取消</el-button>
          <el-button type="primary" @click="addProvider">添加</el-button>
        </template>
      </el-dialog>
    </el-dialog>
  `
};

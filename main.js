// GoBuddy Main Application
const { createApp, ref, computed, onMounted } = Vue;

const app = createApp({
  setup() {
    const activeModule = ref('dashboard');
    const settingsVisible = ref(false);

    const pageTitleMap = {
      dashboard: '工作看板',
      document: '飞书文档',
      table: '飞书表格',
      message: '讯息聚合',
      chat: 'AI 对话',
      settings: '设置'
    };

    const pageTitle = computed(() => pageTitleMap[activeModule.value] || 'GoBuddy');

    const navigate = (id) => {
      if (id === 'settings') {
        settingsVisible.value = true;
      } else {
        activeModule.value = id;
      }
    };

    const openSettings = () => {
      settingsVisible.value = true;
    };

    const onSettingsSaved = () => {};

    const dashboardRef = ref(null);

    const onNoteAdded = () => {
      // Refresh dashboard if active
      if (activeModule.value === 'dashboard' && dashboardRef.value?.loadData) {
        dashboardRef.value.loadData();
      }
    };

    onMounted(async () => {
      await WBNotify.init();
      // 首次启动时检查 API Key，未配置则自动打开设置
      const provider = WBStorage.getActiveProvider();
      if (!provider?.apiKey) {
        settingsVisible.value = true;
      }
    });

    return {
      activeModule, pageTitle, settingsVisible, dashboardRef,
      navigate, openSettings, onSettingsSaved, onNoteAdded
    };
  },
  template: `
    <div class="app-layout">
      <sidebar :active-module="activeModule" @navigate="navigate" />

      <div class="main-area">
        <top-nav :page-title="pageTitle" @open-settings="openSettings" @navigate="navigate" />

        <div class="content-area">
          <dashboard v-show="activeModule === 'dashboard'" ref="dashboardRef" @navigate="navigate" />
          <document-page v-show="activeModule === 'document'" />
          <table-page v-show="activeModule === 'table'" />
          <message-page v-show="activeModule === 'message'" />
          <chat-page v-show="activeModule === 'chat'" />
        </div>
      </div>

      <!-- Quick Note FAB -->
      <quick-note @added="onNoteAdded" />

      <!-- Settings Modal -->
      <settings-modal
        :visible="settingsVisible"
        @close="settingsVisible = false"
        @saved="onSettingsSaved"
      />
    </div>
  `
});

// Electron: 让 Vue 识别 <webview> 自定义元素
if (window.electronAPI) {
  app.config.compilerOptions.isCustomElement = (tag) => tag === 'webview';
}

// Register components
app.component('sidebar', Sidebar);
app.component('top-nav', TopNav);
app.component('settings-modal', SettingsModal);
app.component('quick-note', QuickNote);
app.component('dashboard', Dashboard);
app.component('dashboard-tasks', DashboardTasks);
app.component('document-page', DocumentPage);
app.component('table-page', TablePage);
app.component('message-page', MessagePage);
app.component('chat-page', ChatPage);

// Register Element Plus
app.use(ElementPlus);

// Mount
app.mount('#app');

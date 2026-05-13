// Sidebar Component
const Sidebar = {
  name: 'Sidebar',
  props: ['activeModule'],
  emits: ['navigate'],
  setup(props, { emit }) {
    const { onMounted, watch, nextTick } = Vue;

    const modules = [
      { id: 'dashboard', icon: 'layout-dashboard', label: '工作看板' },
      { id: 'document', icon: 'file-text', label: '飞书文档' },
      { id: 'table', icon: 'table-2', label: '飞书表格' },
      { id: 'message', icon: 'message-square', label: '讯息聚合' },
      { id: 'chat', icon: 'message-circle', label: 'AI 对话' },
    ];

    const handleNav = (id) => {
      emit('navigate', id);
    };

    const refreshIcons = () => {
      nextTick(() => {
        if (typeof lucide !== 'undefined') {
          lucide.createIcons();
        }
      });
    };

    onMounted(refreshIcons);
    watch(() => props.activeModule, refreshIcons);

    return { modules, handleNav };
  },
  template: `
    <div class="sidebar">
      <div class="sidebar-logo">
        <div class="logo-icon"><i data-lucide="sparkles" style="width:18px;height:18px"></i></div>
        <span class="logo-text">GoBuddy</span>
      </div>
      <div class="sidebar-nav">
        <div
          v-for="mod in modules"
          :key="mod.id"
          class="sidebar-item"
          :class="{ active: activeModule === mod.id }"
          @click="handleNav(mod.id)"
        >
          <span class="item-icon"><i :data-lucide="mod.icon"></i></span>
          <span>{{ mod.label }}</span>
        </div>
      </div>
      <div class="sidebar-divider"></div>
      <div class="sidebar-bottom">
        <div
          class="sidebar-item"
          :class="{ active: activeModule === 'settings' }"
          @click="handleNav('settings')"
        >
          <span class="item-icon"><i data-lucide="settings"></i></span>
          <span>设置</span>
        </div>
      </div>
    </div>
  `
};

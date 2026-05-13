// TopNav Component
const TopNav = {
  name: 'TopNav',
  props: ['pageTitle'],
  emits: ['navigate'],
  setup(props, { emit }) {
    const { ref, onMounted } = Vue;

    const feishuConnected = ref(false);
    const feishuLoading = ref(false);

    const checkStatus = async () => {
      try {
        feishuConnected.value = await WBFeishu.checkConnection();
      } catch {
        feishuConnected.value = false;
      }
    };

    const showServerNotRunning = () => {
      ElementPlus.ElMessageBox.alert(
        '请先双击项目目录下的 <b>start.bat</b> 启动服务，然后刷新页面重试。',
        '本地服务未启动',
        {
          confirmButtonText: '我知道了',
          type: 'warning',
          dangerouslyUseHTMLString: true
        }
      );
    };

    const connectFeishu = async () => {
      feishuLoading.value = true;
      try {
        await WBFeishu.login();
        feishuConnected.value = true;
        // 清除连接状态缓存，通知所有模块刷新
        WBFeishu.lastCheck = 0;
        WBFeishu.connected = true;
        window.dispatchEvent(new CustomEvent('feishu-connected'));
        ElementPlus.ElMessage.success('飞书连接成功');
      } catch (e) {
        if (e.message.includes('无法连接到本地服务')) {
          showServerNotRunning();
        } else {
          ElementPlus.ElMessage.error('飞书连接失败：' + e.message);
        }
      }
      feishuLoading.value = false;
    };

    onMounted(checkStatus);

    return {
      feishuConnected, feishuLoading,
      connectFeishu, checkStatus
    };
  },
  template: `
    <div class="top-nav">
      <div class="page-title">{{ pageTitle }}</div>
      <div style="display:flex;align-items:center;gap:16px">
        <div
          style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;padding:4px 10px;border-radius:3px;transition:background 0.2s"
          :style="{ color: feishuConnected ? '#34C759' : '#888D92', background: feishuConnected ? 'transparent' : 'transparent' }"
          @click="feishuConnected ? null : connectFeishu()"
          @mouseenter="$event.target.style.background='#F0F1F5'"
          @mouseleave="$event.target.style.background='transparent'"
        >
          <span
            style="width:6px;height:6px;border-radius:50%;display:inline-block;flex-shrink:0"
            :style="{ background: feishuConnected ? '#34C759' : '#C6CACD' }"
          ></span>
          <span>飞书</span>
          <span v-if="feishuLoading" style="font-size:11px;color:#888D92">连接中...</span>
        </div>
      </div>
    </div>
  `
};

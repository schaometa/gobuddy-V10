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
        const loginResult = await WBFeishu.login();

        // 步骤 1：lark-cli 未配置 → 先引导配置
        if (loginResult.needConfig) {
          feishuLoading.value = false;
          try {
            const configResult = await WBFeishu.request('/config/init', { method: 'POST' });
            if (configResult.verification_url) {
              window.open(configResult.verification_url, '_blank');
            }
            await ElementPlus.ElMessageBox({
              title: '飞书应用配置',
              message: '请在浏览器中完成飞书应用配置，完成后点击"已完成"。',
              confirmButtonText: '已完成',
              closeOnClickModal: false,
              closeOnPressEscape: false,
            });
            // 配置完成后重新触发登录
            return connectFeishu();
          } catch (e) {
            if (e.message && !e.message.includes('cancel')) {
              ElementPlus.ElMessage.error('配置失败：' + e.message);
            }
            return;
          }
        }

        const deviceCode = loginResult.device_code;
        if (!deviceCode) throw new Error('未获取到授权码');

        // 弹窗提示用户在浏览器中完成授权
        const msgBox = ElementPlus.ElMessageBox({
          title: '飞书登录',
          message: '请在浏览器中完成飞书授权，完成后会自动连接。',
          type: 'info',
          showCancelButton: true,
          confirmButtonText: '已完成授权',
          cancelButtonText: '取消',
          closeOnClickModal: false,
          closeOnPressEscape: false,
        });

        // 后台轮询等待用户授权
        let authDone = false;
        const poll = async () => {
          while (!authDone) {
            await new Promise(r => setTimeout(r, 3000));
            if (authDone) break;
            try {
              const r = await WBFeishu.loginPoll(deviceCode);
              if (r.success) {
                authDone = true;
                feishuConnected.value = true;
                WBFeishu.lastCheck = 0;
                WBFeishu.connected = true;
                window.dispatchEvent(new CustomEvent('feishu-connected'));
                ElementPlus.ElMessage.success('飞书连接成功');
                // 关闭弹窗
                document.querySelector('.el-message-box__headerbtn')?.click();
                break;
              }
            } catch {}
          }
        };
        poll();

        await msgBox.catch(() => { authDone = true; }); // 用户取消
      } catch (e) {
        if (e.message && e.message.includes('无法连接到本地服务')) {
          showServerNotRunning();
        } else if (e.message && !e.message.includes('cancel')) {
          ElementPlus.ElMessage.error('飞书连接失败：' + e.message);
        }
      }
      feishuLoading.value = false;
    };

    const disconnectFeishu = async () => {
      try {
        await ElementPlus.ElMessageBox.confirm('确定要退出飞书登录吗？', '退出登录', {
          confirmButtonText: '退出',
          cancelButtonText: '取消',
          type: 'warning',
        });
        await WBFeishu.logout();
        feishuConnected.value = false;
        window.dispatchEvent(new CustomEvent('feishu-disconnected'));
        ElementPlus.ElMessage.success('已退出飞书登录');
      } catch {}
    };

    onMounted(checkStatus);

    return {
      feishuConnected, feishuLoading,
      connectFeishu, disconnectFeishu, checkStatus
    };
  },
  template: `
    <div class="top-nav">
      <div class="page-title">{{ pageTitle }}</div>
      <div style="display:flex;align-items:center;gap:16px">
        <div
          style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;padding:4px 10px;border-radius:3px;transition:background 0.2s"
          :style="{ color: feishuConnected ? '#34C759' : '#888D92', background: feishuConnected ? 'transparent' : 'transparent' }"
          @click="feishuConnected ? disconnectFeishu() : connectFeishu()"
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

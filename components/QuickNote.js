// Quick Note Component
const QuickNote = {
  name: 'QuickNote',
  emits: ['added'],
  setup(props, { emit }) {
    const { ref, onMounted, nextTick } = Vue;

    const showInput = ref(false);
    const noteContent = ref('');

    const saving = ref(false);

    onMounted(() => {
      nextTick(() => { if (typeof lucide !== 'undefined') lucide.createIcons(); });
    });

    const addNote = async () => {
      const text = noteContent.value.trim();
      if (!text || saving.value) return;
      saving.value = true;
      try {
        const id = await WBStorage.addNote(text);
        console.log('[QuickNote] saved, id:', id);
        noteContent.value = '';
        showInput.value = false;
        emit('added');
        ElementPlus.ElMessage.success('笔记已保存');
      } catch (e) {
        console.error('[QuickNote] save error:', e);
        ElementPlus.ElMessage.error('保存失败：' + e.message);
      }
      saving.value = false;
    };

    const toggle = () => {
      showInput.value = !showInput.value;
      if (showInput.value) {
        nextTick(() => {
          if (typeof lucide !== 'undefined') lucide.createIcons();
          const input = document.querySelector('.quick-note-input');
          if (input) input.focus();
        });
      }
    };

    return { showInput, noteContent, addNote, toggle, saving };
  },
  template: `
    <div class="quick-note-fab">
      <!-- Float Button -->
      <el-button
        type="primary"
        circle
        size="large"
        @click="toggle"
        style="width:56px;height:56px;font-size:24px;box-shadow:0 1px 4px rgba(0,0,0,0.08)"
      >
        {{ showInput ? '✕' : '✎' }}
      </el-button>

      <!-- Input Popup -->
      <div v-if="showInput"
        style="position:absolute;bottom:64px;right:0;width:320px;background:#fff;border-radius:8px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.12);"
        class="fade-in"
      >
        <div style="font-size:14px;font-weight:600;margin-bottom:8px;color:#1C1F23"><i data-lucide="pen-line" style="width:16px;height:16px"></i> 快捷笔记</div>
        <el-input
          v-model="noteContent"
          type="textarea"
          :rows="3"
          placeholder="想到什么，记下来..."
          class="quick-note-input"
          @keydown.enter.ctrl="addNote"
        />
        <div style="display:flex;justify-content:space-between;margin-top:8px">
          <span style="font-size:12px;color:#888D92">Ctrl+Enter 保存</span>
          <el-button type="primary" size="small" @click="addNote" :loading="saving">保存</el-button>
        </div>
      </div>
    </div>
  `
};

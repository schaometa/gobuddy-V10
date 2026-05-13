// GoBuddy Notification Service
const WBNotify = {
  permission: 'default',

  async init() {
    if (!('Notification' in window)) return;
    this.permission = Notification.permission;
    // 只在用户主动启用时请求权限，不再自动弹出
    const asked = localStorage.getItem('gobuddy-notify-asked');
    if (this.permission === 'default' && !asked) {
      localStorage.setItem('gobuddy-notify-asked', 'true');
      this.permission = await Notification.requestPermission();
    }
  },

  canNotify() {
    return this.permission === 'granted';
  },

  send(title, options = {}) {
    if (!this.canNotify()) return;
    const n = new Notification(title, {
      icon: '',
      badge: '',
      ...options
    });
    setTimeout(() => n.close(), 5000);
    return n;
  },

  // Pomodoro notifications
  pomodoroFocusEnd() {
    this.send('🍅 专注时间结束！', {
      body: '辛苦了！休息5分钟吧～',
      tag: 'pomodoro'
    });
  },

  pomodoroRestEnd() {
    this.send('💪 休息结束！', {
      body: '准备好了吗？开始下一个番茄吧～',
      tag: 'pomodoro'
    });
  },

  // Health reminders
  waterReminder() {
    this.send('💧 该喝水啦！', {
      body: '保持充足水分，工作更高效～',
      tag: 'water'
    });
  },

  sitReminder() {
    this.send('🧍 该起来活动了！', {
      body: '久坐危害大，站起来走走吧～',
      tag: 'sit'
    });
  },

  // Health reminder timers
  _waterTimer: null,
  _sitTimer: null,
  _lastActivity: Date.now(),

  startHealthReminders() {
    this.stopHealthReminders();
    const settings = WBStorage.getSettings();

    // Water reminder
    if (settings.waterReminder > 0) {
      this._waterTimer = setInterval(() => {
        this.waterReminder();
      }, settings.waterReminder * 60 * 1000);
    }

    // Sit reminder (reset on activity)
    if (settings.sitReminder > 0) {
      this._sitTimer = setInterval(() => {
        const elapsed = Date.now() - this._lastActivity;
        if (elapsed >= settings.sitReminder * 60 * 1000) {
          this.sitReminder();
          this._lastActivity = Date.now();
        }
      }, 60000); // check every minute
    }

    // Track user activity
    const resetActivity = () => { this._lastActivity = Date.now(); };
    document.addEventListener('mousemove', resetActivity);
    document.addEventListener('keydown', resetActivity);
  },

  stopHealthReminders() {
    if (this._waterTimer) clearInterval(this._waterTimer);
    if (this._sitTimer) clearInterval(this._sitTimer);
    this._waterTimer = null;
    this._sitTimer = null;
  }
};

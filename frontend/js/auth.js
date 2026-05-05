const Auth = {
  _key: 'bom_current_user',

  // 登录：优先尝试后端 API，失败则回退到 localStorage
  async login(u, p) {
    // 1. 尝试后端登录
    const data = await API.login(u, p);
    if (data && data.access_token) {
      try {
        const me = await API.getMe();
        // 转换后端字段名（snake_case → camelCase）
        const userData = {
          id: me.id,
          username: me.username,
          realName: me.real_name || me.username,
          role: me.role,
          department: me.department || '',
          phone: me.phone || '',
        };
        // 保存用户信息到 localStorage（保持兼容）
        localStorage.setItem(this._key, JSON.stringify(userData));
        Store.addLog('用户登录', userData.realName + '(' + userData.role + ')登录系统');
        // 登录后自动同步本地数据到后端
        Store.onLogin();
        return true;
      } catch (e) {
        // 后端 API 有 token 但获取用户信息失败，回退到本地
      }
    }
    // 2. 回退：使用本地 localStorage 账号
    const user = Store.getAll('users').find(x => x.username === u && x.password === p && x.status === 'active');
    if (!user) return false;
    localStorage.setItem(this._key, JSON.stringify(user));
    Store.addLog('用户登录', user.realName + '(' + user.role + ')登录系统');
    return true;
  },

  logout() {
    const u = this.getUser();
    if (u) Store.addLog('用户退出', u.realName + '退出系统');
    localStorage.removeItem(this._key);
    API.clearToken();
  },

  getUser() { try { return JSON.parse(localStorage.getItem(this._key)); } catch { return null; } },
  hasRole(r) { const u = this.getUser(); return u && r.includes(u.role); },
  canEdit() { const u = this.getUser(); return u && (u.role === 'admin' || u.role === 'engineer'); },
  canDownload() { const u = this.getUser(); return u && u.role !== 'guest'; },
  canPreview() { const u = this.getUser(); return u && u.role; },
  isAdmin() { const u = this.getUser(); return u && u.role === 'admin'; },
  refreshUser() { const u = this.getUser(); if (u) { const f = Store.getById('users', u.id); if (f) localStorage.setItem(this._key, JSON.stringify(f)); } }
};

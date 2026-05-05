const Router = {

  _titles: { dashboard:'仪表板', board:'用户看板', parts:'零件管理', components:'部件管理', bom:'BOM管理', documents:'图文档管理', users:'用户管理', logs:'操作日志', settings:'系统设置' },

  navigate(page) {

    document.querySelectorAll('.sidebar-nav a').forEach(function(a) { a.classList.toggle('active', a.dataset.page === page); });

    document.getElementById('breadcrumb').textContent = this._titles[page] || page;

    this.render();

  },

  render() {

    var c = document.getElementById('content');

    var p = document.querySelector('.sidebar-nav a.active');

    var page = p ? p.dataset.page : 'dashboard';

    switch (page) {

      case 'dashboard': Dashboard.render(c); break;

      case 'board': Board.render(c); break;

      case 'parts': Parts.render(c); break;

      case 'components': Components.render(c); break;

      case 'bom': Bom.render(c); break;

      case 'documents': Documents.render(c); break;

      case 'users': Users.render(c); break;

      case 'logs': Logs.render(c); break;

      case 'settings': Settings.render(c); break;

      default: c.innerHTML = '<p>页面不存在</p>';

    }

  },

  init() {

    var user = Auth.getUser();

    if (!user) return;

    var self = this;

    document.querySelectorAll('.sidebar-nav a').forEach(function(a) {

      var roles = a.dataset.roles ? a.dataset.roles.split(',') : [];

      if (roles.length && roles.indexOf(user.role) < 0) a.style.display = 'none';

      a.onclick = function(e) { e.preventDefault(); self.navigate(a.dataset.page); };

    });

    document.getElementById('logout-btn').onclick = function() {

      UI.confirm('确定要退出登录吗？', function() {

        Auth.logout();

        document.getElementById('app').style.display = 'none';

        document.getElementById('login-page').style.display = 'flex';

      });

    };

    var rn = { admin:'管理员', engineer:'工程师', production:'生产管理', guest:'访客' };

    document.getElementById('user-badge').textContent = user.realName + ' · ' + rn[user.role];

    this.navigate('dashboard');

  }

};
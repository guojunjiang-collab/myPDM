var Dashboard = {
  render: function(c) {
    // 原 Pages.dashboard 函数体
    var parts = Store.getAll('parts');
    var comps = Store.getAll('components');
    var boms = Store.getAll('bom');
    var logs = Store.getAll('logs').slice(-8).reverse();
    c.innerHTML =
      '<div class="stats-row">' +
        '<div class="stat-card"><div class="stat-icon blue">🔧</div><div class="stat-info"><div class="label">零件总数</div><div class="value">' + parts.length + '</div></div></div>' +
        '<div class="stat-card"><div class="stat-icon green">📦</div><div class="stat-info"><div class="label">部件总数</div><div class="value">' + comps.length + '</div></div></div>' +
      '</div>' +
      '<div class="card"><div class="card-header">📝 最近操作</div><div class="card-body"><div class="log-list">' +
        (logs.length === 0 ? '<p style="color:var(--text-light)">暂无日志</p>' :
          logs.map(function(l) { return '<div class="log-item"><span class="log-time">' + UI.formatDate(l.time) + '</span><span class="log-user">' + l.user + '</span><span class="log-action">' + l.action + (l.detail ? ' - ' + l.detail : '') + '</span></div>'; }).join('')) +
      '</div></div>';
  }
};
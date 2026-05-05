var Board = {
  _state: {
    dashboard: null,
    selectedFolder: null,
    tab: 'all',      // all | part | assembly | document
    expanded: {},     // folder_id -> bool
    loading: false,
  },

  render: function(c) {
    var self = this;
    var canE = Auth.hasRole(['admin','engineer','production','guest']);

    c.innerHTML =
      '<div class="page-header"><h2>🗂️ 用户看板</h2><div class="actions">' +
        (canE ? '<button class="btn-primary" id="btn-new-folder">＋ 新建文件夹</button>' : '') +
        (canE ? '<button class="btn-outline" id="btn-link-item" style="margin-left:8px">＋ 关联项目</button>' : '') +
      '</div></div>' +
      '<div class="board-layout">' +
        '<div class="board-sidebar" id="board-tree"></div>' +
        '<div class="board-content" id="board-content"></div>' +
      '</div>';

    this._loadDashboard();

    document.getElementById('btn-new-folder').onclick = function() { self._createFolder(null); };
    document.getElementById('btn-link-item').onclick = function() { self._showLinkModal(null); };
  },

  // ===== 数据加载 =====

  _loadDashboard: function() {
    var self = this;
    this._state.loading = true;
    API.getDashboard().then(function(data) {
      self._state.dashboard = data;
      self._state.loading = false;
      self._renderTree();
      self._renderContent();
    }).catch(function(e) {
      self._state.loading = false;
      UI.toast('加载看板失败: ' + e.message, 'error');
    });
  },

  // ===== 文件夹树渲染 =====

  _renderTree: function() {
    var el = document.getElementById('board-tree');
    if (!el) return;
    var dash = this._state.dashboard;
    if (!dash) { el.innerHTML = '<div style="padding:20px;color:var(--text-light)">加载中...</div>'; return; }

    var self = this;
    var html = '';

    // 我的文件夹
    if (dash.folders && dash.folders.length > 0) {
      html += '<div class="board-tree-section"><div class="board-tree-title">📁 我的文件夹</div>';
      html += '<div class="board-tree-list">';
      dash.folders.forEach(function(f) { html += self._renderFolderNode(f, 0); });
      html += '</div></div>';
    } else {
      html += '<div class="board-tree-section"><div class="board-tree-title">📁 我的文件夹</div>';
      html += '<div style="padding:16px 12px;color:var(--text-light);font-size:13px">暂无文件夹，点击上方按钮创建</div></div>';
    }

    // 共享文件夹
    if (dash.shared_folders && dash.shared_folders.length > 0) {
      html += '<div class="board-tree-section" style="margin-top:12px;border-top:1px solid var(--border)"><div class="board-tree-title">📂 共享给我</div>';
      html += '<div class="board-tree-list">';
      dash.shared_folders.forEach(function(f) { html += self._renderSharedFolderNode(f, 0, f.shared_from || null); });
      html += '</div></div>';
    }

    el.innerHTML = html;

    // 绑定事件
    el.querySelectorAll('.folder-node').forEach(function(node) {
      var fid = node.dataset.id;
      // 展开/折叠
      var chevron = node.querySelector('.folder-chevron');
      if (chevron) {
        chevron.onclick = function(e) {
          e.stopPropagation();
          self._state.expanded[fid] = !self._state.expanded[fid];
          self._renderTree();
        };
      }
      // 选中文件夹
      node.querySelector('.folder-label').onclick = function() {
        self._state.selectedFolder = fid;
        self._state.tab = 'all';
        self._renderTree();
        self._renderContent();
      };
      // ⋯ 菜单
      var moreBtn = node.querySelector('.folder-more');
      if (moreBtn) {
        moreBtn.onclick = function(e) {
          e.stopPropagation();
          self._showFolderMenu(fid, moreBtn, node.dataset.isShared === 'true');
        };
      }
    });
  },

  _renderFolderNode: function(folder, depth) {
    var self = this;
    var isExpanded = this._state.expanded[folder.id] !== false; // 默认展开
    var isSelected = this._state.selectedFolder === folder.id;
    var hasChildren = folder.children && folder.children.length > 0;
    var itemCount = (folder.items || []).length;

    var indent = depth * 20;
    var html = '<div class="folder-node ' + (isSelected ? 'selected' : '') + '" data-id="' + folder.id + '" style="padding-left:' + (12 + indent) + 'px">';
    html += '<span class="folder-chevron ' + (hasChildren ? '' : 'no-children') + '">' + (hasChildren ? (isExpanded ? '▼' : '▶') : '•') + '</span>';
    html += '<span class="folder-label"><span class="folder-icon">📁</span><span class="folder-name">' + _esc(folder.name) + '</span>';
    if (itemCount > 0) html += '<span class="folder-badge">' + itemCount + '</span>';
    html += '</span>';
    html += '<span class="folder-more" title="更多操作">⋯</span>';
    html += '</div>';

    // 子节点
    if (hasChildren && isExpanded) {
      folder.children.forEach(function(child) {
        html += self._renderFolderNode(child, depth + 1);
      });
    }

    return html;
  },

  _renderSharedFolderNode: function(folder, depth, sharedFrom) {
    var self = this;
    // 如果子文件夹没有 shared_from，继承父级的
    if (!sharedFrom && folder.shared_from) {
      sharedFrom = folder.shared_from;
    }
    var isExpanded = this._state.expanded[folder.id] !== false;
    var isSelected = this._state.selectedFolder === folder.id;
    var hasChildren = folder.children && folder.children.length > 0;
    var itemCount = (folder.items || []).length;
    var canEdit = sharedFrom && sharedFrom.permission === 'edit';

    var indent = depth * 20;
    var html = '<div class="folder-node shared ' + (isSelected ? 'selected' : '') + '" data-id="' + folder.id + '" data-is-shared="true" style="padding-left:' + (12 + indent) + 'px">';
    html += '<span class="folder-chevron ' + (hasChildren ? '' : 'no-children') + '">' + (hasChildren ? (isExpanded ? '▼' : '▶') : '•') + '</span>';
    html += '<span class="folder-label"><span class="folder-icon">📁</span><span class="folder-name">' + _esc(folder.name) + '</span>';
    if (itemCount > 0) html += '<span class="folder-badge">' + itemCount + '</span>';
    html += '</span>';
    if (depth === 0) {
      html += '<span class="folder-share-badge" title="来自 ' + _esc(sharedFrom.real_name || '') + '">' + _esc(sharedFrom.real_name || '未知') + '</span>';
    }
    if (canEdit) {
      html += '<span class="folder-more" title="更多操作">⋯</span>';
    }
    html += '</div>';

    if (hasChildren && isExpanded) {
      folder.children.forEach(function(child) {
        html += self._renderSharedFolderNode(child, depth + 1, sharedFrom);
      });
    }

    return html;
  },

  // ===== 右侧内容区渲染 =====

  _renderContent: function() {
    var el = document.getElementById('board-content');
    if (!el) return;

    var selectedId = this._state.selectedFolder;
    if (!selectedId) {
      el.innerHTML = '<div class="board-empty"><div style="font-size:48px;margin-bottom:16px">🗂️</div><div style="color:var(--text-light)">选择左侧文件夹查看内容</div></div>';
      return;
    }

    // 在所有文件夹中查找选中的文件夹
    var folder = this._findFolder(selectedId);
    if (!folder) {
      el.innerHTML = '<div class="board-empty"><div style="font-size:48px;margin-bottom:16px">📁</div><div style="color:var(--text-light)">文件夹不存在</div></div>';
      return;
    }

    var items = folder.items || [];
    var tab = this._state.tab;
    var filtered = tab === 'all' ? items : items.filter(function(i) { return i.entity_type === tab; });

    var canE = Auth.hasRole(['admin','engineer','production','guest']);
    var isShared = folder.shared_from;

    // Tab 切换
    var tabHtml = '<div class="board-tabs">';
    var tabs = [
      { key: 'all', label: '全部', count: items.length },
      { key: 'part', label: '零件', count: items.filter(function(i) { return i.entity_type === 'part'; }).length },
      { key: 'assembly', label: '部件', count: items.filter(function(i) { return i.entity_type === 'assembly'; }).length },
      { key: 'document', label: '图文档', count: items.filter(function(i) { return i.entity_type === 'document'; }).length },
    ];
    tabs.forEach(function(t) {
      tabHtml += '<span class="board-tab ' + (tab === t.key ? 'active' : '') + '" data-tab="' + t.key + '">' + t.label + ' (' + t.count + ')</span>';
    });
    tabHtml += '</div>';

    // 表格
    var tableHtml = '';
    if (filtered.length === 0) {
      tableHtml = '<div style="text-align:center;padding:40px;color:var(--text-light)">暂无关联项目</div>';
    } else {
      tableHtml = '<table class="board-table"><thead><tr><th>类型</th><th>编号</th><th>名称</th><th>版本</th><th>状态</th>' +
        (canE ? '<th>操作</th>' : '') + '</tr></thead><tbody>';
      filtered.forEach(function(item) {
        var typeLabel = { part: '零件', assembly: '部件', document: '图文档' }[item.entity_type] || item.entity_type;
        var typeIcon = { part: '🔧', assembly: '📦', document: '📄' }[item.entity_type] || '';
        var onclick = '';
        if (item.entity_type === 'part') onclick = "Parts._viewPart('" + item.entity_id + "')";
        else if (item.entity_type === 'assembly') onclick = "Components._viewComp('" + item.entity_id + "')";
        else if (item.entity_type === 'document') onclick = "Documents._viewDoc('" + item.entity_id + "', Store.getAll('documents'))";
        tableHtml += '<tr style="cursor:pointer" onclick="' + onclick + '">';
        tableHtml += '<td>' + typeIcon + ' ' + typeLabel + '</td>';
        tableHtml += '<td>' + _esc(item.code) + '</td>';
        tableHtml += '<td>' + _esc(item.name) + '</td>';
        tableHtml += '<td><span class="tag" style="background:#e6f7ff;color:#1890ff;font-weight:600">' + _esc(item.version || '') + '</span></td>';
        tableHtml += '<td>' + UI.statusTag(item.status) + '</td>';
        if (canE) {
          tableHtml += '<td><button class="btn-text danger" onclick="event.stopPropagation();Board._removeItem(\'' + item.id + '\')">移除</button></td>';
        }
        tableHtml += '</tr>';
      });
      tableHtml += '</tbody></table>';
    }

    el.innerHTML = '<div class="board-content-header"><h3>' + _esc(folder.name) + '</h3>';
    if (canE) {
      el.innerHTML += '<div class="board-content-actions"><button class="btn-outline btn-sm" onclick="Board._createFolder(\'' + folder.id + '\')">＋ 子文件夹</button>' +
        '<button class="btn-outline btn-sm" onclick="Board._showLinkModal(\'' + folder.id + '\')">＋ 关联项目</button></div>';
    }
    el.innerHTML += '</div>' + tabHtml + '<div class="board-table-wrapper">' + tableHtml + '</div>';

    // 绑定 tab 事件
    var self = this;
    el.querySelectorAll('.board-tab').forEach(function(t) {
      t.onclick = function() {
        self._state.tab = t.dataset.tab;
        self._renderContent();
      };
    });
  },

  _findFolder: function(id, folders) {
    folders = folders || (this._state.dashboard ? this._state.dashboard.folders || [] : []);
    // 也在共享文件夹中查找
    var sharedFolders = this._state.dashboard ? this._state.dashboard.shared_folders || [] : [];
    return this._findFolderInList(id, folders) || this._findFolderInList(id, sharedFolders);
  },

  _findFolderInList: function(id, folders) {
    if (!folders) return null;
    for (var i = 0; i < folders.length; i++) {
      if (folders[i].id === id) return folders[i];
      if (folders[i].children) {
        var found = this._findFolderInList(id, folders[i].children);
        if (found) return found;
      }
    }
    return null;
  },

  // ===== 文件夹操作菜单 =====

  _showFolderMenu: function(folderId, anchorEl, isShared) {
    var folder = this._findFolder(folderId);
    if (!folder) return;
    var self = this;

    // 移除已有菜单
    var old = document.getElementById('folder-menu');
    if (old) old.remove();

    var menu = document.createElement('div');
    menu.id = 'folder-menu';
    menu.className = 'folder-menu';

    var items = [];
    items.push({ label: '重命名', action: function() { self._renameFolder(folderId); } });
    items.push({ label: '新建子文件夹', action: function() { self._createFolder(folderId); } });
    items.push({ label: '关联项目', action: function() { self._showLinkModal(folderId); } });
    if (!isShared) {
      items.push({ label: '共享', action: function() { self._showShareModal(folderId); } });
    }
    items.push({ label: '<span style="color:#ff4d4f">删除</span>', action: function() { self._deleteFolder(folderId); } });

    items.forEach(function(item) {
      var div = document.createElement('div');
      div.className = 'folder-menu-item';
      div.innerHTML = item.label;
      div.onclick = function() { menu.remove(); item.action(); };
      menu.appendChild(div);
    });

    document.body.appendChild(menu);

    // 定位
    var rect = anchorEl.getBoundingClientRect();
    menu.style.top = rect.bottom + 4 + 'px';
    menu.style.left = rect.left + 'px';

    // 点击外部关闭
    setTimeout(function() {
      document.addEventListener('click', function handler(e) {
        if (!menu.contains(e.target)) {
          menu.remove();
          document.removeEventListener('click', handler);
        }
      });
    }, 10);
  },

  // ===== 文件夹 CRUD =====

  _createFolder: function(parentId) {
    var self = this;
    UI.modal(parentId ? '新建子文件夹' : '新建文件夹',
      '<div class="form-group"><label>文件夹名称</label><input type="text" id="folder-name-input" class="form-input" placeholder="请输入名称" maxlength="128" style="width:100%"></div>',
      { footer: '<button class="btn-outline" onclick="UI.closeModal()">取消</button><button class="btn-primary" id="btn-confirm-create-folder">确定</button>',
        afterRender: function() {
          document.getElementById('folder-name-input').focus();
          document.getElementById('btn-confirm-create-folder').onclick = function() {
            var name = document.getElementById('folder-name-input').value.trim();
            if (!name) { UI.toast('请输入名称', 'warning'); return; }
            API.createDashboardFolder({ name: name, parent_id: parentId || null }).then(function() {
              UI.closeModal();
              UI.toast('文件夹已创建', 'success');
              self._loadDashboard();
            }).catch(function(e) { UI.toast(e.message, 'error'); });
          };
          document.getElementById('folder-name-input').onkeydown = function(e) {
            if (e.key === 'Enter') document.getElementById('btn-confirm-create-folder').click();
          };
        }
      }
    );
  },

  _renameFolder: function(folderId) {
    var folder = this._findFolder(folderId);
    if (!folder) return;
    var self = this;

    UI.modal('重命名文件夹',
      '<div class="form-group"><label>文件夹名称</label><input type="text" id="folder-rename-input" class="form-input" value="' + _esc(folder.name) + '" maxlength="128" style="width:100%"></div>',
      { footer: '<button class="btn-outline" onclick="UI.closeModal()">取消</button><button class="btn-primary" id="btn-confirm-rename">确定</button>',
        afterRender: function() {
          var input = document.getElementById('folder-rename-input');
          input.focus();
          input.select();
          document.getElementById('btn-confirm-rename').onclick = function() {
            var name = input.value.trim();
            if (!name) { UI.toast('请输入名称', 'warning'); return; }
            API.updateDashboardFolder(folderId, { name: name }).then(function() {
              UI.closeModal();
              UI.toast('已重命名', 'success');
              self._loadDashboard();
            }).catch(function(e) { UI.toast(e.message, 'error'); });
          };
          input.onkeydown = function(e) {
            if (e.key === 'Enter') document.getElementById('btn-confirm-rename').click();
          };
        }
      }
    );
  },

  _deleteFolder: function(folderId) {
    var folder = this._findFolder(folderId);
    if (!folder) return;
    var self = this;
    var itemCount = (folder.items || []).length;

    UI.confirm('确定删除文件夹"' + folder.name + '"吗？' + (itemCount > 0 ? '该文件夹内有 ' + itemCount + ' 个关联项将一并删除。' : ''), function() {
      API.deleteDashboardFolder(folderId).then(function() {
        UI.toast('文件夹已删除', 'success');
        if (self._state.selectedFolder === folderId) {
          self._state.selectedFolder = null;
        }
        self._loadDashboard();
      }).catch(function(e) { UI.toast(e.message, 'error'); });
    });
  },

  // ===== 关联项目弹窗 =====

  _showLinkModal: function(folderId) {
    var self = this;
    var typeFilter = 'all';

    function renderModal() {
      var filterHtml = '<div class="board-link-filter"><span class="board-link-tab ' + (typeFilter === 'all' ? 'active' : '') + '" data-type="all">全部</span>';
      filterHtml += '<span class="board-link-tab ' + (typeFilter === 'part' ? 'active' : '') + '" data-type="part">零件</span>';
      filterHtml += '<span class="board-link-tab ' + (typeFilter === 'assembly' ? 'active' : '') + '" data-type="assembly">部件</span>';
      filterHtml += '<span class="board-link-tab ' + (typeFilter === 'document' ? 'active' : '') + '" data-type="document">图文档</span></div>';
      filterHtml += '<div class="form-group" style="margin-bottom:12px"><input type="text" id="link-search-input" class="form-input" placeholder="搜索编号或名称..." style="width:100%"></div>';
      filterHtml += '<div id="link-search-results" style="max-height:400px;overflow-y:auto"></div>';
      filterHtml += '<div style="margin-top:12px;text-align:right"><span id="link-selected-count" style="margin-right:12px;color:var(--text-secondary);font-size:13px">已选 0 项</span>';

      UI.modal('关联项目',
        filterHtml,
        { large: true, footer: '<button class="btn-outline" onclick="UI.closeModal()">取消</button><button class="btn-primary" id="btn-confirm-link">确认关联</button>',
          afterRender: function() {
            // 获取当前文件夹已有的关联项
            var folder = folderId ? self._findFolder(folderId) : null;
            var existingIds = new Set();
            if (folder && folder.items) {
              folder.items.forEach(function(item) {
                existingIds.add(item.entity_type + ':' + item.entity_id);
              });
            }

            // 已选集合
            var selected = new Set();

            function searchAndRender() {
              var kw = (document.getElementById('link-search-input').value || '').trim().toLowerCase();
              var results = [];

              if (typeFilter === 'all' || typeFilter === 'part') {
                Store.getAll('parts').forEach(function(p) {
                  var key = 'part:' + p.id;
                  if (existingIds.has(key)) return;
                  if (kw && p.code.toLowerCase().indexOf(kw) < 0 && p.name.toLowerCase().indexOf(kw) < 0) return;
                  results.push({ entity_type: 'part', entity_id: p.id, code: p.code, name: p.name, version: p.version, status: p.status, icon: '🔧', typeLabel: '零件' });
                });
              }
              if (typeFilter === 'all' || typeFilter === 'assembly') {
                Store.getAll('components').forEach(function(c) {
                  var key = 'assembly:' + c.id;
                  if (existingIds.has(key)) return;
                  if (kw && c.code.toLowerCase().indexOf(kw) < 0 && c.name.toLowerCase().indexOf(kw) < 0) return;
                  results.push({ entity_type: 'assembly', entity_id: c.id, code: c.code, name: c.name, version: c.version, status: c.status, icon: '📦', typeLabel: '部件' });
                });
              }
              if (typeFilter === 'all' || typeFilter === 'document') {
                Store.getAll('documents').forEach(function(d) {
                  var key = 'document:' + d.id;
                  if (existingIds.has(key)) return;
                  if (kw && d.code.toLowerCase().indexOf(kw) < 0 && d.name.toLowerCase().indexOf(kw) < 0) return;
                  results.push({ entity_type: 'document', entity_id: d.id, code: d.code, name: d.name, version: d.version, status: d.status, icon: '📄', typeLabel: '图文档' });
                });
              }

              // 排序：名称字母序
              results.sort(function(a, b) { return a.name.localeCompare(b.name); });

              var container = document.getElementById('link-search-results');
              if (results.length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-light)">' + (kw ? '未找到匹配项' : '暂无可关联项目') + '</div>';
              } else {
                var html = '<table class="board-link-table"><thead><tr><th style="width:30px"><input type="checkbox" id="link-select-all"></th><th>类型</th><th>编号</th><th>名称</th><th>版本</th><th>状态</th></tr></thead><tbody>';
                results.forEach(function(r) {
                  var key = r.entity_type + ':' + r.entity_id;
                  var checked = selected.has(key) ? 'checked' : '';
                  html += '<tr data-key="' + key + '" data-type="' + r.entity_type + '" data-eid="' + r.entity_id + '">';
                  html += '<td><input type="checkbox" class="link-cb" data-key="' + key + '" ' + checked + '></td>';
                  html += '<td>' + r.icon + ' ' + r.typeLabel + '</td>';
                  html += '<td>' + _esc(r.code) + '</td>';
                  html += '<td>' + _esc(r.name) + '</td>';
                  html += '<td>' + _esc(r.version || '') + '</td>';
                  html += '<td>' + UI.statusTag(r.status) + '</td>';
                  html += '</tr>';
                });
                html += '</tbody></table>';
                container.innerHTML = html;

                // 全选
                document.getElementById('link-select-all').onchange = function() {
                  var checked = this.checked;
                  container.querySelectorAll('.link-cb').forEach(function(cb) {
                    cb.checked = checked;
                    if (checked) selected.add(cb.dataset.key);
                    else selected.delete(cb.dataset.key);
                  });
                  document.getElementById('link-selected-count').textContent = '已选 ' + selected.size + ' 项';
                };

                // 单选
                container.querySelectorAll('.link-cb').forEach(function(cb) {
                  cb.onchange = function() {
                    if (this.checked) selected.add(this.dataset.key);
                    else selected.delete(this.dataset.key);
                    document.getElementById('link-selected-count').textContent = '已选 ' + selected.size + ' 项';
                  };
                });

                // 行点击切换
                container.querySelectorAll('tbody tr').forEach(function(tr) {
                  tr.onclick = function(e) {
                    if (e.target.tagName === 'INPUT') return;
                    var cb = tr.querySelector('.link-cb');
                    cb.checked = !cb.checked;
                    cb.onchange();
                  };
                });
              }

              document.getElementById('link-selected-count').textContent = '已选 ' + selected.size + ' 项';
            }

            // 类型筛选 tab
            document.querySelectorAll('.board-link-tab').forEach(function(t) {
              t.onclick = function() {
                typeFilter = t.dataset.type;
                selected.clear();
                renderModal();
              };
            });

            // 搜索
            var searchTimer;
            document.getElementById('link-search-input').oninput = function() {
              clearTimeout(searchTimer);
              searchTimer = setTimeout(searchAndRender, 200);
            };

            // 确认按钮
            document.getElementById('btn-confirm-link').onclick = function() {
              if (selected.size === 0) { UI.toast('请选择要关联的项目', 'warning'); return; }

              if (!folderId) {
                // 需要先选文件夹
                UI.toast('请先选择一个文件夹', 'warning');
                return;
              }

              var items = [];
              selected.forEach(function(key) {
                var parts = key.split(':');
                items.push({ entity_type: parts[0], entity_id: parts[1] });
              });

              API.addDashboardItems({ folder_id: folderId, items: items }).then(function(res) {
                UI.closeModal();
                UI.toast(res.message || '关联成功', 'success');
                self._loadDashboard();
              }).catch(function(e) { UI.toast(e.message, 'error'); });
            };

            // 初始渲染列表
            searchAndRender();
          }
        }
      );
    }

    // 如果没有选文件夹，先提示
    if (!folderId) {
      var selectedFolder = self._state.selectedFolder;
      if (!selectedFolder) {
        UI.toast('请先选择一个文件夹', 'warning');
        return;
      }
      folderId = selectedFolder;
    }

    renderModal();
  },

  // ===== 移除关联项 =====

  _removeItem: function(itemId) {
    var self = this;
    UI.confirm('确定移除该关联项吗？', function() {
      API.deleteDashboardItem(itemId).then(function() {
        UI.toast('已移除', 'success');
        self._loadDashboard();
      }).catch(function(e) { UI.toast(e.message, 'error'); });
    });
  },

  // ===== 共享弹窗 =====

  _showShareModal: function(folderId) {
    var self = this;
    var folder = this._findFolder(folderId);
    if (!folder) return;

    function renderShareModal() {
      UI.modal('共享「' + folder.name + '」',
        '<div class="share-form"><div class="form-group"><label>选择用户</label><input type="text" id="share-user-search" class="form-input" placeholder="搜索用户名或姓名..." style="width:100%"></div>' +
        '<div id="share-user-results" style="margin-bottom:12px"></div>' +
        '<div class="form-group"><label>权限</label><select id="share-permission" class="form-select" style="width:100%"><option value="view">只读查看</option><option value="edit">可编辑</option></select></div>' +
        '<div style="margin-bottom:12px"><button class="btn-primary btn-sm" id="btn-add-share">添加共享</button></div>' +
        '<div id="share-list-area"></div></div>',
        { large: true, footer: '<button class="btn-outline" onclick="UI.closeModal()">关闭</button>',
          afterRender: function() {
            var selectedUserId = null;

            function loadShares() {
              API.getFolderShares(folderId).then(function(shares) {
                var area = document.getElementById('share-list-area');
                if (!shares || shares.length === 0) {
                  area.innerHTML = '<div style="padding:12px;color:var(--text-light);font-size:13px">暂未共享给任何人</div>';
                  return;
                }
                var html = '<div style="border-top:1px solid var(--border);padding-top:12px"><h4 style="margin-bottom:8px;font-size:14px">已共享用户</h4>';
                shares.forEach(function(s) {
                  var permLabel = s.permission === 'edit' ? '可编辑' : '只读查看';
                  var user = s.shared_with_user || {};
                  html += '<div class="share-item"><span>' + _esc(user.real_name || user.username || '未知') + '</span><span class="share-perm">' + permLabel + '</span><button class="btn-text danger" onclick="Board._removeShare(\'' + folderId + '\', \'' + s.id + '\')">取消共享</button></div>';
                });
                html += '</div>';
                area.innerHTML = html;
              }).catch(function() {});
            }

            // 搜索用户
            var searchTimer;
            document.getElementById('share-user-search').oninput = function() {
              clearTimeout(searchTimer);
              var kw = this.value.trim().toLowerCase();
              searchTimer = setTimeout(function() {
                var area = document.getElementById('share-user-results');
                if (!kw) { area.innerHTML = ''; selectedUserId = null; return; }
                var users = Store.getAll('users');
                var results = users.filter(function(u) {
                  return u.username.toLowerCase().indexOf(kw) >= 0 || (u.realName || '').toLowerCase().indexOf(kw) >= 0;
                }).slice(0, 10);
                if (results.length === 0) {
                  area.innerHTML = '<div style="padding:8px;color:var(--text-light);font-size:13px">未找到用户</div>';
                  selectedUserId = null;
                } else {
                  var html = '<div class="share-user-list">';
                  results.forEach(function(u) {
                    var currentUser = Auth.getUser();
                    var disabled = u.id === currentUser.id ? ' disabled title="不能共享给自己"' : '';
                    html += '<div class="share-user-item' + (disabled ? ' disabled' : '') + '" data-uid="' + u.id + '">' + _esc(u.realName || u.username) + ' (' + _esc(u.username) + ')</div>';
                  });
                  html += '</div>';
                  area.innerHTML = html;
                  area.querySelectorAll('.share-user-item:not(.disabled)').forEach(function(el) {
                    el.onclick = function() {
                      area.querySelectorAll('.share-user-item').forEach(function(e) { e.classList.remove('selected'); });
                      el.classList.add('selected');
                      selectedUserId = el.dataset.uid;
                    };
                  });
                }
              }, 200);
            };

            // 添加共享
            document.getElementById('btn-add-share').onclick = function() {
              if (!selectedUserId) { UI.toast('请选择要共享的用户', 'warning'); return; }
              var permission = document.getElementById('share-permission').value;
              API.addFolderShare(folderId, { shared_with_user_id: selectedUserId, permission: permission }).then(function(res) {
                UI.toast(res.message || '共享成功', 'success');
                selectedUserId = null;
                document.getElementById('share-user-search').value = '';
                document.getElementById('share-user-results').innerHTML = '';
                loadShares();
                self._loadDashboard();
              }).catch(function(e) { UI.toast(e.message, 'error'); });
            };

            loadShares();
          }
        }
      );
    }

    renderShareModal();
  },

  _removeShare: function(folderId, shareId) {
    var self = this;
    UI.confirm('确定取消共享吗？', function() {
      API.deleteFolderShare(folderId, shareId).then(function() {
        UI.toast('已取消共享', 'success');
        self._loadDashboard();
        // 刷新共享弹窗
        self._showShareModal(folderId);
      }).catch(function(e) { UI.toast(e.message, 'error'); });
    });
  },
};

// 辅助：HTML 转义
function _esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

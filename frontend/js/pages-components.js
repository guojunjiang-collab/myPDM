var Components = {

  // 主部件管理页面
  render: function(c) {

    var _kw = '';

    var _f = { status: '', sort: { field:'code', dir:'asc' } };

    // 创建页面结构（只创建一次）
    var canE = Auth.canEdit();
    c.innerHTML =
      '<div class="page-header"><h2>📦 部件管理</h2><div class="actions">' +
        (canE ? '<button class="btn-primary" id="btn-add-cp">＋ 新增部件</button>' : '') +
      '</div></div>' +
      '<div class="card"><div class="toolbar"><div class="search-box"><input type="text" id="cs" placeholder="搜索件号/名称..." style="width:100%"></div>' +
        '<select id="cst"><option value="">全部状态</option><option value="draft">草稿</option><option value="frozen">冻结</option><option value="released">发布</option><option value="obsolete">作废</option></select>' +
        '<button class="btn-outline" id="btn-toggle-comp-filter" style="margin-left:4px;font-size:12px;padding:6px 12px">🔽 筛选</button>' +
        '<div class="spacer"></div><span style="font-size:13px;color:var(--text-secondary)" id="components-count">共 0 条</span></div>' +
      '<div id="comp-filter-panel" style="display:none;padding:12px 16px;border-bottom:1px solid #f0f0f0;background:#fafafa"></div><div class="table-wrapper" id="components-table-area"></div></div>';

    // 渲染表格（不重新创建搜索框）
    function renderList() {
      var data = Store.getAll('components');

      if (_kw) { var k = _kw.toLowerCase(); data = data.filter(function(c2) { return c2.code.toLowerCase().indexOf(k) >= 0 || c2.name.toLowerCase().indexOf(k) >= 0; }); }

      if (_f.status) { data = data.filter(function(c2) { return c2.status === _f.status; }); }

      // 自定义字段筛选
      var compCfDefs = Store.getAll('custom_field_defs');
      compCfDefs.forEach(function(cf) {
        if (cf.applies_to !== 'component' && cf.applies_to !== 'both') return;
        var el = document.getElementById('comp-cf-filter-' + cf.field_key);
        if (!el || !el.value) return;
        var fv = el.value.toLowerCase();
        data = data.filter(function(c2) {
          var dv = c2.customFields ? c2.customFields[cf.field_key] : null;
          if (dv === undefined || dv === null || dv === '') return false;
          if (cf.field_type === 'multiselect' && Array.isArray(dv)) {
            return dv.some(function(v) { return v.toLowerCase().indexOf(fv) >= 0; });
          }
          return String(dv).toLowerCase().indexOf(fv) >= 0;
        });
      });
      // 版本筛选
      var verF2 = document.getElementById('comp-filter-version');
      if (verF2 && verF2.value) {
        var verKw2 = verF2.value.toLowerCase();
        data = data.filter(function(c2) { return (c2.version||'').toLowerCase().indexOf(verKw2) >= 0; });
      }

      if (_f.sort.field) {
        data.sort(function(a, b) {
          var av = a[_f.sort.field]||'', bv = b[_f.sort.field]||'';
          if (av < bv) return _f.sort.dir === 'asc' ? -1 : 1;
          if (av > bv) return _f.sort.dir === 'asc' ? 1 : -1;
          return 0;
        });
      }

      // 更新计数
      var countEl = document.getElementById('components-count');
      if (countEl) countEl.textContent = '共 ' + data.length + ' 条';

      // 渲染表格
      var container = document.getElementById('components-table-area');
      if (!container) return;
      container.innerHTML = '<table id="components-table"><thead><tr><th data-sort="code" class="th-sortable">部件件号<span class="th-sort-icon"></span></th><th data-sort="name" class="th-sortable">中文名称<span class="th-sort-icon"></span></th><th data-sort="spec" class="th-sortable">规格型号<span class="th-sort-icon"></span></th><th data-sort="version" class="th-sortable">版本<span class="th-sort-icon"></span></th><th data-sort="parts" class="th-sortable">零件数<span class="th-sort-icon"></span></th><th data-sort="status" class="th-sortable">状态<span class="th-sort-icon"></span></th><th data-sort="updatedAt" class="th-sortable">更新时间<span class="th-sort-icon"></span></th><th>操作</th></tr></thead><tbody>' +
        (data.length === 0 ? '<tr><td colspan="8" style="text-align:center;color:var(--text-light);padding:40px">暂无数据</td></tr>' :
          data.map(function(c2) { return '<tr onclick="Components._viewComp(\'' + c2.id + '\');" style="cursor:pointer"><td>' + c2.code + '</td><td>' + c2.name + '</td><td>' + (c2.spec||'-') + '</td><td><span class="tag" style="background:#e6f7ff;color:#1890ff;font-weight:600">' + c2.version + '</span></td><td>' + (c2.parts||[]).length + ' 种</td><td>' + UI.statusTag(c2.status) + '</td><td style="font-size:12px;color:var(--text-secondary)">' + UI.formatDate(c2.updatedAt) + '</td><td>' + (canE ? '<button class="btn-text" onclick="event.stopPropagation();Components._exportBom(\'' + c2.id + '\')">导出</button><button class="btn-text" onclick="event.stopPropagation();Components._editComp(\'' + c2.id + '\')">编辑</button><button class="btn-text danger" onclick="event.stopPropagation();Components._deleteComp(\'' + c2.id + '\')">删除</button>' : '') + '</td></tr>'; }).join('')) +
        '</tbody></table>';

      // 排序角标 & 点击事件
      document.querySelectorAll('#components-table th[data-sort]').forEach(function(th) {
        var f = th.getAttribute('data-sort');
        var ic = th.querySelector('.th-sort-icon');
        th.classList.remove('sorted');
        ic.className = 'th-sort-icon';
        if (_f.sort.field === f) {
          th.classList.add('sorted');
          ic.classList.add(_f.sort.dir);
        }
        th.onclick = function() {
          if (_f.sort.field === f) {
            _f.sort.dir = _f.sort.dir === 'asc' ? 'desc' : 'asc';
          } else {
            _f.sort.field = f; _f.sort.dir = 'asc';
          }
          renderList();
        };
      });
    }

    // 初始渲染
    renderList();

    // 事件监听
    var _csTimer;
    document.getElementById('cs').oninput = function(e) {
      clearTimeout(_csTimer);
      _csTimer = setTimeout(function() {
        _kw = document.getElementById('cs').value.trim();
        renderList();
      }, 250);
    };

    document.getElementById('cst').onchange = function(e) {
      _f.status = e.target.value;
      renderList();
    };

    var ab = document.getElementById('btn-add-cp');
    if (ab) ab.onclick = function() { Components._editComp(null); };

    // 筛选面板
    var filterOpen = false;
    document.getElementById('btn-toggle-comp-filter').onclick = function() {
      filterOpen = !filterOpen;
      var panel = document.getElementById('comp-filter-panel');
      var btn = document.getElementById('btn-toggle-comp-filter');
      if (filterOpen) {
        btn.textContent = '🔼 收起筛选';
        _buildCompFilterPanel();
        panel.style.display = 'block';
      } else {
        btn.textContent = '🔽 筛选';
        panel.style.display = 'none';
      }
    };

    function _buildCompFilterPanel() {
      var panel = document.getElementById('comp-filter-panel');
      var cfDefs = Store.getAll('custom_field_defs');
      var html = '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">';
      html += '<div style="min-width:180px"><label style="font-size:13px;color:#888;margin-bottom:4px;display:block">版本</label><input type="text" id="comp-filter-version" class="form-input" placeholder="全部"></div>';
      cfDefs.forEach(function(cf) {
        if (cf.applies_to !== 'component' && cf.applies_to !== 'both') return;
        html += '<div style="min-width:180px"><label style="font-size:13px;color:#888;margin-bottom:4px;display:block">' + _esc(cf.name) + '</label><input type="text" id="comp-cf-filter-' + cf.field_key + '" class="form-input" placeholder="全部"></div>';
      });
      html += '<div style="display:flex;gap:8px;align-self:flex-end"><button class="btn-primary" id="btn-apply-comp-filter">筛选</button><button class="btn-outline" id="btn-clear-comp-filter">清除</button></div></div>';
      panel.innerHTML = html;
      document.getElementById('btn-apply-comp-filter').onclick = function() { renderList(); };
      document.getElementById('btn-clear-comp-filter').onclick = function() {
        panel.querySelectorAll('input[type="text"]').forEach(function(el) { el.value = ''; });
        document.getElementById('cst').value = '';
        document.getElementById('cs').value = '';
        _kw = '';
        _f.status = '';
        renderList();
      };
    }
  },

  /* ===== 部件BOM导出 ===== */

  _exportBom: function(compId) {

    var comp = Store.getById('components', compId);

    if (!comp) { UI.toast('部件不存在', 'error'); return; }

    var allParts = Store.getAll('parts');

    var allComps = Store.getAll('components');

    var statusMap = { draft:'草稿', frozen:'冻结', released:'发布', obsolete:'作废' };

    var typeMap = { component:'部件', part:'零件' };

    var rows = [];

    var collect = function(items, depth) {

      if (!items) return;

      items.forEach(function(item) {

        var childType = item.childType || 'part';

        var refId = childType === 'component' ? (item.componentId || '') : (item.partId || '');

        var info = null;

        if (childType === 'part') {

          info = allParts.find(function(p) { return p.id === refId; });

        } else {

          info = allComps.find(function(c) { return c.id === refId; });

        }

        if (!info) return;

        rows.push({

          level: depth,

          type: typeMap[childType] || childType,

          code: info.code || '',

          name: info.name || '',

          version: info.version || 'A',

          status: statusMap[info.status] || info.status || '',

          quantity: item.quantity || 1,

          spec: info.spec || '',

          material: info.material || ''

        });

        if (childType === 'component' && info.parts && info.parts.length > 0) {

          collect(info.parts, depth + 1);

        }

      });

    };

    rows.push({

      level: 0,

      type: '部件',

      code: comp.code || '',

      name: comp.name || '',

      version: comp.version || 'A',

      status: statusMap[comp.status] || comp.status || '',

      quantity: 1,

      spec: comp.spec || '',

      material: ''

    });

    if (comp.parts && comp.parts.length > 0) {

      collect(comp.parts, 1);

    }

    var headers = ['层级', '类型', '件号', '中文名称', '版本', '状态', '用量', '规格', '材料'];

    var csvLines = [headers.join(',')];

    rows.forEach(function(row) {

      csvLines.push([

        row.level,

        '"' + row.type + '"',

        '"' + (row.code.replace(/"/g, '""')) + '"',

        '"' + (row.name.replace(/"/g, '""')) + '"',

        row.version,

        '"' + row.status + '"',

        row.quantity,

        '"' + (row.spec.replace(/"/g, '""')) + '"',

        '"' + (row.material.replace(/"/g, '""')) + '"'

      ].join(','));

    });

    var csvContent = '\uFEFF' + csvLines.join('\r\n');

    var filename = 'BOM_' + (comp.code || 'UNKNOWN') + '_' + (comp.name || 'UNKNOWN') + '_' + (comp.version || 'A') + '.csv';

    filename = filename.replace(/[\\/:*?"<>|]/g, '_');

    var blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });

    var url = URL.createObjectURL(blob);

    var a = document.createElement('a');

    a.href = url;

    a.download = filename;

    document.body.appendChild(a);

    a.click();

    document.body.removeChild(a);

    URL.revokeObjectURL(url);

    UI.toast('已导出 BOM：' + filename, 'success');

  },



   _viewComp: function(id) {
 
     var comp = Store.getById('components', id);
 
     if (!comp) return;
 
     var ap = Store.getAll('parts');
 
     var ac = Store.getAll('components');
 
     var sortedParts = comp.parts && comp.parts.length > 0
       ? comp.parts.slice().sort(function(a, b) {
 
         var typeA = a.childType || 'part';
 
         var typeB = b.childType || 'part';
 
         var refIdA = typeA === 'component' ? (a.componentId || '') : (a.partId || '');
 
         var refIdB = typeB === 'component' ? (b.componentId || '') : (b.partId || '');
 
         var infoA = typeA === 'part' ? ap.find(function(x) { return x.id === refIdA; }) : ac.find(function(x) { return x.id === refIdA; });
 
         var infoB = typeB === 'part' ? ap.find(function(x) { return x.id === refIdB; }) : ac.find(function(x) { return x.id === refIdB; });
 
         var codeA = (infoA && infoA.code) || '';
 
         var codeB = (infoB && infoB.code) || '';
 
         return codeA.localeCompare(codeB);
 
       })
       : (comp.parts || []);

    var buildTree = function(items, depth, maxDepth) {

      if (!items || items.length === 0 || depth > maxDepth) return '';

      var html = '';

      items.forEach(function(p) {

        var type = p.childType || 'part';

        var refId = type === 'component' ? (p.componentId || '') : (p.partId || '');

        var info = null;

        var subItems = null;

        if (type === 'part') {

          info = ap.find(function(x) { return x.id === refId; });

        } else {

          info = ac.find(function(x) { return x.id === refId; });

          if (info && info.parts) subItems = info.parts;

        }

        if (!info) return;

        var icon = type === 'part' ? '🔧' : '📦';

        var label = type === 'part' ? '零件' : '部件';

        var indent = (depth - 1) * 20;

        var hasChildren = (type === 'component' && subItems && subItems.length > 0);

        var toggle = hasChildren ? '<span class="tree-toggle" onclick="event.stopPropagation();var c=this.closest(\'.tree-item\').nextElementSibling;c.style.display=c.style.display===\'none\'?\'block\':\'none\';this.textContent=this.textContent===\'▶\'?\'▼\':\'▶\'">▶</span> ' : '';

        html += '<div class="tree-item" style="cursor:pointer;display:flex;align-items:center;padding:8px 10px;border-bottom:1px solid #e8e8e8;margin-left:' + indent + 'px" onclick="Components._openChildDetail(\'' + type + '\',\'' + refId + '\',\'' + comp.id + '\')"><span style="width:50px;flex-shrink:0">' + depth + '</span><span style="width:80px;flex-shrink:0">' + toggle + icon + ' ' + label + '</span><span style="flex:1">' + info.code + '</span><span style="flex:1">' + info.name + '</span><span style="flex:1">' + (info.spec || '-') + '</span><span style="width:60px;text-align:center">' + (info.version||'A') + '</span><span style="width:60px;text-align:center">' + UI.statusTag(info.status) + '</span><span style="width:60px;text-align:right">' + p.quantity + '</span></div>';

        if (hasChildren) {

          html += '<div class="tree-children" style="display:none">' + buildTree(subItems, depth + 1, maxDepth) + '</div>';

        }

      });

      return html;

    };

    var tableRows = [];

    var flattenTree = function(items, level) {

      if (!items) return;

      items.forEach(function(p) {

        var type = p.childType || 'part';

        var refId = type === 'component' ? (p.componentId || '') : (p.partId || '');

        var info = null;

        if (type === 'part') {

          info = ap.find(function(x) { return x.id === refId; });

        } else {

          info = ac.find(function(x) { return x.id === refId; });

        }

        if (!info) return;

        var icon = type === 'part' ? '🔧' : '📦';

        var label = type === 'part' ? '零件' : '部件';

        tableRows.push({ level: level, icon: icon, label: label, code: info.code, name: info.name, spec: info.spec||'-', version: info.version||'A', status: info.status, quantity: p.quantity, childType: type, refId: refId });

        if (type === 'component' && info.parts && info.parts.length > 0) {

          flattenTree(info.parts, level + 1);

        }

      });

    };

    flattenTree(sortedParts, 1);

    var tableHtml = tableRows.map(function(r) { return '<tr style="cursor:pointer" onclick="Components._openChildDetail(\'' + r.childType + '\',\'' + r.refId + '\',\'' + comp.id + '\')"><td style="padding-left:' + (r.level * 15) + 'px">' + r.level + '</td><td>' + r.icon + ' ' + r.label + '</td><td>' + r.code + '</td><td>' + r.name + '</td><td>' + r.spec + '</td><td>' + r.version + '</td><td>' + UI.statusTag(r.status) + '</td><td>' + r.quantity + '</td></tr>'; }).join('');

    // 加载自定义字段并渲染详情
    _loadCFDefs().then(function(cfDefs) {
      var cfValues = comp.customFields || {};
      var cfHtml = _renderCFViewHtml(cfValues, cfDefs, 'component');

    UI.modal('部件详情 - ' + comp.name,

      '<div class="form-row"><div class="form-group"><label>部件件号</label><input type="text" value="' + _esc(comp.code) + '" readonly></div><div class="form-group"><label>中文名称</label><input type="text" value="' + _esc(comp.name) + '" readonly></div></div>' +
      '<div class="form-row"><div class="form-group"><label>规格型号</label><input type="text" value="' + _esc(comp.spec||'') + '" readonly></div><div class="form-group"><label>版本</label><input type="text" value="' + (comp.version||'A') + '" readonly></div></div>' +
      '<div class="form-row"><div class="form-group"><label>状态</label>' + UI.statusTag(comp.status) + '</div></div>' +
      cfHtml +

      '<h4 style="margin-bottom:12px">子项列表 (' + (sortedParts||[]).length + '种)</h4>' +

      '<div class="tabs" id="comp-tabs"><div class="tab active" data-t="tree">🌲 树形视图</div><div class="tab" data-t="table">📊 表格视图</div><div class="tab" data-t="attachment">📎 关联图文档</div></div>' +

      '<div id="comp-tree-view"><div class="tree-view" style="max-height:400px;overflow-y:auto;color:#333"><div style="display:grid;grid-template-columns:50px 80px 1fr 1fr 1fr 60px 60px 60px;padding:8px 10px;background:#fafafa;font-weight:600;border-bottom:1px solid #e8e8e8"><span>层级</span><span>类型</span><span>件号</span><span>中文名称</span><span>规格型号</span><span>版本</span><span>状态</span><span>用量</span></div>' + buildTree(sortedParts, 1, 6) + '</div></div>' +

      '<div id="comp-table-view" style="display:none"><div class="table-wrapper" style="max-height:400px;overflow-y:auto;color:#333"><table><thead><tr><th style="width:50px;font-weight:600;padding:8px 10px;border-bottom:1px solid #e8e8e8;text-align:left">层级</th><th style="width:80px;font-weight:600;padding:8px 10px;border-bottom:1px solid #e8e8e8;text-align:left">类型</th><th style="font-weight:600;padding:8px 10px;border-bottom:1px solid #e8e8e8;text-align:left">件号</th><th style="font-weight:600;padding:8px 10px;border-bottom:1px solid #e8e8e8;text-align:left">中文名称</th><th style="font-weight:600;padding:8px 10px;border-bottom:1px solid #e8e8e8;text-align:left">规格型号</th><th style="font-weight:600;padding:8px 10px;border-bottom:1px solid #e8e8e8;text-align:left">版本</th><th style="font-weight:600;padding:8px 10px;border-bottom:1px solid #e8e8e8;text-align:left">状态</th><th style="font-weight:600;padding:8px 10px;border-bottom:1px solid #e8e8e8;text-align:left">用量</th></tr></thead><tbody>' + (tableHtml || '<tr><td colspan="8" style="text-align:center;color:#333">暂无数据</td></tr>') + '</tbody></table></div></div>' +

      '<div id="comp-attachment-view" style="display:none"><div class="attachment-view" style="padding:16px;background:#f9f9f9;border-radius:4px;margin-top:8px" id="comp-view-edocs-area">' + Components._renderAttachmentsView(comp) + '</div></div>',

      { large: true, footer: '<button class="btn-primary" id="btn-comp-detail-close" onclick="UI.closeModal()">关闭</button>',
        afterRender: function() {
          // 加载关联图文档数据
          API._fetch('GET', '/assemblies/' + comp.id + '/documents').then(function(list) {
            comp._entityDocs = list;
            var allComps = Store.getAll('components');
            var cIdx = allComps.findIndex(function(c) { return c.id === comp.id; });
            if (cIdx >= 0) allComps[cIdx]._entityDocs = list;
            // 加载自定义字段定义
            _loadDocCFDefs().then(function(cfDefs) {
              cfDefs = cfDefs || [];
              // 如果有自定义字段定义，批量获取所有关联图文档的自定义字段值
              if (cfDefs.length > 0 && list.length > 0) {
                var cfValuePromises = list.map(function(ed) {
                  var d = ed.document || {};
                  if (!d.id) return Promise.resolve();
                  return API.getCustomFieldValues('document', d.id).then(function(values) {
                    var cfMap = {};
                    (values || []).forEach(function(v) { if (v.field_key) cfMap[v.field_key] = v.value; });
                    d.customFields = cfMap;
                  }).catch(function() {
                    d.customFields = {};
                  });
                });
                Promise.all(cfValuePromises).then(function() {
                  var area = document.getElementById('comp-view-edocs-area');
                  if (area) {
                    area.innerHTML = Components._renderAttachmentsView(comp, cfDefs);
                    
                    // 为下载按钮添加事件监听器
                    area.querySelectorAll('.btn-download-edoc').forEach(function(btn) {
                      btn.onclick = function(e) {
                        e.stopPropagation();
                        var fileId = btn.dataset.fileId;
                        var fileName = btn.dataset.fileName;
                        
                        // 下载附件
                        UI.toast('正在下载...', 'info');
                        downloadFile(fileId).then(function(blob) {
                          // 创建下载链接
                          var url = URL.createObjectURL(blob);
                          var a = document.createElement('a');
                          a.href = url;
                          a.download = fileName;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                          UI.toast('下载完成', 'success');
                        }).catch(function(e) {
                          UI.toast('下载失败: ' + e.message, 'error');
                        });
                      };
                    });
                    
                    // 为图文档行添加点击事件
                    area.querySelectorAll('.edoc-row').forEach(function(row) {
                      row.onclick = function() {
                        var docId = row.getAttribute('data-doc-id');
                        if (docId) {
                          // 存储返回信息
                          window._docDetailReturnTo = { type: 'component', id: comp.id };
                          Documents._viewDoc(docId);
                        }
                      };
                    });
                  }
                });
              } else {
                var area = document.getElementById('comp-view-edocs-area');
                if (area) {
                  area.innerHTML = Components._renderAttachmentsView(comp, cfDefs);
                  
                  // 为下载按钮添加事件监听器
                  area.querySelectorAll('.btn-download-edoc').forEach(function(btn) {
                    btn.onclick = function(e) {
                      e.stopPropagation();
                      var fileId = btn.dataset.fileId;
                      var fileName = btn.dataset.fileName;
                      
                      // 下载附件
                      UI.toast('正在下载...', 'info');
                      downloadFile(fileId).then(function(blob) {
                        // 创建下载链接
                        var url = URL.createObjectURL(blob);
                        var a = document.createElement('a');
                        a.href = url;
                        a.download = fileName;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        UI.toast('下载完成', 'success');
                      }).catch(function(e) {
                        UI.toast('下载失败: ' + e.message, 'error');
                      });
                    };
                  });
                  
                  // 为图文档行添加点击事件
                  area.querySelectorAll('.edoc-row').forEach(function(row) {
                    row.onclick = function() {
                      var docId = row.getAttribute('data-doc-id');
                      if (docId) {
                        // 存储返回信息
                        window._docDetailReturnTo = { type: 'component', id: comp.id };
                        Documents._viewDoc(docId);
                      }
                    };
                  });
                }
              }
            });
          });
        }
      });

    document.querySelectorAll('#comp-tabs .tab').forEach(function(t) {

      t.onclick = function() {

        document.querySelectorAll('#comp-tabs .tab').forEach(function(x) { x.classList.remove('active'); });

        t.classList.add('active');

        var v = t.dataset.t;

        document.getElementById('comp-tree-view').style.display = v === 'tree' ? 'block' : 'none';

        document.getElementById('comp-table-view').style.display = v === 'table' ? 'block' : 'none';

        document.getElementById('comp-attachment-view').style.display = v === 'attachment' ? 'block' : 'none';

      };

    });

    }); // end _loadCFDefs.then

  },

  // 从部件详情打开子项详情
  _openChildDetail: function(childType, refId, parentCompId) {
    window._compDetailReturnTo = parentCompId;
    if (childType === 'part') {
      Parts._viewPart(refId);
    } else {
      Components._viewComp(refId);
    }
    // 在模态框 footer 中添加"返回"按钮（放在最左侧）
    setTimeout(function() {
      var footer = document.querySelector('#modal-box .modal-footer');
      if (!footer) return;
      var btn = document.createElement('button');
      btn.className = 'btn-outline';
      btn.innerHTML = '← 返回部件详情';
      btn.style.marginRight = 'auto';
      btn.onclick = function() {
        var pid = window._compDetailReturnTo;
        window._compDetailReturnTo = null;
        UI.closeModal();
        setTimeout(function() {
          Components._viewComp(pid);
        }, 150);
      };
      footer.insertBefore(btn, footer.firstChild);
    }, 100);
  },



  _editComp: function(id) {

    window._editCompId = id;

    var comp = id ? Store.getById('components', id) : null;

    var ap = Store.getAll('parts');

    var isNotDraft = comp && comp.status !== 'draft';

    var isFrozen = comp && comp.status === 'frozen';

    var isAdmin = Auth.getUser() && Auth.getUser().role === 'admin';

    window._editingCompStatus = comp ? comp.status : 'draft';

    window._editingCompIsAdmin = isAdmin;

    window._editingCompUserRole = Auth.getUser() ? Auth.getUser().role : null;

    var canE = isNotDraft ? (isFrozen && (isAdmin || Auth.getUser().role === 'engineer')) || (comp.status === 'released' && isAdmin) || (comp.status === 'obsolete' && isAdmin) : true;

    var ro = canE ? '' : ' readonly';

    var roExceptStatus = (isFrozen && (isAdmin || Auth.getUser().role === 'engineer')) ? '' : (canE ? '' : ' readonly');

    UI.modal(comp ? '编辑部件' : '新增部件',

      '<div class="form-row"><div class="form-group"><label>部件件号 <span class="required">*</span></label><input type="text" id="fc-code" value="' + _esc(comp ? comp.code : '') + '"' + (comp ? ' readonly' : '') + '></div><div class="form-group"><label>部件中文名称 <span class="required">*</span></label><input type="text" id="fc-name" value="' + _esc(comp ? comp.name : '') + '"' + ro + '></div></div>' +

      '<div class="form-group"><label>规格型号</label><input type="text" id="fc-spec" value="' + _esc(comp ? comp.spec||'' : '') + '"' + ro + '></div>' +

      '<div class="form-group"><label>状态</label><select id="fc-st"' + roExceptStatus + '><option value="draft"' + (!comp || comp.status === 'draft' ? ' selected' : '') + '>草稿</option><option value="frozen"' + (comp && comp.status === 'frozen' ? ' selected' : '') + '>冻结</option><option value="released"' + (comp && comp.status === 'released' ? ' selected' : '') + '>发布</option><option value="obsolete"' + (comp && comp.status === 'obsolete' ? ' selected' : '') + '>作废</option></select></div>' +

      '' +
      '<div id="cf-comp-edit-area"></div>' +
      '<div id="comp-attachments-area"></div>' +
      '<h4 style="margin:8px 0 12px">子项列表</h4><div id="child-items-container">' + Components._renderChildItems(comp) + '</div>' + (canE ? '<button class="btn-outline btn-sm" id="btn-add-child">＋ 添加子项</button>' : '<div style="color:#faad14;font-size:12px;margin-top:8px">⚠️ 当前状态锁定，子项不可修改</div>') +

      (isNotDraft ? '<div style="margin-top:10px;color:#faad14;font-size:12px">⚠️ 当前状态为"' + (comp.status === 'frozen' ? '冻结' : comp.status === 'released' ? '发布' : '作废') + '"，字段已锁定。' + (isFrozen ? '管理员和工程师可修改状态。' : '仅管理员可修改状态。') + '</div>' : ''),

      { footer: '<button class="btn-outline" onclick="UI.closeModal()">取消</button>' + (comp && (comp.status === 'released' || comp.status === 'obsolete') ? '<button class="btn-primary" onclick="Components._upgradeComp(\'' + comp.id + '\')">升版</button>' : '') + '<button class="btn-primary" id="btn-sc">保存</button>', large: true,
        afterRender: function() {
          // 加载附件列表（编辑时）
          if (comp && comp.id) {
            Components._loadAttachmentsForEdit(comp);
          }
          // 加载自定义字段编辑区
          _loadCFDefs().then(function(cfDefs) {
            var cfArea = document.getElementById('cf-comp-edit-area');
            if (!cfArea) return;
            var cfValues = comp ? (comp.customFields || {}) : {};
            cfArea.innerHTML = _renderCFEditHtml(cfValues, cfDefs, 'component', ro);
          });
          // 保存按钮事件
          document.getElementById('btn-sc').onclick = function() {
            var code = document.getElementById('fc-code').value.trim();
            var name = document.getElementById('fc-name').value.trim();
            if (!code || !name) { UI.toast('件号和中文名称为必填项', 'warning'); return; }
            var dup = Store.getAll('components').find(function(c2) { return c2.code === code && c2.version === (comp ? comp.version : 'A') && (!comp || c2.id !== comp.id); });
            if (dup) { UI.toast('该件号+版本组合已存在', 'error'); return; }
            if (comp && !canE) { UI.alert('您没有权限编辑此部件'); return; }
            var rawItems = window._editCompData || [];
            var parts = rawItems.map(function(item) {
              if (item.partId !== undefined && item.childType === undefined) return item;
              if (item.childType === 'component') {
                return { childType: 'component', componentId: item.componentId || '', quantity: item.quantity || 1 };
              } else {
                return { childType: 'part', partId: item.partId || '', quantity: item.quantity || 1 };
              }
            }).filter(function(p) { return p.partId || p.componentId; });
            var newV = comp ? comp.version : 'A';
            var data = {
              code:code, name:name,
              spec:document.getElementById('fc-spec').value.trim(),
              status:document.getElementById('fc-st').value,
              parts:parts,
              version:newV
            };
            if (comp) {
              var _compFieldLabels = { code:'件号', name:'中文名称', spec:'规格型号', status:'状态' };
              var _compTrackFields = ['code','name','spec','status'];
              var _compChanges = [];
              _compTrackFields.forEach(function(f) {
                var oldVal = (comp[f] || '').toString();
                var newVal = (data[f] || '').toString();
                if (oldVal !== newVal) { _compChanges.push({ field: _compFieldLabels[f] || f, oldVal: oldVal, newVal: newVal }); }
              });
              var oldPartsJson = JSON.stringify(comp.parts || []);
              var newPartsJson = JSON.stringify(data.parts || []);
              if (oldPartsJson !== newPartsJson) { _compChanges.push({ field: '子项列表', oldVal: (comp.parts||[]).length + '项', newVal: (data.parts||[]).length + '项' }); }
              if (_compChanges.length > 0) {
                var compRevisions = comp.revisions || [];
                compRevisions.push({ date: Date.now(), author: Auth.getUser() ? Auth.getUser().realName : '未知', changes: _compChanges });
                data.revisions = compRevisions;
              }
              Store.update('components', comp.id, data); Store.addLog('编辑部件', '修改部件 ' + code);
              var cfDefsForSave = Store.getAll('custom_field_defs');
              var cfVals = _collectCFValues(cfDefsForSave, 'component');
              Store.update('components', comp.id, { customFields: cfVals }, { skipSync: true });
              _saveCFValues('component', comp.id, cfVals, cfDefsForSave);
              UI.toast('部件更新成功', 'success');
            } else {
              data.revisions = [];
              Store.add('components', data); Store.addLog('新增部件', '新增部件 ' + code + ' - ' + name);
              var cfDefsForSave2 = Store.getAll('custom_field_defs');
              var cfVals2 = _collectCFValues(cfDefsForSave2, 'component');
              if (Object.keys(cfVals2).length > 0) {
                data.customFields = cfVals2;
                Store.update('components', data.id, { customFields: cfVals2 }, { skipSync: true });
                _saveCFValues('component', data.id, cfVals2, cfDefsForSave2);
              }
              UI.toast('部件新增成功', 'success');
            }
            window._editCompData = null;
            UI.closeModal(); Router.render();
          };
        }
      });

    var self = this;

    window._editCompData = JSON.parse(JSON.stringify(comp && comp.parts ? comp.parts : []));

    document.getElementById('btn-add-child').onclick = function() { Components._showChildSelector(comp ? comp.id : null); };

  },



  _renderChildItems: function(comp) {

    var items = (window._editCompData && window._editCompData.length > 0)

      ? window._editCompData

      : (comp && comp.parts ? comp.parts : []);

    if (!window._editCompData && comp && comp.parts && comp.parts.length > 0) {

      window._editCompData = comp.parts.slice();

      items = window._editCompData;

    }

    if ((items || []).length === 0) {

      return '<p style="color:var(--text-light);font-size:13px;padding:8px 0">暂无子项，请点击"添加子项"添加</p>';

    }

    var ap = Store.getAll('parts');

    var ac = Store.getAll('components');

    if (items === window._editCompData) {

      items.sort(function(a, b) {

        var typeA = a.childType || 'part';

        var typeB = b.childType || 'part';

        var refIdA = typeA === 'component' ? (a.componentId || '') : (a.partId || '');

        var refIdB = typeB === 'component' ? (b.componentId || '') : (b.partId || '');

        var infoA = typeA === 'part' ? ap.find(function(x) { return x.id === refIdA; }) : ac.find(function(x) { return x.id === refIdA; });

        var infoB = typeB === 'part' ? ap.find(function(x) { return x.id === refIdB; }) : ac.find(function(x) { return x.id === refIdB; });

        var codeA = (infoA && infoA.code) || '';

        var codeB = (infoB && infoB.code) || '';

        return codeA.localeCompare(codeB);

      });

    } else {

      items = items.slice().sort(function(a, b) {

        var typeA = a.childType || 'part';

        var typeB = b.childType || 'part';

        var refIdA = typeA === 'component' ? (a.componentId || '') : (a.partId || '');

        var refIdB = typeB === 'component' ? (b.componentId || '') : (b.partId || '');

        var infoA = typeA === 'part' ? ap.find(function(x) { return x.id === refIdA; }) : ac.find(function(x) { return x.id === refIdA; });

        var infoB = typeB === 'part' ? ap.find(function(x) { return x.id === refIdB; }) : ac.find(function(x) { return x.id === refIdB; });

        var codeA = (infoA && infoA.code) || '';

        var codeB = (infoB && infoB.code) || '';

        return codeA.localeCompare(codeB);

      });

    }

    var user = Auth.getUser();

    var isAdmin = user && user.role === 'admin';

    var compStatus = comp ? comp.status : 'draft';

    var isReleasedOrObsolete = compStatus === 'released' || compStatus === 'obsolete';

    var readOnly = isReleasedOrObsolete && !isAdmin;

    var html = '<table style="margin-bottom:8px"><thead><tr><th>类型</th><th>件号</th><th>中文名称</th><th>版本</th><th>状态</th><th>用量</th><th></th></tr></thead><tbody>';

    items.forEach(function(item, idx) {

      var type = item.childType || 'part';

      var refId = item.partId || item.componentId || '';

      var info = null;

      if (type === 'part') {

        info = ap.find(function(p) { return p.id === refId; });

      } else if (type === 'component') {

        info = ac.find(function(c) { return c.id === refId; });

      }

      if (!info) return;

      var icon = type === 'part' ? '🔧' : '📦';

      var typeLabel = type === 'part' ? '零件' : '部件';

      var inputAttr = readOnly ? ' readonly onclick="UI.alert(\'发布/作废状态的子项仅管理员可修改\')"' : ' onchange="Components._updateChildItem(' + idx + ', \'quantity\', this.value)"';

      var buttonHtml = readOnly

        ? '<button class="btn-text danger btn-sm" onclick="UI.alert(\'发布/作废状态的子项仅管理员可移除\')">移除</button>'

        : '<button class="btn-text danger btn-sm" onclick="Components._removeChildItem(' + idx + ')">移除</button>';

      html += '<tr>' +

        '<td>' + icon + ' ' + typeLabel + '</td>' +

        '<td>' + info.code + '</td>' +

        '<td>' + info.name + '</td>' +

        '<td style="font-size:12px;color:#888">' + (info.version || 'A') + '</td>' +

        '<td>' + UI.statusTag(info.status) + '</td>' +

        '<td><input type="number" value="' + (item.quantity || 1) + '" min="1" style="width:60px"' + inputAttr + '></td>' +

        '<td>' + buttonHtml + '</td>' +

        '</tr>';

    });

    html += '</tbody></table>';

    return html;

  },



  _updateChildItem: function(idx, field, value) {

    if (!window._editCompData) return;

    if (window._editingCompStatus && (window._editingCompStatus === 'released' || window._editingCompStatus === 'obsolete') && !window._editingCompIsAdmin) {

        UI.alert('发布/作废状态的子项仅管理员可修改');

        return;

    }

    if (field === 'quantity') {

      window._editCompData[idx].quantity = parseInt(value) || 1;

    }

  },



  _removeChildItem: function(idx) {

    if (!window._editCompData) return;

    if (window._editingCompStatus && (window._editingCompStatus === 'released' || window._editingCompStatus === 'obsolete') && !window._editingCompIsAdmin) {

        UI.alert('发布/作废状态的子项仅管理员可移除');

        return;

    }

    window._editCompData.splice(idx, 1);

    if (typeof window._refreshChildSelector === 'function') {

      window._refreshChildSelector();

    } else {

      var container = document.getElementById('child-items-container');

      if (container) {

        container.innerHTML = Components._renderChildItems(null);

      }

    }

  },



  _showChildSelector: function(compId) {

    var ap = Store.getAll('parts');

    var ac = Store.getAll('components');

    if (compId) {

      ac = ac.filter(function(c) { return c.id !== compId; });

    }

    var currentIds = (window._editCompData || []).map(function(item) {

      return item.partId || item.componentId || '';

    });

    var filteredParts = ap.filter(function(p) { return currentIds.indexOf(p.id) < 0; });

    var filteredComps = ac.filter(function(c) { return currentIds.indexOf(c.id) < 0; });

    window._childSelectorState = {

      filteredParts: filteredParts,

      filteredComps: filteredComps

    };

    function renderSelectorChildItems() {

      var container = document.getElementById('cs-child-items');

      if (!container) return;

      var ap = Store.getAll('parts');

      var ac = Store.getAll('components');

      var items = window._editCompData || [];

      if (items.length === 0) {

        container.innerHTML = '<p style="color:#999;font-size:12px;padding:4px 0">暂无已选子项</p>';

        return;

      }

      items.sort(function(a, b) {

        var typeA = a.childType || 'part';

        var typeB = b.childType || 'part';

        var refIdA = typeA === 'component' ? (a.componentId || '') : (a.partId || '');

        var refIdB = typeB === 'component' ? (b.componentId || '') : (b.partId || '');

        var infoA = typeA === 'part' ? ap.find(function(x) { return x.id === refIdA; }) : ac.find(function(x) { return x.id === refIdA; });

        var infoB = typeB === 'part' ? ap.find(function(x) { return x.id === refIdB; }) : ac.find(function(x) { return x.id === refIdB; });

        var codeA = (infoA && infoA.code) || '';

        var codeB = (infoB && infoB.code) || '';

        return codeA.localeCompare(codeB);

      });

      var h = '<table style="table-layout:fixed;width:100%;margin-bottom:4px"><thead><tr style="background:#f8f8f8"><th style="width:70px;text-align:left;padding:4px 6px;font-size:11px;color:#888">类型</th><th style="width:100px;text-align:left;padding:4px 6px;font-size:11px;color:#888">件号</th><th style="text-align:left;padding:4px 6px;font-size:11px;color:#888">中文名称</th><th style="width:60px;text-align:left;padding:4px 6px;font-size:11px;color:#888">版本</th><th style="width:60px;text-align:left;padding:4px 6px;font-size:11px;color:#888">状态</th><th style="width:50px;text-align:center;padding:4px 6px;font-size:11px;color:#888">用量</th><th style="width:40px"></th></tr></thead><tbody>';

      items.forEach(function(item, idx) {

        var type = item.childType || 'part';

        var refId = item.partId || item.componentId || '';

        var info = null;

        if (type === 'part') {

          info = ap.find(function(p) { return p.id === refId; });

        } else {

          info = ac.find(function(c) { return c.id === refId; });

        }

        if (!info) return;

        var icon = type === 'part' ? '🔧' : '📦';

        var label = type === 'part' ? '零件' : '部件';

        h += '<tr style="border-bottom:1px solid #f0f0f0">';

        h += '<td style="padding:4px 6px;font-size:12px"><span style="font-size:11px;color:#888">' + icon + ' ' + label + '</span></td>';

        h += '<td style="padding:4px 6px;font-size:12px">' + (info.code||'') + '</td>';

        h += '<td style="padding:4px 6px;font-size:12px">' + (info.name||'') + '</td>';

        h += '<td style="padding:4px 6px;font-size:12px;color:#888">' + (info.version || 'A') + '</td>';

        h += '<td style="padding:4px 6px;font-size:12px">' + UI.statusTag(info.status) + '</td>';

        h += '<td style="text-align:center;padding:2px 4px"><input type="number" value="' + (item.quantity||1) + '" min="1" style="width:40px;font-size:12px;padding:2px 4px" onchange="Components._updateChildItem(' + idx + ',\'quantity\',this.value)"></td>';

        h += '<td style="text-align:center"><button class="btn-text danger" style="font-size:12px;padding:2px 4px" onclick="Components._removeChildItem(' + idx + ')">×</button></td>';

        h += '</tr>';

      });

      h += '</tbody></table>';

      container.innerHTML = h;

    }

    var overlay = document.createElement('div');

    overlay.id = 'child-selector-overlay';

    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);z-index:2000;display:flex;align-items:center;justify-content:center;animation:fadeIn .15s';

    overlay.innerHTML =

      '<div style="background:#fff;border-radius:8px;width:820px;max-width:90vw;max-height:88vh;display:flex;flex-direction:column;animation:slideUp .2s;overflow:hidden">' +

      '<div style="padding:14px 20px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">' +

      '<span style="font-size:15px;font-weight:600">添加子项</span>' +

      '<button id="cs-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:#999;line-height:1;padding:0 4px">&times;</button>' +

      '</div>' +

      '<div style="padding:14px 20px 10px;flex-shrink:0">' +

      '<div style="font-size:12px;color:#666;margin-bottom:8px">已选子项</div>' +

      '<div id="cs-child-items" style="max-height:140px;overflow-y:auto;border:1px solid #e8e8e8;border-radius:6px;padding:8px 10px"></div>' +

      '</div>' +

      '<div style="padding:0 20px 14px;flex-shrink:0;display:flex;gap:8px">' +

      '<input type="text" id="cs-kw" placeholder="搜索编码、名称或规格..." style="flex:1;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px">' +

      '<select id="cs-type" style="width:110px;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px"><option value="all">全部</option><option value="part">零件</option><option value="component">部件</option></select>' +

      '</div>' +

      '<div id="cs-results" style="flex:1;overflow-y:auto;margin:0 20px 16px;border:1px solid #e8e8e8;border-radius:6px;min-height:120px"></div>' +

      '</div>';

    document.body.appendChild(overlay);

    renderSelectorChildItems();

    document.getElementById('cs-close').onclick = function() {

      overlay.remove();

      var mainContainer = document.getElementById('child-items-container');

      if (mainContainer) {

        mainContainer.innerHTML = Components._renderChildItems(null);

      }

      window._childSelectorState = null;

    };

    overlay.onclick = function(e) {

      if (e.target === overlay) {

        overlay.remove();

        var mainContainer = document.getElementById('child-items-container');

        if (mainContainer) {

          mainContainer.innerHTML = Components._renderChildItems(null);

        }

        window._childSelectorState = null;

      }

    };

    function renderResults(keyword, type) {

      var kw = keyword.toLowerCase();

      var results = [];

      var sp = window._childSelectorState ? window._childSelectorState.filteredParts : [];

      var sc = window._childSelectorState ? window._childSelectorState.filteredComps : [];

      if (type === 'all' || type === 'part') {

        sp.forEach(function(p) {

          if (!kw || p.code.toLowerCase().indexOf(kw) >= 0 || p.name.toLowerCase().indexOf(kw) >= 0 || (p.spec||'').toLowerCase().indexOf(kw) >= 0) {

            results.push({ type: 'part', data: p });

          }

        });

      }

      if (type === 'all' || type === 'component') {

        sc.forEach(function(c) {

          if (!kw || c.code.toLowerCase().indexOf(kw) >= 0 || c.name.toLowerCase().indexOf(kw) >= 0) {

            results.push({ type: 'component', data: c });

          }

        });

      }

      var container = document.getElementById('cs-results');

      if (!container) return;

      if (results.length === 0) {

        container.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:13px">未找到匹配的零件或部件</div>';

        return;

      }

      var html2 = '<table style="table-layout:fixed;width:100%"><thead><tr style="background:#f8f8f8"><th style="width:80px;text-align:left;padding:6px 10px;font-size:12px;color:#888">类型</th><th style="width:110px;text-align:left;padding:6px 10px;font-size:12px;color:#888">件号</th><th style="text-align:left;padding:6px 10px;font-size:12px;color:#888">中文名称</th><th style="width:80px;text-align:left;padding:6px 10px;font-size:12px;color:#888">版本</th><th style="width:70px;text-align:left;padding:6px 10px;font-size:12px;color:#888">状态</th><th style="width:70px;text-align:center;padding:6px 10px;font-size:12px;color:#888">操作</th></tr></thead><tbody>';

      results.forEach(function(item) {

        var d = item.data;

        var icon = item.type === 'part' ? '🔧' : '📦';

        var typeLabel = item.type === 'part' ? '零件' : '部件';

        html2 += '<tr style="border-bottom:1px solid #f5f5f5"><td style="padding:7px 10px;font-size:13px"><span style="font-size:12px;color:#888">' + icon + ' ' + typeLabel + '</span></td><td style="padding:7px 10px;font-size:13px">' + d.code + '</td><td style="padding:7px 10px;font-size:13px">' + d.name + '</td><td style="padding:7px 10px;font-size:13px;color:#888">' + (d.version || 'A') + '</td><td style="padding:7px 10px;font-size:13px">' + UI.statusTag(d.status) + '</td><td style="text-align:center;padding:7px 10px"><button class="btn-primary btn-sm" onclick="Components._addChildItem(\'' + item.type + '\',\'' + d.id + '\')">添加</button></td></tr>';

      });

      html2 += '</tbody></table>';

      container.innerHTML = html2;

    }

    window._refreshChildSelector = function() {

      var kw = document.getElementById('cs-kw') ? document.getElementById('cs-kw').value : '';

      var tf = document.getElementById('cs-type') ? document.getElementById('cs-type').value : 'all';

      renderResults(kw, tf);

      renderSelectorChildItems();

      var mainContainer = document.getElementById('child-items-container');

      if (mainContainer) {

        mainContainer.innerHTML = Components._renderChildItems(null);

      }

    };

    document.getElementById('cs-kw').oninput = function() { renderResults(this.value, document.getElementById('cs-type').value); };

    document.getElementById('cs-type').onchange = function() { renderResults(document.getElementById('cs-kw').value, this.value); };

    renderResults('', 'all');

  },



  _addChildItem: function(type, refId) {

    if (!window._editCompData) window._editCompData = [];

    var exists = window._editCompData.some(function(item) {

      return (type === 'part' && item.partId === refId) ||

             (type === 'component' && item.componentId === refId);

    });

    if (exists) { UI.toast('该子项已添加', 'warning'); return; }

    window._editCompData.push({

      childType: type,

      partId: type === 'part' ? refId : null,

      componentId: type === 'component' ? refId : null,

      quantity: 1

    });

    UI.toast('已添加子项', 'success');

    var state = window._childSelectorState;

    if (state) {

      if (type === 'part') {

        state.filteredParts = state.filteredParts.filter(function(p) { return p.id !== refId; });

      } else {

        state.filteredComps = state.filteredComps.filter(function(c) { return c.id !== refId; });

      }

    }

    if (typeof window._refreshChildSelector === 'function') {

      window._refreshChildSelector();

    }

  },



  _deleteComp: function(id) {

    var comp = Store.getById('components', id);

    if (!comp) return;

    var isAdmin = Auth.getUser() && Auth.getUser().role === 'admin';

    if ((comp.status === 'released' || comp.status === 'obsolete') && !isAdmin) { UI.alert('"发布"和"作废"状态的部件仅管理员可删除'); return; }

    var parentComps = [];

    var allComps = Store.getAll('components') || [];

    for (var i = 0; i < allComps.length; i++) {

      var c = allComps[i];

      if (c.parts && c.parts.length > 0) {

        for (var j = 0; j < c.parts.length; j++) {

          var p = c.parts[j];

          if (p.childType === 'component' && p.componentId === id && c.id !== id) { parentComps.push(c); break; }

        }

      }

    }

    if (parentComps.length > 0) {

      UI.alert('该部件被引用，不能被删除');

      return;

    }

    var allBoms = Store.getAll('boms') || [];

    var parentBoms = [];

    var findParents = function(nodes) {

      if (!nodes || !Array.isArray(nodes)) return;

      for (var i = 0; i < nodes.length; i++) {

        var node = nodes[i];

        if (node.componentId === id) { parentBoms.push({ code: node.code || node.name || 'BOM节点', name: node.name || '' }); }

        if (node.children) findParents(node.children);

      }

    };

    for (var bi = 0; bi < allBoms.length; bi++) { findParents(allBoms[bi].tree); }

    if (parentBoms.length > 0) {

      UI.alert('该部件被引用，不能被删除');

      return;

    }

    var allComps2 = Store.getAll('components');

    var newerVersions = allComps2.filter(function(c) {

        return c.code === comp.code && c.id !== id && (c.version || 'A').charCodeAt(0) > (comp.version || 'A').charCodeAt(0);

    });

    if (newerVersions.length > 0) {

        UI.alert('该部件不是最新版本，不能被删除');

        return;

    }

    UI.confirm('确定要删除部件 <strong>' + comp.code + ' - ' + comp.name + '</strong> 吗？', function() {

      Store.remove('components', id);

      Store.addLog('删除部件', '删除部件 ' + comp.code);

      UI.toast('删除成功（待同步）', 'success');

      Router.render();

    });

  },



  _upgradeComp: function(id) {

    try {

    var oldComp = Store.getById('components', id);

    if (!oldComp) { console.error('部件不存在:', id); UI.toast('部件不存在', 'error'); return; }

    if (oldComp.status !== 'released' && oldComp.status !== 'obsolete') { UI.toast('只有"发布"或"作废"状态的部件可以升版', 'warning'); return; }

    var allComps = Store.getAll('components').filter(function(c) { return c.code === oldComp.code; });

    var maxV = allComps.reduce(function(max, c) { var v = c.version || 'A'; var cv = v.charCodeAt(0); return cv > max ? cv : max; }, 0);

    if ((oldComp.version || 'A').charCodeAt(0) < maxV) { UI.alert('该部件存在更新版本，不能重复升版'); return; }

    var v = oldComp.version || 'A';

    var newV = String.fromCharCode(v.charCodeAt(0) + 1);

    if (newV > 'Z') { UI.toast('版本号已超过Z，不再支持升版', 'error'); return; }

    var newComp = JSON.parse(JSON.stringify(oldComp));

    newComp.id = _uuid();

    newComp.version = newV;

    newComp.status = 'draft';

    newComp.createdAt = Date.now();

    newComp.updatedAt = Date.now();

    var compRevisions = oldComp.revisions || [];

    compRevisions.push({ date: Date.now(), author: (Auth.getUser() ? Auth.getUser().realName : '未知'), changes: [{ field: '版本', oldVal: oldComp.version, newVal: newV }] });

    oldComp.revisions = compRevisions;

    newComp.revisions = [];

    Store.update('components', id, oldComp);

    Store.add('components', newComp);

    Store.addLog('部件升版', '部件 ' + oldComp.code + ' 从版本' + oldComp.version + ' 升版至 ' + newV);

    UI.toast('升版成功，新版本: ' + newV, 'success');

    UI.closeModal();

    Router.render();

    } catch(e) { console.error('升版错误:', e); UI.toast('升版失败: ' + e.message, 'error'); }
  },

  // 渲染附件显示（详情页）
  _renderAttachmentsView: function(comp, cfDefs) {
    var edocList = (comp._entityDocs || []);
    var html = '';
    if (edocList.length === 0) {
      html += '<div style="padding:12px;text-align:center;color:#999;font-size:13px">暂无关联图文档</div>';
      return html;
    }
    // 构建表头 - 自适应宽度
    html += '<table style="width:100%;border-collapse:collapse;table-layout:auto"><thead><tr style="background:#fafafa">' +
      '<th style="padding:6px 10px;text-align:left;font-size:12px;color:#888;font-weight:600;white-space:nowrap">图文档编号</th>' +
      '<th style="padding:6px 10px;text-align:left;font-size:12px;color:#888;font-weight:600;white-space:nowrap">图文档名称</th>' +
      '<th style="padding:6px 10px;text-align:center;font-size:12px;color:#888;font-weight:600;white-space:nowrap">版本</th>' +
      '<th style="padding:6px 10px;text-align:center;font-size:12px;color:#888;font-weight:600;white-space:nowrap">状态</th>';
    
    // 添加自定义字段列头
    (cfDefs || []).forEach(function(cf) {
      html += '<th style="padding:6px 10px;text-align:left;font-size:12px;color:#888;font-weight:600;white-space:nowrap">' + _esc(cf.name) + '</th>';
    });
    
    html += '<th style="padding:6px 10px;text-align:left;font-size:12px;color:#888;font-weight:600;white-space:nowrap">主附件</th>' +
      '<th style="padding:6px 10px;text-align:center;font-size:12px;color:#888;font-weight:600;white-space:nowrap">操作</th></tr></thead><tbody>';
    
    edocList.forEach(function(ed) {
      var d = ed.document || {};
      html += '<tr class="edoc-row" data-doc-id="' + (d.id || '') + '" style="border-bottom:1px solid #f0f0f0;cursor:pointer">' +
        '<td style="padding:6px 10px;font-weight:500;white-space:nowrap">' + _esc(d.code || '') + '</td>' +
        '<td style="padding:6px 10px">' + _esc(d.name || '') + '</td>' +
        '<td style="padding:6px 10px;text-align:center"><span class="tag" style="background:#e6f7ff;color:#1890ff">' + _esc(d.version || '') + '</span></td>' +
        '<td style="padding:6px 10px;text-align:center">' + UI.statusTag(d.status || 'draft') + '</td>';
      
      // 添加自定义字段值列
      var cfValues = d.customFields || {};
      (cfDefs || []).forEach(function(cf) {
        var val = cfValues[cf.field_key];
        var displayVal = '';
        if (val !== undefined && val !== null && val !== '') {
          if (cf.field_type === 'multiselect' && Array.isArray(val)) {
            displayVal = val.map(function(v) { return '<span class="tag" style="background:#e6f7ff;color:#1890ff;margin:1px;font-size:11px">' + _esc(String(v)) + '</span>'; }).join(' ');
          } else if (cf.field_type === 'select') {
            displayVal = '<span class="tag" style="background:#f6ffed;color:#52c41a">' + _esc(String(val)) + '</span>';
          } else if (cf.field_type === 'number') {
            displayVal = '<span style="font-weight:600;color:#1890ff">' + _esc(String(val)) + '</span>';
          } else {
            displayVal = _esc(String(val));
          }
        } else {
          displayVal = '<span style="color:#ccc">—</span>';
        }
        html += '<td style="padding:6px 10px;font-size:13px">' + displayVal + '</td>';
      });
      
      html += '<td style="padding:6px 10px">' + (d.file_name ? _esc(d.file_name) : '<span style="color:#ccc">—</span>') + '</td>' +
        '<td style="padding:6px 10px;text-align:center">' +
          (d.file_id ? '<button class="btn-link btn-download-edoc" data-file-id="' + d.file_id + '" data-file-name="' + _esc(d.file_name || 'attachment') + '">下载</button>' : '<span style="color:#ccc">—</span>') +
        '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  },

  // 加载附件列表并渲染（部件编辑）
  _loadAttachmentsForEdit: function(comp) {
    var container = document.getElementById('comp-attachments-area');
    if (!container) return;

    function render(edocs) {
      var html = '<h4 style="margin:16px 0 12px;border-top:1px solid #f0f0f0;padding-top:16px">📎 关联图文档</h4>' +
        '<div id="comp-edoc-list-area"></div>' +
        '<button class="btn-outline btn-sm" id="comp-btn-add-edoc" style="margin-top:8px">+ 关联图文档</button>';
      container.innerHTML = html;

      var listArea = document.getElementById('comp-edoc-list-area');
      if (!edocs || edocs.length === 0) {
        listArea.innerHTML = '<div style="padding:12px;text-align:center;color:#999;font-size:13px">暂无关联，点击下方"关联图文档"添加</div>';
      } else {
        edocs.forEach(function(ed) {
          var d = ed.document || {};
          var row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;margin-bottom:6px;font-size:13px;gap:8px';
          row.innerHTML =
            '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500" title="' + _esc(d.code || '') + '">' + _esc(d.code || '') + ' · ' + _esc(d.name || '') + '</span>' +
            '<span style="color:#999;font-size:12px">' + _esc(d.version || '') + '</span>' +
            '<button class="btn-link comp-edoc-remove-btn" data-id="' + ed.id + '" style="color:#ff4d4f">移除</button>';
          listArea.appendChild(row);
        });
        listArea.querySelectorAll('.comp-edoc-remove-btn').forEach(function(btn) {
          btn.onclick = function() {
            var eid = btn.dataset.id;
            API._fetch('DELETE', '/assemblies/' + comp.id + '/documents/' + eid).then(function() {
              UI.toast('关联已移除', 'success');
              API._fetch('GET', '/assemblies/' + comp.id + '/documents').then(function(list) {
                render(list);
                var allComps = Store.getAll('components');
                var cIdx = allComps.findIndex(function(c) { return c.id === comp.id; });
                if (cIdx >= 0) allComps[cIdx]._entityDocs = list;
              });
            }).catch(function(e) { UI.toast('移除失败: ' + e.message, 'error'); });
          };
        });
        // 移除类别输入控件及其监听
      }

      document.getElementById('comp-btn-add-edoc').onclick = function() { Components._showDocSelector(comp.id); };
    }

    API._fetch('GET', '/assemblies/' + comp.id + '/documents').then(function(list) {
      var allComps = Store.getAll('components');
      var cIdx = allComps.findIndex(function(c) { return c.id === comp.id; });
      if (cIdx >= 0) allComps[cIdx]._entityDocs = list;
      Store.saveAll('components', allComps);
      render(list);
    }).catch(function() { render([]); });
  },

  _showDocSelector: function(compId) {
    var docs = Store.getAll('documents') || [];
    
    // 获取已关联的图文档ID
    var existingComp = Store.getAll('components').find(function(c) { return c.id === compId; });
    var existingDocIds = [];
    if (existingComp && existingComp._entityDocs) {
      existingDocIds = existingComp._entityDocs.map(function(ed) {
        var d = ed.document || {};
        return d.id || ed.document_id || null;
      }).filter(function(x) { return !!x; });
    }
    
    // 过滤掉已关联的
    var filteredDocs = docs.filter(function(d) { return existingDocIds.indexOf(d.id) < 0; });
    
    window._docSelectorState = {
      filteredDocs: filteredDocs,
      selectedDocs: [],
      cfDefs: null // 缓存自定义字段定义
    };
    
    // 加载自定义字段定义
    _loadDocCFDefs().then(function(cfDefs) {
      window._docSelectorState.cfDefs = cfDefs || [];
      // 批量获取所有可选图文档的自定义字段值
      if (window._docSelectorState.cfDefs.length > 0 && filteredDocs.length > 0) {
        var cfValuePromises = filteredDocs.map(function(d) {
          return API.getCustomFieldValues('document', d.id).then(function(values) {
            var cfMap = {};
            (values || []).forEach(function(v) { if (v.field_key) cfMap[v.field_key] = v.value; });
            d.customFields = cfMap;
          }).catch(function() {
            d.customFields = {};
          });
        });
        Promise.all(cfValuePromises).then(function() {
          _initDocSelectorUI(compId);
        });
      } else {
        _initDocSelectorUI(compId);
      }
    });
    
    function _initDocSelectorUI(compId) {
    function renderSelectedDocs() {
      var container = document.getElementById('ds-selected-docs');
      if (!container) return;
      
      var selected = window._docSelectorState ? window._docSelectorState.selectedDocs : [];
      var cfDefs = window._docSelectorState ? window._docSelectorState.cfDefs : [];
      
      if (selected.length === 0) {
        container.innerHTML = '<p style="color:#999;font-size:12px;padding:4px 0">暂无已选图文档</p>';
        return;
      }
      
      // 构建表头 - 包含自定义字段
      var h = '<table style="table-layout:auto;width:100%;margin-bottom:4px"><thead><tr style="background:#f8f8f8">' +
        '<th style="text-align:left;padding:4px 6px;font-size:11px;color:#888;white-space:nowrap">编号</th>' +
        '<th style="text-align:left;padding:4px 6px;font-size:11px;color:#888;white-space:nowrap">名称</th>' +
        '<th style="text-align:left;padding:4px 6px;font-size:11px;color:#888;white-space:nowrap">版本</th>' +
        '<th style="text-align:left;padding:4px 6px;font-size:11px;color:#888;white-space:nowrap">状态</th>';
      
      // 添加自定义字段列头
      (cfDefs || []).forEach(function(cf) {
        h += '<th style="text-align:left;padding:4px 6px;font-size:11px;color:#888;white-space:nowrap">' + _esc(cf.name) + '</th>';
      });
      
      h += '<th style="width:40px"></th></tr></thead><tbody>';
      
      selected.forEach(function(d, idx) {
        h += '<tr style="border-bottom:1px solid #f0f0f0">';
        h += '<td style="padding:4px 6px;font-size:12px;white-space:nowrap">' + _esc(d.code || '') + '</td>';
        h += '<td style="padding:4px 6px;font-size:12px">' + _esc(d.name || '') + '</td>';
        h += '<td style="padding:4px 6px;font-size:12px;color:#888">' + _esc(d.version || 'A') + '</td>';
        h += '<td style="padding:4px 6px;font-size:12px">' + UI.statusTag(d.status || 'draft') + '</td>';
        
        // 添加自定义字段值列
        var cfValues = d.customFields || {};
        (cfDefs || []).forEach(function(cf) {
          var val = cfValues[cf.field_key];
          var displayVal = '';
          if (val !== undefined && val !== null && val !== '') {
            if (cf.field_type === 'multiselect' && Array.isArray(val)) {
              displayVal = val.map(function(v) { return '<span class="tag" style="background:#e6f7ff;color:#1890ff;margin:1px;font-size:10px">' + _esc(String(v)) + '</span>'; }).join(' ');
            } else if (cf.field_type === 'select') {
              displayVal = '<span class="tag" style="background:#f6ffed;color:#52c41a">' + _esc(String(val)) + '</span>';
            } else if (cf.field_type === 'number') {
              displayVal = '<span style="font-weight:600;color:#1890ff;font-size:12px">' + _esc(String(val)) + '</span>';
            } else {
              displayVal = _esc(String(val));
            }
          } else {
            displayVal = '<span style="color:#ccc">—</span>';
          }
          h += '<td style="padding:4px 6px;font-size:12px">' + displayVal + '</td>';
        });
        
        h += '<td style="text-align:center"><button class="btn-text danger" style="font-size:12px;padding:2px 4px" onclick="Components._removeSelectedDoc(\'' + d.id + '\')">×</button></td>';
        h += '</tr>';
      });
      
      h += '</tbody></table>';
      container.innerHTML = h;
    }
    
    var overlay = document.createElement('div');
    overlay.id = 'doc-selector-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);z-index:2000;display:flex;align-items:center;justify-content:center;animation:fadeIn .15s';
    
    overlay.innerHTML =
      '<div style="background:#fff;border-radius:8px;width:720px;max-width:90vw;max-height:88vh;display:flex;flex-direction:column;animation:slideUp .2s;overflow:hidden">' +
      '<div style="padding:14px 20px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">' +
      '<span style="font-size:15px;font-weight:600">关联图文档</span>' +
      '<button id="ds-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:#999;line-height:1;padding:0 4px">&times;</button>' +
      '</div>' +
      '<div style="padding:14px 20px 10px;flex-shrink:0">' +
      '<div style="font-size:12px;color:#666;margin-bottom:8px">已选图文档</div>' +
      '<div id="ds-selected-docs" style="max-height:140px;overflow-y:auto;border:1px solid #e8e8e8;border-radius:6px;padding:8px 10px"></div>' +
      '</div>' +
      '<div style="padding:0 20px 14px;flex-shrink:0">' +
      '<input type="text" id="ds-kw" placeholder="搜索编号或名称..." style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px">' +
      '</div>' +
      '<div id="ds-results" style="flex:1;overflow-y:auto;margin:0 20px 16px;border:1px solid #e8e8e8;border-radius:6px;min-height:120px"></div>' +
      '<div style="padding:12px 20px;border-top:1px solid #f0f0f0;flex-shrink:0;display:flex;justify-content:flex-end;gap:8px">' +
      '<button class="btn-outline" id="ds-cancel">取消</button>' +
      '<button class="btn-primary" id="ds-confirm">确认关联</button>' +
      '</div>' +
      '</div>';
    
    document.body.appendChild(overlay);
    renderSelectedDocs();
    
    function closeOverlay() {
      overlay.remove();
      window._docSelectorState = null;
      window._refreshDocSelector = null;
    }
    
    document.getElementById('ds-close').onclick = closeOverlay;
    document.getElementById('ds-cancel').onclick = closeOverlay;
    
    overlay.onclick = function(e) {
      if (e.target === overlay) closeOverlay();
    };
    
    function renderResults(keyword) {
      var kw = (keyword || '').toLowerCase();
      var filtered = window._docSelectorState ? window._docSelectorState.filteredDocs : [];
      var cfDefs = window._docSelectorState ? window._docSelectorState.cfDefs : [];
      
      var results = filtered.filter(function(d) {
        if (!kw) return true;
        return (d.code && d.code.toLowerCase().indexOf(kw) >= 0) || (d.name && d.name.toLowerCase().indexOf(kw) >= 0);
      });
      
      var container = document.getElementById('ds-results');
      if (!container) return;
      
      if (results.length === 0) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:13px">未找到匹配的图文档</div>';
        return;
      }
      
      // 构建表头 - 包含自定义字段，自适应宽度
      var html = '<table style="table-layout:auto;width:100%"><thead><tr style="background:#f8f8f8">' +
        '<th style="text-align:left;padding:6px 10px;font-size:12px;color:#888;white-space:nowrap">编号</th>' +
        '<th style="text-align:left;padding:6px 10px;font-size:12px;color:#888;white-space:nowrap">名称</th>' +
        '<th style="text-align:left;padding:6px 10px;font-size:12px;color:#888;white-space:nowrap">版本</th>' +
        '<th style="text-align:left;padding:6px 10px;font-size:12px;color:#888;white-space:nowrap">状态</th>';
      
      // 添加自定义字段列头
      (cfDefs || []).forEach(function(cf) {
        html += '<th style="text-align:left;padding:6px 10px;font-size:12px;color:#888;white-space:nowrap">' + _esc(cf.name) + '</th>';
      });
      
      html += '<th style="text-align:center;padding:6px 10px;font-size:12px;color:#888;white-space:nowrap">操作</th></tr></thead><tbody>';
      
      results.forEach(function(d) {
        html += '<tr style="border-bottom:1px solid #f5f5f5">' +
          '<td style="padding:7px 10px;font-size:13px;white-space:nowrap">' + _esc(d.code || '') + '</td>' +
          '<td style="padding:7px 10px;font-size:13px">' + _esc(d.name || '') + '</td>' +
          '<td style="padding:7px 10px;font-size:13px;color:#888">' + _esc(d.version || 'A') + '</td>' +
          '<td style="padding:7px 10px;font-size:13px">' + UI.statusTag(d.status || 'draft') + '</td>';
        
        // 添加自定义字段值列
        var cfValues = d.customFields || {};
        (cfDefs || []).forEach(function(cf) {
          var val = cfValues[cf.field_key];
          var displayVal = '';
          if (val !== undefined && val !== null && val !== '') {
            if (cf.field_type === 'multiselect' && Array.isArray(val)) {
              displayVal = val.map(function(v) { return '<span class="tag" style="background:#e6f7ff;color:#1890ff;margin:1px;font-size:10px">' + _esc(String(v)) + '</span>'; }).join(' ');
            } else if (cf.field_type === 'select') {
              displayVal = '<span class="tag" style="background:#f6ffed;color:#52c41a">' + _esc(String(val)) + '</span>';
            } else if (cf.field_type === 'number') {
              displayVal = '<span style="font-weight:600;color:#1890ff">' + _esc(String(val)) + '</span>';
            } else {
              displayVal = _esc(String(val));
            }
          } else {
            displayVal = '<span style="color:#ccc">—</span>';
          }
          html += '<td style="padding:7px 10px;font-size:13px">' + displayVal + '</td>';
        });
        
        html += '<td style="text-align:center;padding:7px 10px"><button class="btn-primary btn-sm" onclick="Components._addSelectedDoc(\'' + d.id + '\')">添加</button></td></tr>';
      });
      
      html += '</tbody></table>';
      container.innerHTML = html;
    }
    
    window._refreshDocSelector = function() {
      var kw = document.getElementById('ds-kw') ? document.getElementById('ds-kw').value : '';
      renderResults(kw);
      renderSelectedDocs();
    };
    
    document.getElementById('ds-kw').oninput = function() { renderResults(this.value); };
    
    document.getElementById('ds-confirm').onclick = function() {
      var selected = window._docSelectorState ? window._docSelectorState.selectedDocs : [];
      if (selected.length === 0) {
        UI.toast('请至少选择一个图文档', 'warning');
        return;
      }
      
      var promises = selected.map(function(d) {
        return API._fetch('POST', '/assemblies/' + compId + '/documents', { id: _uuid(), document_id: d.id, sort_order: 0 });
      });
      
      Promise.all(promises).then(function() {
        UI.toast('关联成功', 'success');
        closeOverlay();
        // 刷新编辑界面中的图文档列表
        var comp = Store.getById('components', compId);
        if (comp) Components._loadAttachmentsForEdit(comp);
      }).catch(function(e) {
        UI.toast('关联失败: ' + e.message, 'error');
      });
    };
    
    renderResults('');
    } // end _initDocSelectorUI
  },
  
  _addSelectedDoc: function(docId) {
    if (!window._docSelectorState) return;
    
    var doc = (window._docSelectorState.filteredDocs || []).find(function(d) { return d.id === docId; });
    if (!doc) return;
    
    // 添加到已选
    window._docSelectorState.selectedDocs.push(doc);
    
    // 从可选列表中移除
    window._docSelectorState.filteredDocs = window._docSelectorState.filteredDocs.filter(function(d) { return d.id !== docId; });
    
    UI.toast('已添加图文档', 'success');
    
    if (typeof window._refreshDocSelector === 'function') {
      window._refreshDocSelector();
    }
  },
  
  _removeSelectedDoc: function(docId) {
    if (!window._docSelectorState) return;
    
    var doc = window._docSelectorState.selectedDocs.find(function(d) { return d.id === docId; });
    if (!doc) return;
    
    // 从已选中移除
    window._docSelectorState.selectedDocs = window._docSelectorState.selectedDocs.filter(function(d) { return d.id !== docId; });
    
    // 加回到可选列表
    window._docSelectorState.filteredDocs.push(doc);
    
    if (typeof window._refreshDocSelector === 'function') {
      window._refreshDocSelector();
    }
  }
};


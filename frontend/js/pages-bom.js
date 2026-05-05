var Bom = {

  // BOM管理：对比与反查两个独立界面
  render: function(c) {
    var currentCompareData = null; // 存储当前对比结果，用于导出
    c.innerHTML = 
      '<div class="bom-management-container">' +
        '<div class="bom-view-switcher">' +
          '<button class="view-switch-btn active" data-view="compare">📊 BOM对比</button>' +
          '<button class="view-switch-btn" data-view="search">🔍 BOM反查</button>' +
          '<button class="view-switch-btn" data-view="doc-search">📄 图文档反查</button>' +
        '</div>' +
        
        '<div class="bom-view active" id="view-compare">' +
          '<div class="view-header">' +
            '<h3>BOM对比</h3>' +
            '<p class="view-description">选择两个装配体版本，对比其BOM结构差异</p>' +
          '</div>' +
          '<div class="compare-header">' +
            '<div class="version-selector left-selector">' +
              '<label>左侧版本</label>' +
              '<select id="left-assembly" class="form-select"><option>加载中...</option></select>' +
            '</div>' +
            '<div class="compare-toolbar">' +
              '<button class="btn-primary" id="compare-btn">开始对比</button>' +
              '<button class="btn-outline" id="expand-all">全展开</button>' +
              '<button class="btn-outline" id="collapse-all">全折叠</button>' +
              '<label class="checkbox-label"><input type="checkbox" id="show-changes-only"> 只显示变更</label>' +
              '<button class="btn-outline" id="export-csv">📥 导出CSV</button>' +
            '</div>' +
            '<div class="version-selector right-selector">' +
              '<label>右侧版本</label>' +
              '<select id="right-assembly" class="form-select"><option>加载中...</option></select>' +
            '</div>' +
          '</div>' +
          '<div class="compare-body">' +
            '<div class="compare-table left-table" id="left-table"></div>' +
            '<div class="compare-divider"></div>' +
            '<div class="compare-table right-table" id="right-table"></div>' +
          '</div>' +
          '<div class="compare-footer">' +
            '<div class="summary" id="compare-summary">选择两个装配体版本进行对比</div>' +
          '</div>' +
        '</div>' +
        
        '<div class="bom-view" id="view-search">' +
          '<div class="card" style="margin-bottom:20px">' +
            '<input type="text" id="bom-search-input" placeholder="输入件号或名称搜索零件/部件..." autocomplete="off" class="form-input" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box" />' +
            '<div id="bom-search-results" style="margin-top:8px;display:none;max-height:320px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:8px"></div>' +
          '</div>' +
          '<div id="bom-search-tree"></div>' +
        '</div>' +
        
        '<div class="bom-view" id="view-doc-search">' +
          '<div class="card" style="margin-bottom:20px">' +
            '<input type="text" id="doc-search-input" placeholder="输入编号或名称搜索图文档..." autocomplete="off" class="form-input" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box" />' +
            '<div id="doc-search-results" style="margin-top:8px;display:none;max-height:320px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:8px"></div>' +
          '</div>' +
          '<div id="doc-search-result-area"></div>' +
        '</div>' +
      '</div>';
    
    // 初始化视图切换
    var viewBtns = c.querySelectorAll('.view-switch-btn');
    viewBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var view = this.getAttribute('data-view');
        c.querySelectorAll('.view-switch-btn').forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
        c.querySelectorAll('.bom-view').forEach(function(viewEl) {
          viewEl.classList.remove('active');
        });
        c.querySelector('#view-' + view).classList.add('active');
      });
    });
    
    // 加载装配体列表
    var leftSelect = c.querySelector('#left-assembly');
    var rightSelect = c.querySelector('#right-assembly');
    var assemblies = Store.getAll('components');
    leftSelect.innerHTML = '';
    rightSelect.innerHTML = '';
    assemblies.forEach(function(assy) {
      var option = '<option value="' + assy.id + '">' + assy.code + ' - ' + assy.name + ' (' + assy.version + ')</option>';
      leftSelect.innerHTML += option;
      rightSelect.innerHTML += option;
    });
    
    // 对比按钮事件
    c.querySelector('#compare-btn').addEventListener('click', async function() {
      var leftId = leftSelect.value;
      var rightId = rightSelect.value;
      if (!leftId || !rightId) { UI.toast('请选择左右两侧的装配体', 'warning'); return; }
      if (leftId === rightId) { UI.toast('请选择两个不同的装配体', 'warning'); return; }
      
      UI.toast('正在对比...', 'info');
      var compareBtn = this;
      compareBtn.disabled = true;
      compareBtn.textContent = '对比中...';
      
      try {
        var requestBody = {
          left_assembly_id: leftId,
          right_assembly_id: rightId,
          options: { include_unchanged: true, max_depth: 10 }
        };
        var compareData = await API._fetch('POST', '/bom/compare', requestBody);
        renderCompareResults(compareData.comparison, leftId, rightId);
        updateCompareSummary(compareData.summary);
        UI.toast('对比完成', 'success');
      } catch (error) {
        console.error('对比失败:', error);
        UI.toast('对比失败: ' + error.message, 'error');
      } finally {
        compareBtn.disabled = false;
        compareBtn.textContent = '开始对比';
      }
    });
    
    // 渲染对比结果到左右表格
    function renderCompareResults(compareData, leftAssemblyId, rightAssemblyId) {
      currentCompareData = compareData;
      var leftTable = c.querySelector('#left-table');
      var rightTable = c.querySelector('#right-table');
      leftTable.innerHTML = '';
      rightTable.innerHTML = '';
      
      if (!compareData || compareData.length === 0) {
        leftTable.innerHTML = '<div class="empty-table">无对比数据</div>';
        rightTable.innerHTML = '<div class="empty-table">无对比数据</div>';
        return;
      }
      
      var leftAssembly = Store.getById('components', leftAssemblyId);
      var rightAssembly = Store.getById('components', rightAssemblyId);
      var leftTitle = leftAssembly ? leftAssembly.code + ' - ' + leftAssembly.name + ' (' + leftAssembly.version + ')' : '左侧装配体';
      var rightTitle = rightAssembly ? rightAssembly.code + ' - ' + rightAssembly.name + ' (' + rightAssembly.version + ')' : '右侧装配体';
      
      var leftHeader = '<div class="compare-table-header"><strong>' + leftTitle + '</strong></div>';
      var rightHeader = '<div class="compare-table-header"><strong>' + rightTitle + '</strong></div>';
      
      var leftRows = '';
      var rightRows = '';
      
      compareData.forEach(function(item, index) {
        var leftItem = item.left;
        var rightItem = item.right;
        var changeType = item.change_type;
        var level = item.level || 0;
        
        var changeTypeMap = {
            'add': 'added', 'added': 'added', 'delete': 'removed', 'removed': 'removed',
            'modify': 'modified', 'modified': 'modified', 'none': 'unchanged',
            'unchanged': 'unchanged', 'internal': 'internal'
        };
        var frontendChangeType = changeTypeMap[changeType] || changeType;
        
        var changeColor = '';
        switch (frontendChangeType) {
          case 'added': changeColor = 'added-row'; break;
          case 'removed': changeColor = 'removed-row'; break;
          case 'modified': changeColor = 'modified-row'; break;
          case 'unchanged': changeColor = 'unchanged-row'; break;
          case 'internal': changeColor = 'internal-row'; break;
        }
        
        var changeTypeText = '';
        switch (frontendChangeType) {
          case 'added': changeTypeText = '新增'; break;
          case 'removed': changeTypeText = '删除'; break;
          case 'modified': changeTypeText = '修改'; break;
          case 'unchanged': changeTypeText = '未变'; break;
          case 'internal': changeTypeText = '内部变更'; break;
        }
        
        var indent = level * 20;
        var indentStyle = 'margin-left: ' + indent + 'px;';
        var levelText = 'L' + (level + 1);
        
        if (leftItem) {
          var leftDetail = leftItem.detail || {};
          leftRows += '<div class="compare-row ' + changeColor + '" style="' + indentStyle + '">' +
            '<div class="compare-cell">' + levelText + '</div>' +
            '<div class="compare-cell"><strong>' + (leftDetail.code || '') + '</strong></div>' +
            '<div class="compare-cell">' + (leftDetail.name || '') + '</div>' +
            '<div class="compare-cell">' + (leftItem.quantity || '') + '</div>' +
            '<div class="compare-cell">' + (leftItem.child_type === 'part' ? '零件' : '部件') + '</div>' +
            '<div class="compare-cell">' + (leftDetail.version || '') + '</div>' +
            '<div class="compare-cell">' + changeTypeText + '</div></div>';
        } else {
          leftRows += '<div class="compare-row ' + changeColor + '" style="' + indentStyle + '">' +
            '<div class="compare-cell">' + levelText + '</div>' +
            '<div class="compare-cell">—</div><div class="compare-cell">—</div><div class="compare-cell">—</div>' +
            '<div class="compare-cell">—</div><div class="compare-cell">—</div>' +
            '<div class="compare-cell">' + changeTypeText + '</div></div>';
        }
        
        if (rightItem) {
          var rightDetail = rightItem.detail || {};
          rightRows += '<div class="compare-row ' + changeColor + '" style="' + indentStyle + '">' +
            '<div class="compare-cell">' + levelText + '</div>' +
            '<div class="compare-cell"><strong>' + (rightDetail.code || '') + '</strong></div>' +
            '<div class="compare-cell">' + (rightDetail.name || '') + '</div>' +
            '<div class="compare-cell">' + (rightItem.quantity || '') + '</div>' +
            '<div class="compare-cell">' + (rightItem.child_type === 'part' ? '零件' : '部件') + '</div>' +
            '<div class="compare-cell">' + (rightDetail.version || '') + '</div>' +
            '<div class="compare-cell">' + changeTypeText + '</div></div>';
        } else {
          rightRows += '<div class="compare-row ' + changeColor + '" style="' + indentStyle + '">' +
            '<div class="compare-cell">' + levelText + '</div>' +
            '<div class="compare-cell">—</div><div class="compare-cell">—</div><div class="compare-cell">—</div>' +
            '<div class="compare-cell">—</div><div class="compare-cell">—</div>' +
            '<div class="compare-cell">' + changeTypeText + '</div></div>';
        }
      });
      
      var columnHeader = '<div class="compare-column-header">' +
          '<div class="compare-column-cell">层级</div><div class="compare-column-cell">件号</div>' +
          '<div class="compare-column-cell">名称</div><div class="compare-column-cell">用量</div>' +
          '<div class="compare-column-cell">类型</div><div class="compare-column-cell">版本</div>' +
          '<div class="compare-column-cell">变更类型</div></div>';
      
      leftTable.innerHTML = leftHeader + columnHeader + '<div class="compare-table-body">' + leftRows + '</div>';
      rightTable.innerHTML = rightHeader + columnHeader + '<div class="compare-table-body">' + rightRows + '</div>';
    }
    
    function updateCompareSummary(compareData) {
      var summaryEl = c.querySelector('#compare-summary');
      if (!summaryEl) return;
      var summaryText = '';
      if (compareData && typeof compareData === 'object' && !Array.isArray(compareData)) {
        var total = compareData.total || 0;
        var added = compareData.added || 0;
        var removed = compareData.deleted || compareData.removed || 0;
        var modified = compareData.modified || 0;
        var unchanged = compareData.unchanged || 0;
        summaryText = '共 ' + total + ' 项，新增 ' + added + ' 项，删除 ' + removed + ' 项，修改 ' + modified + ' 项，未变 ' + unchanged + ' 项';
      } else if (Array.isArray(compareData)) {
        if (compareData.length === 0) { summaryText = '无对比数据'; }
        else {
          var added = 0, removed = 0, modified = 0, unchanged = 0;
          compareData.forEach(function(item) {
            switch (item.change_type) {
              case 'added': added++; break; case 'removed': removed++; break;
              case 'modified': modified++; break; case 'unchanged': unchanged++; break;
            }
          });
          summaryText = '共 ' + compareData.length + ' 项，新增 ' + added + ' 项，删除 ' + removed + ' 项，修改 ' + modified + ' 项，未变 ' + unchanged + ' 项';
        }
      } else { summaryText = '无对比数据'; }
      summaryEl.innerHTML = summaryText;
    }
    
    c.querySelector('#expand-all').addEventListener('click', function() {
      c.querySelectorAll('.compare-row').forEach(function(row) { row.style.display = 'grid'; });
      UI.toast('已展开所有行', 'info');
    });
    
    c.querySelector('#collapse-all').addEventListener('click', function() {
      c.querySelectorAll('.compare-row').forEach(function(row) {
        var indent = parseInt(row.style.marginLeft) || 0;
        row.style.display = indent === 0 ? 'grid' : 'none';
      });
      UI.toast('已折叠所有子项', 'info');
    });
    
    c.querySelector('#show-changes-only').addEventListener('change', function(e) {
      var showChangesOnly = e.target.checked;
      c.querySelectorAll('.compare-row').forEach(function(row) {
        row.style.display = (showChangesOnly && row.classList.contains('unchanged-row')) ? 'none' : 'grid';
      });
      UI.toast(showChangesOnly ? '只显示变更项' : '显示所有项', 'info');
    });
    
    c.querySelector('#export-csv').addEventListener('click', function() {
      if (!currentCompareData) { UI.toast('暂无对比数据，请先执行对比', 'warning'); return; }
      var csvRows = [];
      csvRows.push(['层级','变更类型','左侧件号','左侧名称','左侧用量','左侧类型','左侧版本','右侧件号','右侧名称','右侧用量','右侧类型','右侧版本'].join(','));
      currentCompareData.forEach(function(item) {
        var left = item.left, right = item.right;
        var changeTypeMap = { 'added': '新增', 'removed': '删除', 'modified': '修改', 'unchanged': '未变' };
        var changeTypeText = changeTypeMap[item.change_type] || item.change_type;
        csvRows.push([
          item.level || 0, changeTypeText,
          left && left.detail ? left.detail.code || '' : '', left && left.detail ? left.detail.name || '' : '',
          left ? left.quantity || '' : '', left ? (left.child_type === 'part' ? '零件' : '部件') : '',
          left && left.detail ? left.detail.version || '' : '',
          right && right.detail ? right.detail.code || '' : '', right && right.detail ? right.detail.name || '' : '',
          right ? right.quantity || '' : '', right ? (right.child_type === 'part' ? '零件' : '部件') : '',
          right && right.detail ? right.detail.version || '' : ''
        ].map(function(cell) {
          if (typeof cell === 'string' && (cell.includes(',') || cell.includes('\n') || cell.includes('"'))) {
            return '"' + cell.replace(/"/g, '""') + '"';
          }
          return cell;
        }).join(','));
      });
      var csvContent = csvRows.join('\n');
      var blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'BOM对比_' + new Date().toISOString().slice(0,10) + '.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      UI.toast('CSV导出成功', 'success');
    });
    
    // BOM反查功能
    var searchInput = c.querySelector('#bom-search-input');
    var searchResults = c.querySelector('#bom-search-results');
    var searchTree = c.querySelector('#bom-search-tree');
    var searchTimer = null;
    
    function performSearch() {
      var keyword = searchInput.value.trim().toLowerCase();
      if (!keyword) { searchResults.style.display = 'none'; searchTree.innerHTML = ''; return; }
      var parts = Store.getAll('parts');
      var comps = Store.getAll('components');
      var all = [];
      parts.forEach(function(p) {
        if ((p.code && p.code.toLowerCase().includes(keyword)) || (p.name && p.name.toLowerCase().includes(keyword))) {
          all.push({ id: p.id, code: p.code, name: p.name, version: p.version, status: p.status, _type: 'part' });
        }
      });
      comps.forEach(function(c2) {
        if ((c2.code && c2.code.toLowerCase().includes(keyword)) || (c2.name && c2.name.toLowerCase().includes(keyword))) {
          all.push({ id: c2.id, code: c2.code, name: c2.name, version: c2.version, status: c2.status, _type: 'component' });
        }
      });
      if (all.length === 0) {
        searchResults.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-light);font-size:13px">未找到匹配的零件或部件</div>';
        searchResults.style.display = 'block'; searchTree.innerHTML = ''; return;
      }
      var html = '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb"><th style="padding:8px 12px;text-align:left;color:var(--text-secondary);font-weight:500">件号</th><th style="padding:8px 12px;text-align:left;color:var(--text-secondary);font-weight:500">名称</th><th style="padding:8px 12px;text-align:center;color:var(--text-secondary);font-weight:500">类型</th><th style="padding:8px 12px;text-align:center;color:var(--text-secondary);font-weight:500">版本</th><th style="padding:8px 12px;text-align:center;color:var(--text-secondary);font-weight:500">状态</th></tr></thead><tbody>';
      all.forEach(function(item) {
        var ver = item.version || '';
        var statusHtml = item.status ? UI.statusTag(item.status) : '<span style="color:#9ca3af;font-size:12px">-</span>';
        var typeHtml = item._type === 'component'
          ? '<span style="font-size:12px;padding:1px 6px;border-radius:3px;background:#e6f4ff;color:#1677ff;border:1px solid #91caff">部件</span>'
          : '<span style="font-size:12px;padding:1px 6px;border-radius:3px;background:#f6ffed;color:#52c41a;border:1px solid #b7eb8f">零件</span>';
        html += '<tr class="br-part-row" data-id="'+item.id+'" data-type="'+item._type+'" style="cursor:pointer">' +
          '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;font-weight:500">'+item.code+'</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;color:var(--text-secondary)">'+item.name+'</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:center">'+typeHtml+'</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:center;font-size:12px;color:var(--text-secondary)">'+(ver||'-')+'</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:center">'+statusHtml+'</td></tr>';
      });
      html += '</tbody></table>';
      searchResults.innerHTML = html; searchResults.style.display = 'block'; searchTree.innerHTML = '';
      c.querySelectorAll('.br-part-row').forEach(function(row) {
        row.onmouseover = function() { this.style.background = '#f0f7ff'; };
        row.onmouseout = function() { this.style.background = ''; };
        row.onclick = function() {
          var rid = this.getAttribute('data-id');
          var rtype = this.getAttribute('data-type');
          searchResults.style.display = 'none';
          doReverse(rid, rtype);
        };
      });
    }
    
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(performSearch, 300);
    });
    searchResults.style.display = 'none';

    function doReverse(rid, rtype) {
      var entity = (rtype === 'component')
        ? Store.getById('components', rid) : Store.getById('parts', rid);
      var comps = Store.getAll('components');
      var partsAll = Store.getAll('parts');
      // 直接从部件的 parts[] 字段动态构建引用映射，不依赖 bom_items
      var childToParents = {};
      comps.forEach(function(comp) {
        var items = comp.parts || [];
        items.forEach(function(item) {
          var childId = item.partId || item.componentId || item.childId || item.child_id;
          if (!childId) return;
          if (!childToParents[childId]) childToParents[childId] = [];
          childToParents[childId].push({
            parentId: comp.id,
            parentType: 'assembly',
            quantity: item.quantity || 1,
            childId: childId,
            childType: item.childType || (item.partId ? 'part' : 'component')
          });
        });
      });
      var visited = new Set();
      var rootType = rtype || 'part';
      var tree = {
        id: rid, name: entity ? entity.name : '?', code: entity ? entity.code : '-',
        version: entity ? (entity.version || '') : '', status: entity ? (entity.status || '') : '',
        type: rootType, level: 0, parents: []
      };
      function searchUp(entityId, level) {
        if (!entityId || visited.has(entityId)) return [];
        visited.add(entityId);
        var refs = [];
        var parentItems = childToParents[entityId] || [];
        parentItems.forEach(function(bi) {
          var pt = bi.parentType;
          var puid = bi.parentId;
          if (!puid) return;
          var parentEntity = (pt === 'assembly' || pt === 'component')
            ? comps.find(function(c2){return c2.id === puid;})
            : partsAll.find(function(p){return p.id === puid;});
          if (!parentEntity) return;
          var node = {
            id: puid, name: parentEntity.name || '?', code: parentEntity.code || '-',
            version: parentEntity.version || '', status: parentEntity.status || '',
            type: pt, level: level, bomItem: bi, parents: []
          };
          if (pt === 'assembly' || pt === 'component') { node.parents = searchUp(puid, level + 1); }
          refs.push(node);
        });
        return refs;
      }
      tree.parents = searchUp(rid, 1);
      var total = _countTreeNodes(tree);
      var rootLabel = rootType === 'component' ? '部件' : '零件';
      var html = '<div class="stat-card" style="margin-bottom:20px;max-width:400px"><div class="stat-icon '+(total>0?'blue':'gray')+'">🔍</div><div class="stat-info"><div class="label">被引用节点数</div><div class="value">'+(total+1)+'</div></div></div>';
      if (total === 0) {
        html += '<div class="card"><div class="card-body" style="text-align:center;padding:40px;color:var(--text-light)">该'+rootLabel+'未被任何部件引用（顶层'+rootLabel+'）</div></div>';
      } else {
        html += '<div class="card"><div id="br-tree">' + _renderTreeNode(tree, true) + '</div></div>';
      }
      searchTree.innerHTML = html;
      c.querySelectorAll('#br-tree .br-toggle').forEach(function(btn) {
        btn.onclick = function() {
          var node = btn.closest('.br-node');
          var children = node.querySelector('.br-children');
          if (!children) return;
          var open = children.style.display !== 'none';
          children.style.display = open ? 'none' : 'block';
          btn.textContent = open ? '▶' : '▼';
        };
      });
    }

    function _countTreeNodes(node) {
      var count = node.parents ? node.parents.length : 0;
      (node.parents || []).forEach(function(p){ count += _countTreeNodes(p); });
      return count;
    }

    function _renderTreeNode(node, isRoot) {
      var indent = node.level * 24;
      var hasChildren = node.parents && node.parents.length > 0;
      var toggle = hasChildren ? '<button class="br-toggle" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--primary);padding:0 4px;line-height:1">▼</button>' : '<span style="display:inline-block;width:20px"></span>';
      var version = node.version || '';
      var statusHtml = node.status ? UI.statusTag(node.status) : '';
      var levelLabel = '<span style="display:inline-block;min-width:36px;font-size:11px;font-weight:600;color:#fff;background:var(--primary);border-radius:10px;padding:1px 7px;text-align:center">L'+node.level+'</span>';
      var nodeTypeTag = (node.type === 'component' || node.type === 'assembly')
        ? '<span style="margin-right:6px;font-size:11px;padding:1px 5px;border-radius:3px;background:#e6f4ff;color:#1677ff;border:1px solid #91caff">部件</span>'
        : '<span style="margin-right:6px;font-size:11px;padding:1px 5px;border-radius:3px;background:#f6ffed;color:#52c41a;border:1px solid #b7eb8f">零件</span>';
      var html = '<div class="br-node" style="padding-left:'+indent+'px">';
      var isComponent = (node.type === 'component' || node.type === 'assembly');
      var openDetail = 'onclick="Bom.openParentDetail(\'' + node.id + '\',' + (isComponent ? 'true' : 'false') + ')"';
      html += '<div class="br-row" style="display:flex;align-items:center;padding:6px 4px;border-radius:4px;margin-bottom:2px;background:'+(isRoot?'#f0f7ff':'#fafafa')+';border-left:3px solid '+(isRoot?'var(--primary)':'#ddd')+'">' +
        toggle + '<span style="margin:0 6px 0 4px">'+levelLabel+'</span>' + nodeTypeTag +
        '<span '+openDetail+' style="cursor:pointer;font-weight:'+(isRoot?'600':'400')+';margin-right:8px;color:'+ (isRoot ? 'var(--primary)' : 'var(--text)') +'" title="查看详情">'+(node.code||'-')+'</span>' +
        '<span '+openDetail+' style="cursor:pointer;margin-right:10px;color:var(--text-secondary)" title="查看详情">'+(node.name||'?')+'</span>' +
        (version ? '<span style="margin-right:8px;font-size:12px;color:var(--text-secondary)">' + version + '</span>' : '') +
        statusHtml + '</div>';
      if (hasChildren) {
        html += '<div class="br-children">';
        node.parents.forEach(function(p){ html += _renderTreeNode(p, false); });
        html += '</div>';
      }
      html += '</div>';
      return html;
    }

    // ===== 图文档反查功能 =====
    var docSearchInput = c.querySelector('#doc-search-input');
    var docSearchResults = c.querySelector('#doc-search-results');
    var docSearchResultArea = c.querySelector('#doc-search-result-area');
    var docSearchTimer = null;

    function performDocSearch() {
      var keyword = docSearchInput.value.trim().toLowerCase();
      if (!keyword) { docSearchResults.style.display = 'none'; docSearchResultArea.innerHTML = ''; return; }
      var docs = Store.getAll('documents') || [];
      var filtered = docs.filter(function(d) {
        return (d.code && d.code.toLowerCase().includes(keyword)) || (d.name && d.name.toLowerCase().includes(keyword));
      });
      if (filtered.length === 0) {
        docSearchResults.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-light);font-size:13px">未找到匹配的图文档</div>';
        docSearchResults.style.display = 'block'; docSearchResultArea.innerHTML = '';
        return;
      }
      var html = '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb"><th style="padding:8px 12px;text-align:left;color:var(--text-secondary);font-weight:500">编号</th><th style="padding:8px 12px;text-align:left;color:var(--text-secondary);font-weight:500">名称</th><th style="padding:8px 12px;text-align:center;color:var(--text-secondary);font-weight:500">版本</th><th style="padding:8px 12px;text-align:center;color:var(--text-secondary);font-weight:500">状态</th></tr></thead><tbody>';
      filtered.forEach(function(doc) {
        var ver = doc.version || '';
        var statusHtml = doc.status ? UI.statusTag(doc.status) : '<span style="color:#9ca3af;font-size:12px">-</span>';
        html += '<tr class="doc-search-row" data-id="'+doc.id+'" style="cursor:pointer">' +
          '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;font-weight:500">'+(doc.code||'-')+'</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;color:var(--text-secondary)">'+(doc.name||'-')+'</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:center;font-size:12px;color:var(--text-secondary)">'+(ver||'-')+'</td>' +
          '<td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;text-align:center">'+statusHtml+'</td></tr>';
      });
      html += '</tbody></table>';
      docSearchResults.innerHTML = html; docSearchResults.style.display = 'block'; docSearchResultArea.innerHTML = '';
      c.querySelectorAll('.doc-search-row').forEach(function(row) {
        row.onmouseover = function() { this.style.background = '#f0f7ff'; };
        row.onmouseout = function() { this.style.background = ''; };
        row.onclick = function() {
          var docId = this.getAttribute('data-id');
          docSearchResults.style.display = 'none';
          doDocReverse(docId);
        };
      });
    }

    docSearchInput.addEventListener('input', function() {
      clearTimeout(docSearchTimer);
      docSearchTimer = setTimeout(performDocSearch, 300);
    });
    docSearchResults.style.display = 'none';

    function doDocReverse(docId) {
      var doc = Store.getById('documents', docId);
      if (!doc) { docSearchResultArea.innerHTML = '<div class="card"><div class="card-body" style="text-align:center;padding:40px;color:var(--text-light)">图文档不存在</div></div>'; return; }

      // 调用后端 API 获取引用信息
      var token = localStorage.getItem('bom_api_token') || '';
      docSearchResultArea.innerHTML = '<div class="card"><div class="card-body" style="text-align:center;padding:40px;color:var(--text-light)">正在查询引用信息...</div></div>';

      fetch('/api/documents/' + docId + '/references', {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(function(r) { return r.json(); }).then(function(data) {
        var refs = data.references || [];
        var folders = data.dashboard_folders || [];

        var html = '<div class="stat-card" style="margin-bottom:20px;max-width:400px"><div class="stat-icon blue">📄</div><div class="stat-info"><div class="label">' + (doc.code || '-') + '</div><div class="value" style="font-size:16px">' + (doc.name || '-') + '</div></div></div>';

        // 零件/部件引用
        html += '<div class="card" style="margin-bottom:20px"><div class="card-header">📎 被零件/部件引用 (' + refs.length + ')</div><div class="card-body">';
        if (refs.length === 0) {
          html += '<div style="text-align:center;padding:20px;color:var(--text-light)">未被任何零件或部件引用</div>';
        } else {
          html += '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f9fafb;border-bottom:1px solid #e5e7eb"><th style="padding:8px 12px;text-align:left">类型</th><th style="padding:8px 12px;text-align:left">编号</th><th style="padding:8px 12px;text-align:left">名称</th><th style="padding:8px 12px;text-align:center">版本</th><th style="padding:8px 12px;text-align:center">状态</th></tr></thead><tbody>';
          refs.forEach(function(ref) {
            var typeTag = ref.entity_type === 'part'
              ? '<span style="font-size:12px;padding:1px 6px;border-radius:3px;background:#f6ffed;color:#52c41a;border:1px solid #b7eb8f">零件</span>'
              : '<span style="font-size:12px;padding:1px 6px;border-radius:3px;background:#e6f4ff;color:#1677ff;border:1px solid #91caff">部件</span>';
            var clickHandler = ref.entity_type === 'part'
              ? 'onclick="Parts._viewPart(\'' + ref.entity_id + '\')"'
              : 'onclick="Components._viewComp(\'' + ref.entity_id + '\')"';
            var ver = ref.version || '';
            var statusHtml = ref.status ? UI.statusTag(ref.status) : '<span style="color:#9ca3af;font-size:12px">-</span>';
            html += '<tr style="cursor:pointer" ' + clickHandler + '>' +
              '<td style="padding:8px 12px;border-bottom:1px solid #f3f4f6">' + typeTag + '</td>' +
              '<td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-weight:500">' + (ref.entity_code || '-') + '</td>' +
              '<td style="padding:8px 12px;border-bottom:1px solid #f3f4f6">' + (ref.entity_name || '-') + '</td>' +
              '<td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:center;font-size:12px;color:var(--text-secondary)">' + (ver || '-') + '</td>' +
              '<td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:center">' + statusHtml + '</td></tr>';
          });
          html += '</tbody></table>';
        }
        html += '</div></div>';

        // 用户看板文件夹引用
        html += '<div class="card"><div class="card-header">📁 被用户看板引用 (' + folders.length + ')</div><div class="card-body">';
        if (folders.length === 0) {
          html += '<div style="text-align:center;padding:20px;color:var(--text-light)">未被任何用户看板引用</div>';
        } else {
          html += '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f9fafb;border-bottom:1px solid #e5e7eb"><th style="padding:8px 12px;text-align:left">用户</th><th style="padding:8px 12px;text-align:left">文件夹路径</th></tr></thead><tbody>';
          folders.forEach(function(f) {
            html += '<tr>' +
              '<td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-weight:500">' + (f.user_name || '-') + '</td>' +
              '<td style="padding:8px 12px;border-bottom:1px solid #f3f4f6">' + (f.folder_path || '-') + '</td></tr>';
          });
          html += '</tbody></table>';
        }
        html += '</div></div>';

        docSearchResultArea.innerHTML = html;
      }).catch(function(e) {
        docSearchResultArea.innerHTML = '<div class="card"><div class="card-body" style="text-align:center;padding:40px;color:var(--danger)">查询失败: ' + e.message + '</div></div>';
      });
    }
  },

  // 点击反查树中的父项节点打开详情
  openParentDetail: function(id, isComponent) {
    console.log('Bom.openParentDetail called', id, isComponent);
    if (!id) {
        console.error("节点ID不存在");
        return;
    }
    // 先关闭可能存在的弹窗
    if (window.UI && window.UI.closeModal) { 
        window.UI.closeModal(); 
    }
    // 延时调用，确保模态框关闭动画不影响新弹窗
    setTimeout(function() {
      try {
        if (isComponent) {
          if (window.Components && window.Components._viewComp) {
            window.Components._viewComp(id);
          } else {
            console.error("Components对象或_viewComp方法未找到，请确保pages-components.js已加载");
          }
        } else {
          if (window.Parts && window.Parts._viewPart) {
            window.Parts._viewPart(id);
          } else {
            console.error("Parts对象或_viewPart方法未找到，请确保pages-parts.js已加载");
          }
        }
      } catch(e) {
        console.error('打开详情失败:', e);
      }
    }, 100);
  }

};
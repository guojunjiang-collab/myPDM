var Documents = {
  render: function(c) {
    // UI: 与 Parts 页风格对齐
    c.innerHTML = '<div class="page-header"><h2>📄 图文档管理</h2><div class="actions"><button class="btn-primary" id="btn-create-doc">+ 新建图文文档</button></div></div>' +
      '<div class="card"><div class="toolbar">' +
        '<div class="search-box" style="flex:1"><input type="text" id="doc-search" class="form-input" placeholder="搜索编号或名称..." style="width:100%"></div>' +
        '<select id="doc-status-filter" class="form-select" style="width:140px">' +
          '<option value="">全部状态</option>' +
          '<option value="draft">草稿</option>' +
          '<option value="frozen">冻结</option>' +
          '<option value="released">发布</option>' +
          '<option value="obsolete">作废</option>' +
        '</select>' +
        '<button class="btn-outline" id="btn-toggle-filter" style="margin-left:4px;font-size:12px;padding:6px 12px">🔽 筛选</button>' +
      '</div>' +
      '<div id="doc-filter-panel" style="display:none;padding:12px 16px;border-bottom:1px solid #f0f0f0;background:#fafafa;display:none"></div>' +
      '<div class="table-wrapper" id="docs-table-area"></div></div>';

    var docs = Store.getAll('documents') || [];
    var docCfDefs = null; // 缓存自定义字段定义
    var _sort = { field: null, dir: 'asc' }; // 排序状态
    renderList();

    function renderList(list) {
      if (!list && list !== false) list = docs;
      var container = document.getElementById('docs-table-area');
      if (!container) return;
      var kw = (document.getElementById('doc-search').value || '').trim().toLowerCase();
      var statusF = document.getElementById('doc-status-filter').value;
      var filtered = list.filter(function(d) {
        if (statusF && d.status !== statusF) return false;
        if (kw) {
          var code = (d.code || '').toLowerCase();
          var name = (d.name || '').toLowerCase();
          if (code.indexOf(kw) === -1 && name.indexOf(kw) === -1) return false;
        }
        // 版本筛选
        var verF = document.getElementById('doc-filter-version');
        if (verF && verF.value) {
          var verKw = verF.value.toLowerCase();
          if ((d.version || '').toLowerCase().indexOf(verKw) < 0) return false;
        }
        // 自定义字段筛选
        if (docCfDefs) {
          for (var ci = 0; ci < docCfDefs.length; ci++) {
            var cf = docCfDefs[ci];
            var el = document.getElementById('doc-cf-filter-' + cf.field_key);
            if (!el) continue;
            var fv = el.value;
            if (!fv) continue;
            fv = fv.toLowerCase();
            var dv = d.customFields ? d.customFields[cf.field_key] : null;
            if (dv === undefined || dv === null || dv === '') return false;
            // 多选字段：任一匹配
            if (cf.field_type === 'multiselect' && Array.isArray(dv)) {
              if (!dv.some(function(v) { return v.toLowerCase().indexOf(fv) >= 0; })) return false;
            } else {
              if (String(dv).toLowerCase().indexOf(fv) < 0) return false;
            }
          }
        }
        return true;
      });

      // 排序
      if (_sort.field) {
        filtered.sort(function(a, b) {
          var av = (a[_sort.field] || '').toString().toLowerCase();
          var bv = (b[_sort.field] || '').toString().toLowerCase();
          if (av < bv) return _sort.dir === 'asc' ? -1 : 1;
          if (av > bv) return _sort.dir === 'asc' ? 1 : -1;
          return 0;
        });
      }

      if (filtered.length === 0) {
        container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-light)">暂无匹配的图文档</div>';
        return;
      }

      // 加载自定义字段定义并渲染表格
      var cfDefsPromise = docCfDefs ? Promise.resolve(docCfDefs) : _loadDocCFDefs();
      cfDefsPromise.then(function(cfDefs) {
        docCfDefs = cfDefs || [];
        // 如果有自定义字段定义，批量获取所有文档的自定义字段值
        if (docCfDefs.length > 0 && filtered.length > 0) {
          var cfValuePromises = filtered.map(function(d) {
            return API.getCustomFieldValues('document', d.id).then(function(list) {
              var cfMap = {};
              (list || []).forEach(function(v) { if (v.field_key) cfMap[v.field_key] = v.value; });
              d.customFields = cfMap;
              return d;
            }).catch(function() {
              d.customFields = {};
              return d;
            });
          });
          Promise.all(cfValuePromises).then(function() {
            _renderTableWithCF(filtered, docCfDefs);
          });
        } else {
          _renderTableWithCF(filtered, docCfDefs);
        }
      });
    }

    function _renderTableWithCF(filtered, cfDefs) {
      var container = document.getElementById('docs-table-area');
      if (!container) return;

      // 构建表头 - 与零件管理界面保持一致
      var html = '<table id="documents-table"><thead><tr>' +
        '<th data-sort="code" class="th-sortable">图文档编号<span class="th-sort-icon"></span></th>' +
        '<th data-sort="name" class="th-sortable">图文档名称<span class="th-sort-icon"></span></th>' +
        '<th data-sort="version" class="th-sortable">版本<span class="th-sort-icon"></span></th>' +
        '<th data-sort="status" class="th-sortable">状态<span class="th-sort-icon"></span></th>';

      // 添加自定义字段列头
      (cfDefs || []).forEach(function(cf) {
        html += '<th>' + _esc(cf.name) + '</th>';
      });

      html += '<th>主附件</th>' +
        '<th style="text-align:right">操作</th>' +
        '</tr></thead><tbody>';

      // 构建表格行
      filtered.forEach(function(d) {
        html += '<tr style="border-bottom:1px solid #f0f0f0;cursor:pointer" data-id="' + d.id + '">' +
          '<td style="padding:10px 12px;font-weight:500;white-space:nowrap">' + _esc(d.code) + '</td>' +
          '<td style="padding:10px 12px">' + _esc(d.name) + '</td>' +
          '<td style="padding:10px 12px"><span class="tag" style="background:#e6f7ff;color:#1890ff">' + _esc(d.version) + '</span></td>' +
          '<td style="padding:10px 12px">' + UI.statusTag(d.status || 'draft') + '</td>';

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
          html += '<td style="padding:10px 12px;font-size:13px">' + displayVal + '</td>';
        });

        html += '<td style="padding:10px 12px;font-size:13px;color:#666">' + (d.file_name ? _esc(d.file_name) : '<span style="color:#ccc">—</span>') + '</td>' +
          '<td style="padding:10px 12px;text-align:right;white-space:nowrap">' +
            (d.file_id ? '<button class="btn-text btn-sm btn-preview-doc" data-file-id="' + d.file_id + '" data-file-name="' + _esc(d.file_name || '') + '">预览</button>' : '') +
            '<button class="btn-text btn-sm btn-download-doc" data-id="' + d.id + '">下载</button>' +
            '<button class="btn-text btn-sm btn-edit-doc" data-id="' + d.id + '">编辑</button>' +
            '<button class="btn-text btn-sm btn-delete-doc" data-id="' + d.id + '" style="color:#ff4d4f">删除</button>' +
          '</td></tr>';
      });

      html += '</tbody></table>';
      container.innerHTML = html;

      // 排序角标 & 点击事件
      document.querySelectorAll('#documents-table th[data-sort]').forEach(function(th) {
        var f = th.getAttribute('data-sort');
        var ic = th.querySelector('.th-sort-icon');
        th.classList.remove('sorted');
        ic.className = 'th-sort-icon';
        if (_sort.field === f) {
          th.classList.add('sorted');
          ic.classList.add(_sort.dir);
        }
        th.onclick = function() {
          if (_sort.field === f) {
            _sort.dir = _sort.dir === 'asc' ? 'desc' : 'asc';
          } else {
            _sort.field = f;
            _sort.dir = 'asc';
          }
          renderList();
        };
      });

      container.querySelectorAll('tr[data-id]').forEach(function(tr) {
        tr.onclick = function() { Documents._viewDoc(tr.dataset.id, docs); };
      });

      container.querySelectorAll('.btn-preview-doc').forEach(function(btn) {
        btn.onclick = function(e) { e.stopPropagation(); Documents._previewDoc(btn.dataset.fileId, btn.dataset.fileName); };
      });
      container.querySelectorAll('.btn-download-doc').forEach(function(btn) {
        btn.onclick = function(e) { e.stopPropagation(); Documents._downloadDoc(btn.dataset.id); };
      });
      container.querySelectorAll('.btn-edit-doc').forEach(function(btn) {
        btn.onclick = function(e) { e.stopPropagation(); Documents._editDoc(btn.dataset.id); };
      });
      container.querySelectorAll('.btn-delete-doc').forEach(function(btn) {
        btn.onclick = function(e) { e.stopPropagation(); Documents._deleteDoc(btn.dataset.id); };
      });
    }

    document.getElementById('btn-create-doc').onclick = function() { Documents._editDoc(null); };
    document.getElementById('doc-search').oninput = function() { renderList(); };
    document.getElementById('doc-status-filter').onchange = function() { renderList(); };

    // 筛选面板
    var filterOpen = false;
    document.getElementById('btn-toggle-filter').onclick = function() {
      filterOpen = !filterOpen;
      var panel = document.getElementById('doc-filter-panel');
      var btn = document.getElementById('btn-toggle-filter');
      if (filterOpen) {
        btn.textContent = '🔼 收起筛选';
        _buildFilterPanel();
        panel.style.display = 'block';
      } else {
        btn.textContent = '🔽 筛选';
        panel.style.display = 'none';
      }
    };

    function _buildFilterPanel() {
      var panel = document.getElementById('doc-filter-panel');
      var promise = docCfDefs ? Promise.resolve(docCfDefs) : _loadDocCFDefs();
      promise.then(function(cfDefs) {
        docCfDefs = cfDefs || [];
        var html = '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">';
        // 原有字段：版本
        html += '<div style="min-width:180px"><label style="font-size:13px;color:#888;margin-bottom:4px;display:block">版本</label><input type="text" id="doc-filter-version" class="form-input" placeholder="全部"></div>';
        // 自定义字段
        (docCfDefs || []).forEach(function(cf) {
          var label = cf.name;
          html += '<div style="min-width:180px"><label style="font-size:13px;color:#888;margin-bottom:4px;display:block">' + _esc(label) + '</label><input type="text" id="doc-cf-filter-' + cf.field_key + '" class="form-input" placeholder="全部"></div>';
        });
        html += '<div style="display:flex;gap:8px;align-self:flex-end"><button class="btn-primary" id="btn-apply-filter">筛选</button>';
        html += '<button class="btn-outline" id="btn-clear-filter">清除</button></div>';
        html += '</div>';
        panel.innerHTML = html;

        // 绑定事件
        document.getElementById('btn-apply-filter').onclick = function() { renderList(); };
        document.getElementById('btn-clear-filter').onclick = function() {
          panel.querySelectorAll('input[type="text"]').forEach(function(el) { el.value = ''; });
          document.getElementById('doc-status-filter').value = '';
          document.getElementById('doc-search').value = '';
          renderList();
        };
      });
    }
  },

  _viewDoc: function(id, docs) {
    // 如果没有传入 docs 数组，从 Store 获取
    if (!docs) {
      docs = Store.getAll('documents') || [];
    }
    var doc = docs.find(function(d) { return d.id === id; });
    if (!doc) return;

    var html = '<div class="form-row"><div class="form-group"><label>图文档编号</label><div style="padding:6px 10px;border:1px solid #e8e8e8;border-radius:4px;background:#fafafa;font-weight:500">' + _esc(doc.code) + '</div></div><div class="form-group"><label>图文档名称</label><div style="padding:6px 10px;border:1px solid #e8e8e8;border-radius:4px;background:#fafafa">' + _esc(doc.name) + '</div></div></div>' +
      '<div class="form-row"><div class="form-group"><label>版本</label><div style="padding:6px 10px;border:1px solid #e8e8e8;border-radius:4px;background:#fafafa">' + _esc(doc.version) + '</div></div><div class="form-group"><label>状态</label><div style="padding:6px 10px;border:1px solid #e8e8e8;border-radius:4px;background:#fafafa">' + UI.statusTag(doc.status || 'draft') + '</div></div></div>' +
      '<div class="form-row"><div class="form-group" style="flex:1"><label>描述</label><div style="padding:6px 10px;border:1px solid #e8e8e8;border-radius:4px;background:#fafafa">' + (doc.description ? _esc(doc.description) : '<span style="color:#ccc">—</span>') + '</div></div><div class="form-group" style="flex:1"><label>主附件</label><div style="padding:6px 10px;border:1px solid #e8e8e8;border-radius:4px;background:#fafafa">' + (doc.file_name ? _esc(doc.file_name) : '<span style="color:#ccc">未上传</span>') + '</div></div></div>' +
      '<div id="doc-cf-view-area"></div>';

    UI.modal('图文档详情', html, {
      footer: (doc && doc.file_id ? '<button class="btn-primary" onclick="Documents._previewDoc(\'' + doc.file_id + '\', \'' + _esc(doc.file_name || '') + '\')">预览</button>' : '') + '<button class="btn-outline" onclick="UI.closeModal()">关闭</button>',
      afterRender: function() {
        // 添加返回按钮（如果是从零件/部件详情进入）
        if (window._docDetailReturnTo) {
          var footer = document.querySelector('#modal-box .modal-footer');
          if (footer) {
            var backBtn = document.createElement('button');
            backBtn.className = 'btn-outline';
            backBtn.innerHTML = '← 返回' + (window._docDetailReturnTo.type === 'part' ? '零件' : '部件') + '详情';
            backBtn.style.marginRight = 'auto';
            backBtn.onclick = function() {
              var returnTo = window._docDetailReturnTo;
              window._docDetailReturnTo = null;
              UI.closeModal();
              setTimeout(function() {
                if (returnTo.type === 'part') {
                  Parts._viewPart(returnTo.id);
                } else {
                  Components._viewComp(returnTo.id);
                }
              }, 100);
            };
            footer.insertBefore(backBtn, footer.firstChild);
          }
        }
        
        _loadDocCFDefs().then(function(cfDefs) {
          // 从服务器获取该文档的自定义字段值，避免本地缓存为空
          if (doc && doc.id) {
            API.getCustomFieldValues('document', doc.id).then(function(list) {
              var cfMap = {};
              (list || []).forEach(function(v) { if (v.field_key) cfMap[v.field_key] = v.value; });
              doc.customFields = cfMap;
              var cfArea = document.getElementById('doc-cf-view-area');
              if (cfArea) cfArea.innerHTML = _renderCFViewHtml(cfMap, cfDefs, 'document');
            }).catch(function() {
              // 如果服务器获取失败，回退到本地值
              var cfArea = document.getElementById('doc-cf-view-area');
              if (cfArea) cfArea.innerHTML = _renderCFViewHtml(doc.customFields || {}, cfDefs, 'document');
            });
          } else {
            var cfArea = document.getElementById('doc-cf-view-area');
            if (cfArea) cfArea.innerHTML = _renderCFViewHtml(doc.customFields || {}, cfDefs, 'document');
          }
        });
      }
    });
  },

  _editDoc: function(id) {
    var isNew = !id;
    var doc = isNew ? null : (Store.getById('documents', id) || null);

    if (isNew) {
      // 新建：直接加载自定义字段定义并渲染
      _loadDocCFDefs().then(function(cfDefs) {
        _renderForm(null, cfDefs);
      });
      return;
    }

    // 编辑：先获取文档数据，再获取自定义字段值，然后渲染
    var docPromise = doc ? Promise.resolve(doc) : API._fetch('GET', '/documents/' + id);
    
    Promise.all([docPromise, _loadDocCFDefs()]).then(function(results) {
      var docData = results[0];
      var cfDefs = results[1];
      
      // 从服务器获取已保存的自定义字段值
      API.getCustomFieldValues('document', id).then(function(list) {
        var cfMap = {};
        (list || []).forEach(function(v) { if (v.field_key) cfMap[v.field_key] = v.value; });
        docData.customFields = cfMap;
        _renderForm(docData, cfDefs);
      }).catch(function() {
        // 如果获取失败，使用空值
        _renderForm(docData, cfDefs);
      });
    }).catch(function() { UI.toast('图文档不存在', 'error'); });

    function _renderForm(doc, cfDefs) {
      cfDefs = cfDefs || [];
      var cfValues = doc ? (doc.customFields || {}) : {};
      var cfHtml = _renderCFEditHtmlDoc(cfValues, cfDefs);

      UI.modal(isNew ? '新建图文文档' : '编辑图文文档',
        // form body
        '<div class="form-group"><label>编号 <span class="required">*</span></label><input type="text" id="doc-code" value="' + (doc ? _esc(doc.code) : '') + '" placeholder="如：DOC-00001"' + (doc ? ' readonly' : '') + '></div>' +
        '<div class="form-row"><div class="form-group"><label>名称 <span class="required">*</span></label><input type="text" id="doc-name" value="' + (doc ? _esc(doc.name) : '') + '" placeholder="如：传动轴图纸"></div>' +
        '<div class="form-group"><label>版本</label><input type="text" id="doc-version" value="' + (doc ? _esc(doc.version) : 'A') + '" placeholder="A"></div></div>' +
        '<div class="form-group"><label>状态</label><select id="doc-status"><option value="draft" ' + (doc && doc.status === 'draft' ? 'selected' : '') + '>草稿</option><option value="frozen"' + (doc && doc.status === 'frozen' ? ' selected' : '') + '>冻结</option><option value="released"' + (doc && doc.status === 'released' ? ' selected' : '') + '>发布</option><option value="obsolete"' + (doc && doc.status === 'obsolete' ? ' selected' : '') + '>作废</option></select></div>' +
        '<div class="form-group"><label>描述</label><textarea id="doc-description" rows="3" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px">' + (doc ? _esc(doc.description || '') : '') + '</textarea></div>' +
        '<div id="doc-cf-edit-area">' + cfHtml + '</div>' +
        '<div id="doc-att-area"></div>',
        { footer: '<button class="btn-outline" onclick="UI.closeModal()">取消</button>' +
          (doc && doc.status === 'released' ? '<button class="btn-outline" id="btn-upgrade-doc" style="margin-left:8px">升版</button>' : '') +
          '<button class="btn-primary" id="btn-save-doc">保存</button>' +
          (!isNew ? '<button class="btn-outline" style="margin-left:8px" id="btn-upload-doc-att">上传/替换附件</button>' : ''),
          afterRender: function() {
            if (!isNew) Documents._loadDocAttArea(doc.id, doc);

            // 升版按钮事件
            if (doc && doc.status === 'released' && document.getElementById('btn-upgrade-doc')) {
              document.getElementById('btn-upgrade-doc').onclick = function() {
                Documents._upgradeDoc(doc.id);
              };
            }

            document.getElementById('btn-save-doc').onclick = async function() {
              var code = document.getElementById('doc-code').value.trim();
              var name = document.getElementById('doc-name').value.trim();
              var version = document.getElementById('doc-version').value.trim();
              var status = document.getElementById('doc-status').value;
              var desc = document.getElementById('doc-description').value.trim();
              if (!code || !name) { UI.toast('编号和名称为必填', 'warning'); return; }

              var data = { name: name, version: version, status: status, description: desc || null };
              try {
                var result;
                if (isNew) {
                  data.id = _uuid();
                  data.code = code;
                  result = await API._fetch('POST', '/documents/', data);
                  UI.toast('图文档创建成功', 'success');
                } else {
                  result = await API._fetch('PUT', '/documents/' + id, data);
                  UI.toast('图文档更新成功', 'success');
                }
                // 保存自定义字段
                var cfVals = _collectCFValuesDoc(cfDefs);
                var cfDefsForSave = cfDefs;
                if (Object.keys(cfVals).length > 0 && result.id) {
                  _saveCFValues('document', result.id, cfVals, cfDefsForSave);
                }
                var all = Store.getAll('documents') || [];
                if (isNew) all.push(result); else { var idx = all.findIndex(function(d) { return d.id === id; }); if (idx >= 0) all[idx] = result; }
                Store.saveAll('documents', all);
                UI.closeModal();
                Documents.render(document.getElementById('content'));
              } catch (e) { UI.toast('操作失败: ' + (e.message || '未知错误'), 'error'); }
            };

            if (!isNew && document.getElementById('btn-upload-doc-att')) {
              document.getElementById('btn-upload-doc-att').onclick = function() {
                var input = document.createElement('input');
                input.type = 'file';
                input.onchange = function() {
                  var f = input.files[0];
                  if (!f) return;
                  
                  UI.toast('正在上传...', 'info');
                  
                  // 使用新的文件上传 API
                  uploadFile(f, 'document', id, {
                    onProgress: function(progress) {
                      UI.toast('上传进度: ' + progress.progress.toFixed(1) + '%', 'info');
                    },
                    onComplete: function(result) {
                      UI.toast('附件上传成功', 'success');
                      var all = Store.getAll('documents') || [];
                      var docObj = all.find(function(d) { return d.id === id; });
                      if (docObj) { 
                        docObj.file_name = result.file_name; 
                        docObj.file_id = result.id; 
                        Store.saveAll('documents', all); 
                      }
                      Documents._loadDocAttArea(id, docObj);
                    },
                    onError: function(error) {
                      UI.toast('上传失败: ' + error.message, 'error');
                    }
                  }).catch(function(e) { 
                    UI.toast('上传失败: ' + e.message, 'error'); 
                  });
                };
                input.click();
              };
            }
          }
        });
    }
  },
  
  _loadDocAttArea: function(docId, doc) {
    var area = document.getElementById('doc-att-area');
    if (!area) return;
    area.innerHTML = '<h4 style="margin:16px 0 12px;border-top:1px solid #f0f0f0;padding-top:16px">📎 主附件</h4>' +
      '<div style="display:flex;align-items:center;margin-bottom:8px;font-size:13px">' +
        '<span style="flex:1">' + (doc && doc.file_name ? _esc(doc.file_name) : '<span style="color:#999">未上传</span>') + '</span>' +
        (doc && doc.file_id ? '<button class="btn-link" id="btn-download-doc-att">下载</button><button class="btn-link" style="color:#ff4d4f;margin-left:8px" id="btn-delete-doc-att">删除</button>' : '') +
      '</div>';

    var dlBtn = document.getElementById('btn-download-doc-att');
    if (dlBtn) dlBtn.onclick = function() {
      downloadFile(doc.file_id, doc.file_name).catch(function(e) {
        UI.toast('下载失败: ' + e.message, 'error');
      });
    };

    var delBtn = document.getElementById('btn-delete-doc-att');
    if (delBtn) delBtn.onclick = function() {
      if (!confirm('确定要删除此附件吗？')) return;
      
      // 使用新的删除 API
      fetch('/api/v2/attachments/' + doc.file_id, { method: 'DELETE' })
        .then(function(r) { return r.json(); })
        .then(function(r) {
          UI.toast('附件已删除', 'success');
          var all = Store.getAll('documents') || [];
          var docObj = all.find(function(d) { return d.id === docId; });
          if (docObj) { docObj.file_name = null; docObj.file_id = null; Store.saveAll('documents', all); }
          Documents._loadDocAttArea(docId, docObj);
        })
        .catch(function(e) { UI.toast('删除失败: ' + e.message, 'error'); });
    };
  },
  
  _upgradeDoc: function(id) {
    var localDocs = Store.getAll('documents') || [];
    var doc = localDocs.find(function(d) { return d.id === id; });
    if (!doc) return;
    
    // 只能对 released 状态的图文档进行升版
    if (doc.status !== 'released') {
      UI.alert('只有"发布"状态的图文档可以升版');
      return;
    }
    
    // 检查是否是最新版本：查找同编码的其他图文档
    var allDocs = localDocs.filter(function(d) { return d.code === doc.code; });
    var maxV = allDocs.reduce(function(max, d) {
      var v = d.version || 'A';
      var cv = v.charCodeAt(0);
      return cv > max ? cv : max;
    }, 0);
    
    if ((doc.version || 'A').charCodeAt(0) < maxV) {
      UI.alert('该图文档存在更新版本，不能重复升版');
      return;
    }
    
    // 计算新版本号：A->B->C->D...
    var v = doc.version || 'A';
    var newV = String.fromCharCode(v.charCodeAt(0) + 1);
    if (newV > 'Z') {
      UI.toast('版本号已超过Z，不再支持升版', 'error');
      return;
    }
    
    // 创建新图文档
    var newDoc = {
      id: _uuid(),
      code: doc.code,
      name: doc.name,
      version: newV,
      status: 'draft',
      description: '',
    };
    
    // 保存到后端
    API._fetch('POST', '/documents/', newDoc).then(function(result) {
      // 保存到本地存储
      var all = Store.getAll('documents') || [];
      all.push(result);
      Store.saveAll('documents', all);
      
      UI.closeModal();
      UI.toast('升版成功，新版本: ' + newV, 'success');
      Documents.render(document.getElementById('content'));
    }).catch(function(e) {
      UI.toast('升版失败: ' + (e.message || '未知错误'), 'error');
    });
  },

  _downloadDoc: function(id) {
    var localDocs = Store.getAll('documents') || [];
    var doc = localDocs.find(function(d) { return d.id === id; });
    if (!doc) return;
    
    // 检查是否有附件
    if (!doc.file_id) {
      UI.alert('该图文档没有附件');
      return;
    }
    
    // 下载附件
    var token = localStorage.getItem('bom_api_token') || '';
    UI.toast('正在下载 ' + (doc.file_name || '附件') + '...', 'info');
    
    fetch('/api/v2/attachments/' + doc.file_id + '/stream', {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(function(response) {
      if (!response.ok) {
        return response.json().then(function(err) {
          throw new Error(err.detail || '下载失败 (' + response.status + ')');
        }).catch(function() {
          throw new Error('下载失败 (' + response.status + ')');
        });
      }
      return response.blob();
    }).then(function(blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = doc.file_name || 'attachment';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      UI.toast('下载完成', 'success');
    }).catch(function(e) {
      UI.toast('下载失败: ' + e.message, 'error');
    });
  },

  _deleteDoc: function(id) {
    var localDocs = Store.getAll('documents') || [];
    var doc = localDocs.find(function(d) { return d.id === id; });
    if (!doc) return;
    
    // 先调用后端 API 检查图文档是否被零部件关联
    API._fetch('GET', '/documents/' + id + '/references').then(function(refInfo) {
      // 如果被关联，直接弹出 UI.alert 对话框
      if (refInfo.reference_count > 0) {
        UI.alert('该图文档被引用，不能被删除');
        return;
      }
      
      // 如果没有被关联，弹出确认对话框
      UI.confirm('确定要删除图文档 <strong>' + _esc(doc.code) + ' - ' + _esc(doc.name) + '</strong> 吗？', async function() {
        try {
          await API._fetch('DELETE', '/documents/' + id);
          var all = (Store.getAll('documents') || []).filter(function(d) { return d.id !== id; });
          Store.saveAll('documents', all);
          UI.toast('图文档已删除', 'success');
          Documents.render(document.getElementById('content'));
        } catch (e) {
          UI.toast('删除失败: ' + (e.message || '未知错误'), 'error');
        }
      });
    }).catch(function(e) {
      // 如果检查引用失败，仍然弹出确认对话框
      UI.confirm('确定要删除图文档 <strong>' + _esc(doc.code) + ' - ' + _esc(doc.name) + '</strong> 吗？', async function() {
        try {
          await API._fetch('DELETE', '/documents/' + id);
          var all = (Store.getAll('documents') || []).filter(function(d) { return d.id !== id; });
          Store.saveAll('documents', all);
          UI.toast('图文档已删除', 'success');
          Documents.render(document.getElementById('content'));
        } catch (e) {
          UI.toast('删除失败: ' + (e.message || '未知错误'), 'error');
        }
      });
    });
  },

  _previewDoc: function(fileId, fileName) {
    if (!fileId) {
      UI.toast('该图文档没有附件', 'warning');
      return;
    }
    var ext = (fileName || '').split('.').pop().toLowerCase();
    if (ext !== 'stp' && ext !== 'step' && ext !== 'pdf') {
      UI.toast('该文件格式暂不支持在线预览', 'warning');
      return;
    }

    var token = localStorage.getItem('bom_api_token') || '';
    
    if (ext === 'pdf') {
      // PDF 直接用浏览器原生阅读器流式加载
      var previewUrl = '/api/v2/attachments/' + fileId + '/preview?token=' + encodeURIComponent(token);
      window.open(previewUrl, '_blank');
    } else {
      // STP 使用自定义预览页面
      var previewUrl = window.location.origin + '/preview.html?att_id=' + fileId + '&token=' + encodeURIComponent(token) + '&type=' + ext;
      window.open(previewUrl, '_blank');
    }
  }
};

// ===== 图文档自定义字段工具函数 =====

function _loadDocCFDefs() {
  return API.getCustomFieldDefinitions('document').then(function(defs) {
    return defs || [];
  }).catch(function() { return []; });
}

function _renderCFEditHtmlDoc(cfValues, cfDefs) {
  if (!cfDefs || cfDefs.length === 0) return '';
  var html = '<h4 style="margin:16px 0 12px;border-top:1px solid #f0f0f0;padding-top:16px">🏷️ 自定义属性</h4><div class="form-row" style="flex-wrap:wrap">';
  cfDefs.forEach(function(d) {
    var val = cfValues ? cfValues[d.field_key] : '';
    var reqMark = d.is_required ? ' <span class="required">*</span>' : '';
    html += '<div class="form-group" style="min-width:200px;flex:1"><label>' + _esc(d.name) + reqMark + '</label>';
    if (d.field_type === 'text') {
      html += '<input type="text" id="doc-cf-' + d.field_key + '" value="' + _esc(String(val || '')) + '">';
    } else if (d.field_type === 'number') {
      html += '<input type="number" id="doc-cf-' + d.field_key + '" value="' + _esc(String(val || '')) + '">';
    } else if (d.field_type === 'select') {
      html += '<select id="doc-cf-' + d.field_key + '"><option value="">— 请选择 —</option>';
      (d.options || []).forEach(function(opt) {
        html += '<option value="' + _esc(opt) + '"' + (val === opt ? ' selected' : '') + '>' + _esc(opt) + '</option>';
      });
      html += '</select>';
    } else if (d.field_type === 'multiselect') {
      var selectedVals = Array.isArray(val) ? val : [];
      html += '<div id="doc-' + d.field_key + '" style="display:flex;flex-wrap:wrap;gap:6px">';
      (d.options || []).forEach(function(opt) {
        var checked = selectedVals.indexOf(opt) >= 0 ? ' checked' : '';
        html += '<label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer"><input type="checkbox" name="doc-cf-' + d.field_key + '" value="' + _esc(opt) + '"' + checked + '>' + _esc(opt) + '</label>';
      });
      html += '</div>';
    }
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function _collectCFValuesDoc(cfDefs) {
  if (!cfDefs || cfDefs.length === 0) return {};
  var values = {};
  cfDefs.forEach(function(d) {
    var el = document.getElementById('doc-cf-' + d.field_key);
    if (!el) return;
    if (d.field_type === 'multiselect') {
      var checks = document.querySelectorAll('input[name="doc-cf-' + d.field_key + '"]:checked');
      values[d.field_key] = Array.from(checks).map(function(c) { return c.value; });
    } else if (d.field_type === 'number') {
      var numVal = el.value.trim();
      values[d.field_key] = numVal ? parseFloat(numVal) : null;
    } else {
      values[d.field_key] = el.value.trim() || null;
    }
  });
  return values;
}

function _saveCFValues(entityType, entityId, cfValues, cfDefs) {
  if (!cfDefs || cfDefs.length === 0 || !cfValues) return Promise.resolve();
  var values = [];
  cfDefs.forEach(function(d) {
    if (cfValues.hasOwnProperty(d.field_key)) {
      values.push({ field_id: d.id, value: cfValues[d.field_key] });
    }
  });
  if (values.length === 0) return Promise.resolve();
  console.log('[DEBUG] _saveCFValues:', entityType, 'ID:', entityId);
  return API.setCustomFieldValues(entityType, entityId, values).catch(function(e) {
    console.warn('自定义字段值保存失败:', e);
  });
}

// Render custom fields for documents (server-side values) - independent helper to align with parts UI
function _renderCFViewHtml(cfValues, cfDefs, appliesTo) {
  if (!cfDefs || cfDefs.length === 0) return '';
  var applicableDefs = cfDefs.filter(function(d) {
    return d.applies_to === appliesTo || (appliesTo !== 'document' && d.applies_to === 'both');
  });
  if (applicableDefs.length === 0) return '';

  var html = '<h4 style="margin:20px 0 12px">🏷️ 自定义属性</h4><div class="form-row" style="flex-wrap:wrap">';
  applicableDefs.forEach(function(d) {
    var val = cfValues ? cfValues[d.field_key] : null;
    var displayVal = '';
    if (val !== undefined && val !== null && val !== '') {
      if (d.field_type === 'multiselect' && Array.isArray(val)) {
        displayVal = val.map(function(v) { return '<span class="tag" style="background:#e6f7ff;color:#1890ff;margin:1px">' + _esc(String(v)) + '</span>'; }).join(' ');
      } else if (d.field_type === 'select') {
        displayVal = '<span class="tag" style="background:#f6ffed;color:#52c41a">' + _esc(String(val)) + '</span>';
      } else if (d.field_type === 'number') {
        displayVal = '<span style="font-weight:600;color:#1890ff">' + _esc(String(val)) + '</span>';
      } else {
        displayVal = _esc(String(val));
      }
    } else {
      displayVal = '<span style="color:#ccc">—</span>';
    }
    html += '<div class="form-group" style="min-width:200px;flex:1"><label>' + _esc(d.name) + (d.is_required ? ' <span class="required">*</span>' : '') + '</label><div style="padding:6px 10px;border:1px solid #e8e8e8;border-radius:4px;background:#fafafa">' + displayVal + '</div></div>';
  });
  html += '</div>';
  return html;
}

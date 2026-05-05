const SyncManager = {

  _task: null,

  _cancelled: false,

  _modal: null,

  _progressFill: null,

  _progressText: null,

  _progressPercent: null,

  _statusText: null,

  _resultsDiv: null,

  _cancelBtn: null,



  init: function() {

    this._modal = document.getElementById('sync-modal');

    this._progressFill = document.getElementById('sync-progress-fill');

    this._progressText = document.getElementById('sync-progress-text');

    this._progressPercent = document.getElementById('sync-progress-percent');

    this._statusText = document.getElementById('sync-status');

    this._resultsDiv = document.getElementById('sync-results');

    this._cancelBtn = document.getElementById('sync-cancel-btn');



    // 绑定关闭事件

    document.getElementById('sync-modal-close').onclick = () => this.close();

    this._cancelBtn.onclick = () => this.cancel();



    // 绑定同步按钮

    var pullBtn = document.getElementById('pull-btn');

    if (pullBtn) {

      pullBtn.onclick = () => this.start();

    }



    // 绑定清除缓存按钮

    var clearBtn = document.getElementById('clear-cache-btn');

    if (clearBtn) {

      clearBtn.onclick = function() {

        // 检查是否有正在进行的同步任务
        if (Store._syncRunning || (Store._syncQueue && Store._syncQueue.length > 0)) {
          UI.alert('⚠️ 当前有数据正在上传到服务器，请稍后再尝试清除缓存，避免数据上传失败。');
          return;
        }

        UI.confirm('⚠️ 将清除本地所有缓存数据（保留登录状态），清除后请点击「检出数据」重新拉取。确定继续吗？', function() {

          // 清除业务数据缓存，保留登录 token 和用户信息

          var keepKeys = ['bom_api_token', 'bom_current_user'];

          var toRemove = [];

          for (var i = 0; i < localStorage.length; i++) {

            var k = localStorage.key(i);

            if (k && k.indexOf('bom_') === 0 && keepKeys.indexOf(k) < 0) {

              toRemove.push(k);

            }

          }

          toRemove.forEach(function(k) { localStorage.removeItem(k); });
          // 同步完成本地缓存清理后，清除在内存中的相关缓存（图文档、自定义字段等）
          if (window.Store && typeof window.Store.clearLocalDocAndCFCache === 'function') {
            try { window.Store.clearLocalDocAndCFCache(); } catch (e) { /* ignore */ }
          }

          // 重置同步队列

          Store._syncQueue = [];

          Store._syncRunning = false;

          Store._syncStatus = 'idle';

          Store._syncErrorCount = 0;

          Store.addLog('清除缓存', '已清除本地缓存数据（' + toRemove.length + ' 项），请重新检出');

          UI.toast('本地缓存已清除，请点击「检出数据」重新拉取', 'success');

          Router.render();

        });

      };

    }

  },



  open: function() {

    this._modal.classList.add('active');

    this._resultsDiv.style.display = 'none';

    this._cancelBtn.disabled = false;

    this._cancelBtn.textContent = '取消';

    this._updateProgress(0, '准备同步...', '正在连接服务器...');

  },



  close: function() {

    if (this._task && this._task.status === 'syncing') {

      this.cancel();

    }

    this._modal.classList.remove('active');

  },



  _updateProgress: function(percent, text, status) {

    this._progressFill.style.width = percent + '%';

    this._progressPercent.textContent = percent + '%';

    if (text) this._progressText.textContent = text;

    if (status) this._statusText.innerHTML = status;

  },



  _updateResults: function(results) {

    var entities = ['parts', 'components', 'documents', 'users', 'custom_field_defs'];

    entities.forEach(function(entity) {

      var el = document.getElementById('result-' + entity);

      var r = results[entity];

      if (r && el) {

        var parts = [];

        if (r.total > 0) parts.push('↓' + r.success);

        if (r.failed > 0) parts.push('失败' + r.failed);

        var text = parts.length > 0 ? parts.join(' / ') : '-';

        el.textContent = text;

        var hasError = r.failed > 0;

        var hasSuccess = r.success > 0;

        el.className = 'result-value' + (hasError ? ' failed' : (hasSuccess ? ' success' : ''));

      }

    });

    this._resultsDiv.style.display = 'block';

  },



  cancel: function() {

    this._cancelled = true;

    this._task.status = 'cancelled';

    this._statusText.innerHTML = '<span style="color:var(--warning)">⏹ 已取消</span>';

    this._cancelBtn.disabled = true;

  },



  start: async function() {

    if (!API._token) {

      UI.toast('请先登录', 'warning');

      return;

    }



    this._cancelled = false;

    this._task = { status: 'preparing', progress: 0, results: {} };

    this.open();



    try {

      // 1. 获取概览

      this._updateProgress(5, '获取数据概览...', '正在查询服务器数据...');



      // 定义同步实体（含上传配置）

      var entities = [

        { key: 'parts', label: '零件', apiFn: 'getParts', uploadFn: 'createPart', updateFn: 'updatePart' },

        { key: 'components', label: '部件', apiFn: 'getAssemblies', uploadFn: 'createAssembly', updateFn: 'updateAssembly' },

        { key: 'documents', label: '图文档', apiFn: 'getDocuments', uploadFn: 'createDocument', updateFn: 'updateDocument' },

        { key: 'users', label: '用户', apiFn: 'getUsers', uploadFn: 'createUser', updateFn: 'updateUser' },

        { key: 'custom_field_defs', label: '自定义字段', apiFn: 'getCustomFieldDefinitions', uploadFn: null, updateFn: null }

      ];



      var totalCount = 0;

      var processedCount = 0;

      var results = { parts: { total: 0, success: 0, failed: 0 }, components: { total: 0, success: 0, failed: 0 }, documents: { total: 0, success: 0, failed: 0 }, users: { total: 0, success: 0, failed: 0 }, custom_field_defs: { total: 0, success: 0, failed: 0 } };



      this._task.status = 'syncing';



      // ===== 第一阶段：从服务器拉取数据 =====

      var _syncStartTime = Date.now();

      for (var i = 0; i < entities.length; i++) {

        if (this._cancelled) break;



        var entity = entities[i];

        this._updateProgress(

          Math.round((i / entities.length) * 25),

          '正在获取 ' + entity.label + '...',

          '正在拉取: <span class="current-entity">' + entity.label + '</span>'

        );



        try {

          var data = entity.apiArg ? await API[entity.apiFn](entity.apiArg) : await API[entity.apiFn]();

          if (!Array.isArray(data)) data = [];

          results[entity.key].total = data.length;

          totalCount += data.length;



          // 保存到本地（服务器数据优先）

          for (var j = 0; j < data.length; j++) {

            if (this._cancelled) break;



            var item = data[j];

            try {

              // API 字段名 → 本地字段名转换

              var fmap = Store._fieldMap[entity.key] || {};

              var reverseMap = {};

              for (var fk in fmap) { reverseMap[fmap[fk]] = fk; }

              var converted = {};

              for (var k in item) { converted[reverseMap[k] || k] = item[k]; }

              item = converted;



              // 确保有 id（如果服务器没返回，跳过这条）

              if (!item.id) { results[entity.key].failed++; continue; }



              // 检查本地是否已存在（先按ID，再按业务主键 code+version）

              var existing = Store.getById(entity.key, item.id);

              // 对于部件，如果ID不匹配，尝试用 code+version 匹配（跨设备同步场景）

              if (!existing && entity.key === 'components' && converted.code && converted.version) {

                var allLocal = Store.getAll('components');

                for (var li = 0; li < allLocal.length; li++) {

                  if (allLocal[li].code === converted.code && allLocal[li].version === converted.version) {

                    existing = allLocal[li];

                    // UUID 由前端生成后端直接使用，更新本地 ID 以匹配服务器

                    if (existing.id !== converted.id) {
                      existing.id = converted.id;
                    }

                    break;

                  }

                }

              }

              if (existing) {

                // 冲突解决：以 updatedAt 更晚者胜出（新数据覆盖旧数据）

var serverTime = converted.updatedAt || 0;

                var localTime  = existing.updatedAt  || 0;

                if (serverTime > localTime) {
                  // 服务器更新更晚 → 覆盖本地（同时更新ID为服务器ID）
                  console.log('[Pull] 覆盖本地', entity.key, 'id=' + existing.id, 'oldStatus=' + existing.status, '-> newStatus=' + converted.status);
                  if (converted.status === undefined) {
                    console.warn('[Pull WARNING] converted.status is undefined! raw server response:', item);
                  }
                  var updateData = Object.assign({}, converted, { id: converted.id });
                  Store.update(entity.key, existing.id, updateData, { silent: true, skipSync: true });
                } else {
                  // 本地更新更晚或同等新 → 保留本地，但对于图文档始终更新附件字段
                  var updateFields = { id: converted.id };
                  // 图文档：始终从服务器更新附件信息（file_id, file_name 只在服务器端设置）
                  if (entity.key === 'documents') {
                    if (converted.file_id) updateFields.file_id = converted.file_id;
                    if (converted.file_name) updateFields.file_name = converted.file_name;
                  }
                  Store.update(entity.key, existing.id, updateFields, { silent: true, skipSync: true });
                }

              } else {

                // 本地不存在 → 直接添加
                if (item.status === undefined) {
                  console.warn('[Pull WARNING] new item has undefined status! raw server response:', item);
                }
                Store.add(entity.key, item, { silent: true, skipSync: true });

              }

              results[entity.key].success++;

            } catch (err) {

              console.error('[Sync] Failed to save ' + entity.key + ':', err);

              results[entity.key].failed++;

            }



            processedCount++;

            var progress = Math.round(5 + (processedCount / Math.max(totalCount, 1)) * 25);

            this._updateProgress(

              Math.min(progress, 30),

              '正在保存 ' + entity.label + ' (' + (j + 1) + '/' + data.length + ')...',

              '正在拉取: <span class="current-entity">' + entity.label + '</span> (' + (j + 1) + '/' + data.length + ')'

            );

          }

        } catch (err) {

          console.error('[Sync] Failed to fetch ' + entity.key + ':', err);

          results[entity.key].failed = results[entity.key].total;

        }

      }



      // ===== 补充阶段：为每个组件拉取子项列表 =====

      if (!this._cancelled) {

        var comps = Store.getAll('components');

        this._updateProgress(30, '正在获取部件子项...', '正在拉取部件子项...');

        for (var ci = 0; ci < comps.length; ci++) {

          if (this._cancelled) break;

          var comp = comps[ci];

          try {

            var bomItems = await API.getAssemblyParts(comp.id).catch(function(e) { console.warn('[Sync.Supplement] getAssemblyParts failed for', comp.id, e); return null; });

            console.log('[Sync.Supplement] comp=' + comp.id + ', bomItems.len=' + (bomItems ? bomItems.length : 'null') + ', local.parts.len=' + ((comp.parts && comp.parts.length) || 0));

            if (Array.isArray(bomItems)) {

              // 转换字段名（API snake_case → 本地 camelCase）

              // 特殊处理：child_id 根据 child_type 映射到 partId 或 componentId

              var fmap = Store._fieldMap['bom_items'] || {};

              var reverseMap = {};

              for (var fk in fmap) { reverseMap[fmap[fk]] = fk; }

              var serverParts = bomItems.map(function(item) {

                var c = {};

                for (var k in item) {

                  if (k === 'child_id') {

                    // 根据 child_type 决定映射到 partId 还是 componentId

                    if (item.child_type === 'assembly') {

                      c.componentId = item.child_id;

                    } else {

                      c.partId = item.child_id;

                    }

                  } else {

                    c[reverseMap[k] || k] = item[k];

                  }

                }

                return c;

              });

              // 替换：直接使用服务器子项，替换本地子项

              console.log('[Sync.Supplement] comp=' + comp.id + ', serverParts=' + serverParts.length);

              Store.update('components', comp.id, { parts: serverParts }, { silent: true, skipSync: true });

            }

          } catch(e) {

            // 忽略单个组件子项拉取失败（组件本身已保存）

          }

          if (ci % 5 === 0 || ci === comps.length - 1) {

            this._updateProgress(30, '获取部件子项 (' + (ci + 1) + '/' + comps.length + ')...', '正在拉取部件子项 (' + (ci + 1) + '/' + comps.length + ')');

          }

        }

      }



      if (this._cancelled) {

        this._task.status = 'cancelled';

        this._updateResults(results);

        this._cancelBtn.disabled = true;

        this._cancelBtn.textContent = '已取消';

        return;

      }

      // ===== 加载自定义字段值 =====
      this._updateProgress(32, '正在加载自定义字段...', '正在获取自定义字段值...');

      try {

        var parts = Store.getAll('parts');
        for (var pfi = 0; pfi < parts.length; pfi++) {
          if (this._cancelled) break;
          var pitem = parts[pfi];
          try {
            var pvals = await API.getCustomFieldValues('part', pitem.id);
            if (pvals && Array.isArray(pvals)) {
              var pcfMap = {};
              pvals.forEach(function(v) { if (v.field_key) pcfMap[v.field_key] = v.value; });
              Store.update('parts', pitem.id, { customFields: pcfMap }, { silent: true, skipSync: true });
            }
          } catch (e) { console.warn('加载零件自定义字段失败:', pitem.code); }
        }

        var comps = Store.getAll('components');
        for (var cfi = 0; cfi < comps.length; cfi++) {
          if (this._cancelled) break;
          var citem = comps[cfi];
          try {
            var cvals = await API.getCustomFieldValues('component', citem.id);
            if (cvals && Array.isArray(cvals)) {
              var ccfMap = {};
              cvals.forEach(function(v) { if (v.field_key) ccfMap[v.field_key] = v.value; });
              Store.update('components', citem.id, { customFields: ccfMap }, { silent: true, skipSync: true });
            }
          } catch (e) { console.warn('加载部件自定义字段失败:', citem.code); }
        }

        var docs = Store.getAll('documents');
        for (var dfi = 0; dfi < docs.length; dfi++) {
          if (this._cancelled) break;
          var ditem = docs[dfi];
          try {
            var dvals = await API.getCustomFieldValues('document', ditem.id);
            if (dvals && Array.isArray(dvals)) {
              var dcfMap = {};
              dvals.forEach(function(v) { if (v.field_key) dcfMap[v.field_key] = v.value; });
              Store.update('documents', ditem.id, { customFields: dcfMap }, { silent: true, skipSync: true });
            }
          } catch (e) { console.warn('加载图文档自定义字段失败:', ditem.code); }
        }

      } catch (e) {

        console.error('加载自定义字段失败:', e);

      }


      // ===== 第二阶段：检查冲突并提示（不执行本地上传）=====

      // 本地新增记录（服务器无对应ID）：提示用户需手动确认后再同步

      // 服务器数据更新更晚：已在拉取阶段直接覆盖本地数据，无需干预



      var conflictMsgs = [];

      for (var ci = 0; ci < entities.length; ci++) {

        var cent = entities[ci];

        var localData = Store.getAll(cent.key);

        var localAdded = []; // 本地有、服务器无（本地新增）



        for (var li = 0; li < localData.length; li++) {

          var localItem = localData[li];

          // UUID 由前端生成后端直接使用，不再通过 ID 映射判断同步状态

          // 未同步的本地记录由后台同步队列处理

        }



        if (localAdded.length > 0) {

          var label = cent.key === 'components' ? '部件' : cent.key === 'parts' ? '零件' : cent.key === 'documents' ? '图文档' : cent.label || cent.key;

          conflictMsgs.push('本地新增 ' + label + ' ' + localAdded.length + ' 条（请确认后再同步）');

        }

      }



      if (this._cancelled) {

        this._task.status = 'cancelled';

        this._updateResults(results);

        this._cancelBtn.disabled = true;

        this._cancelBtn.textContent = '已取消';

      } else {

        this._task.status = 'completed';

        this._updateProgress(100, '同步完成', '<span style="color:var(--success)">✅ 数据检出完成</span>');

        this._updateResults(results);

        this._cancelBtn.disabled = false;

        this._cancelBtn.textContent = '关闭';

        this._cancelBtn.onclick = () => this.close();



        // 刷新当前页面

        setTimeout(function() { Router.render(); }, 500);



        // 显示提示（仅拉取，无需上传）

        var totalPulled = results.parts.success + results.components.success + results.documents.success + results.users.success;

        var msg = '同步完成：已从服务器检出 ' + totalPulled + ' 条';

        if (conflictMsgs.length > 0) {

          msg += '\n⚠️ ' + conflictMsgs.join('\n⚠️ ');

          UI.toast(msg, 'warning');

        } else {

          UI.toast(msg, 'success');

        }

        Store.addLog('数据检出', msg);

      }



    } catch (err) {

      console.error('[Sync] Error:', err);

      this._task.status = 'error';

      this._statusText.innerHTML = '<span style="color:var(--danger)">❌ 检出失败: ' + (err.message || '未知错误') + '</span>';

      this._cancelBtn.disabled = false;

      this._cancelBtn.textContent = '关闭';

    }

  }

};


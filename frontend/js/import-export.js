/**
 * PDM系统 导入导出模块
 * 依赖：SheetJS (xlsx.full.min.js)
 * 文件夹操作依赖：File System Access API (Chrome 86+, Edge 86+)
 */
var ImportExport = (function() {
  'use strict';

  var API_BASE = '/api/v2';
  var MAX_IMPORT_ROWS = 500;
  var ATTACHMENT_WARN_SIZE = 1024 * 1024 * 1024; // 1GB

  // ==================== 工具函数 ====================

  function _getAuthHeaders() {
    var headers = {};
    var token = localStorage.getItem('bom_api_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
  }

  function _apiGet(path) {
    return fetch(API._base + path, { headers: API._headers() }).then(function(r) {
      if (!r.ok) throw new Error('API error ' + r.status);
      return r.json();
    });
  }

  function _apiFetch(method, path, body) {
    var opts = { method: method, headers: API._headers() };
    if (body) opts.body = JSON.stringify(body);
    return fetch(API._base + path, opts).then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.detail || '操作失败'); });
      return r.json();
    });
  }

  function _apiPost(path, body) { return _apiFetch('POST', path, body); }
  function _apiPut(path, body) { return _apiFetch('PUT', path, body); }

  function _statusLabel(v) { return {draft:'草稿',frozen:'冻结',released:'发布',obsolete:'作废'}[v] || v || ''; }

  function _esc(s) { return s ? String(s).replace(/"/g, '""') : ''; }

  function _today() {
    var d = new Date();
    return d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
  }

  function _uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) { var r = Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16); }); }

  function _checkFSAccess() {
    return !!(window.showDirectoryPicker);
  }

  // ==================== Excel 读写 ====================

  function _parseExcelFile(file) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function(e) {
        try {
          var wb = XLSX.read(e.target.result, { type: 'array' });
          resolve(wb);
        } catch(err) { reject(err); }
      };
      reader.onerror = function() { reject(new Error('文件读取失败')); };
      reader.readAsArrayBuffer(file);
    });
  }

  function _sheetToJson(wb, sheetName) {
    var ws = wb.Sheets[sheetName];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { defval: '' });
  }

  function _sheetNames(wb) { return wb.SheetNames; }

  function _jsonToSheet(data) { return XLSX.utils.json_to_sheet(data); }

  function _buildWorkbook(sheets) {
    var wb = XLSX.utils.book_new();
    sheets.forEach(function(s) {
      var ws = _jsonToSheet(s.data);
      XLSX.utils.book_append_sheet(wb, ws, s.name);
    });
    return wb;
  }

  function _wbToBlob(wb) {
    var buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function _downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ==================== 文件夹操作 ====================

  async function _pickDirectory(mode) {
    if (!_checkFSAccess()) {
      throw new Error('您的浏览器不支持文件夹操作，请使用 Chrome 或 Edge 浏览器');
    }
    return await window.showDirectoryPicker({ mode: mode || 'readwrite' });
  }

  async function _writeToDir(dirHandle, fileName, blob) {
    var fh = await dirHandle.getFileHandle(fileName, { create: true });
    var writable = await fh.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async function _readDirFiles(dirHandle) {
    var files = [];
    for await (var entry of dirHandle.values()) {
      files.push(entry);
    }
    return files;
  }

  async function _readDirEntryAsFile(entry) {
    return await entry.getFile();
  }

  // ==================== 自定义字段 ====================

  function _getCfDefs(appliesTo) {
    var defs = Store.getAll('custom_field_defs');
    if (appliesTo === 'document') defs = defs.filter(function(d) { return d.applies_to === 'document'; }); else if (appliesTo) defs = defs.filter(function(d) { return d.applies_to === appliesTo || d.applies_to === 'both'; });
    return defs;
  }

  function _getCfValue(item, fieldKey) {
    if (!item || !item.customFields) return '';
    return item.customFields[fieldKey] || '';
  }

  // ==================== 零件导出 ====================

  function exportParts() {
    var parts = Store.getAll('parts');
    var documents = Store.getAll('documents');
    var cfDefs = _getCfDefs('part');

    // 构建 Sheet1：零件数据
    var columns = [
      { key: 'code', label: '零件件号' },
      { key: 'name', label: '中文名称' },
      { key: 'spec', label: '规格型号' },
      { key: 'version', label: '版本' },
      { key: 'status', label: '状态', render: function(r) { return _statusLabel(r.status); } },
      { key: 'updatedAt', label: '更新时间' }
    ];
    cfDefs.forEach(function(d) {
      columns.push({ key: 'customFields', label: d.name, cfKey: d.field_key, render: function(r) { return _getCfValue(r, d.field_key); } });
    });

    var partsData = parts.map(function(p) {
      var row = {};
      columns.forEach(function(c) {
        row[c.label] = typeof c.render === 'function' ? c.render(p) : (p[c.key] || '');
      });
      return row;
    });

    // 构建 Sheet2：关联图文档
    // 需要异步获取关联关系，逐个 part 发请求太慢
    // 从本地缓存中找已加载的关联数据
    var relData = [];
    var promises = parts.map(function(p) {
      return API._fetch('GET', '/parts/' + p.id + '/documents').then(function(list) {
        list.forEach(function(ed) {
          var doc = ed.document || {};
          relData.push({
            '零件件号': p.code,
            '零件版本': p.version,
            '图文档编号': doc.code || '',
            '图文档名称': doc.name || '',
            '图文档版本': doc.version || ''
          });
        });
      }).catch(function() {});
    });

    Promise.all(promises).then(function() {
      var sheets = [];
      if (partsData.length > 0) sheets.push({ name: '零件数据', data: partsData });
      sheets.push({ name: '关联图文档', data: relData });

      var wb = _buildWorkbook(sheets);
      var blob = _wbToBlob(wb);
      _downloadBlob(blob, '零件清单_' + _today() + '.xlsx');
      Store.addLog('数据导出', '导出零件清单（' + parts.length + '条）');
      UI.toast('导出完成，共 ' + parts.length + ' 条零件', 'success');
    });
  }

  // ==================== 零件导入 ====================

  async function importParts(file, onPreview, onConfirm) {
    var wb = await _parseExcelFile(file);
    var rows = _sheetToJson(wb, '零件数据');
    var relRows = _sheetToJson(wb, '关联图文档');
    var cfDefs = _getCfDefs('part');

    if (rows.length === 0) { UI.toast('未找到"零件数据"Sheet或数据为空', 'error'); return; }
    if (rows.length > MAX_IMPORT_ROWS) { UI.toast('单次导入上限 ' + MAX_IMPORT_ROWS + ' 条，当前 ' + rows.length + ' 条', 'error'); return; }

    // 校验并标记
    var allParts = Store.getAll('parts');
    var allDocs = Store.getAll('documents');
    var preview = rows.map(function(r) {
      var code = String(r['零件件号'] || '').trim();
      var name = String(r['中文名称'] || '').trim();
      var version = String(r['版本'] || 'A').trim();
      var status = String(r['状态'] || '草稿').trim();
      var errors = [];
      if (!code) errors.push('件号为空');
      if (!name) errors.push('名称为空');

      var match = allParts.find(function(p) { return p.code === code && p.version === version; });
      var action = match ? 'update' : 'create';

      // 状态反转
      var statusMap = {'草稿':'draft','冻结':'frozen','发布':'released','作废':'obsolete'};
      var statusVal = statusMap[status] || status || 'draft';

      return {
        code: code, name: name,
        spec: String(r['规格型号'] || '').trim(),
        version: version, status: statusVal,
        action: action,
        errors: errors,
        matchId: match ? match.id : null,
        customFields: {}
      };
    });

    // 解析自定义字段
    preview.forEach(function(p) {
      p.customFields = {};
      cfDefs.forEach(function(d) {
        if (rows[0] && rows[0][d.name] !== undefined) p.customFields[d.field_key] = String(rows[0][d.name]);
      });
    });

    // 解析关联图文档
    var relPreview = relRows.map(function(r) {
      var docCode = String(r['图文档编号'] || '').trim();
      var docVersion = String(r['图文档版本'] || '').trim();
      var docMatch = allDocs.find(function(d) { return d.code === docCode && d.version === docVersion; });
      return {
        partCode: String(r['零件件号'] || '').trim(),
        partVersion: String(r['零件版本'] || '').trim(),
        docCode: docCode,
        docName: String(r['图文档名称'] || '').trim(),
        docVersion: docVersion,
        docId: docMatch ? docMatch.id : null,
        found: !!docMatch
      };
    }).filter(function(r) { return r.partCode; });

    var stats = {
      total: preview.length,
      create: preview.filter(function(p) { return p.action === 'create'; }).length,
      update: preview.filter(function(p) { return p.action === 'update'; }).length,
      warnings: relPreview.filter(function(r) { return !r.found; }).length
    };

    if (onPreview) onPreview(preview, relPreview, stats);
    if (onConfirm) onConfirm(preview, relPreview, stats);
  }

  async function _executeImportParts(preview, relPreview) {
    var created = 0, updated = 0, errors = [];

    for (var i = 0; i < preview.length; i++) {
      var p = preview[i];
      if (p.errors.length > 0) continue;
      try {
        if (p.action === 'update') {
          await API._fetch('PUT', '/parts/' + p.matchId, {
            code: p.code, name: p.name, spec: p.spec, version: p.version, status: p.status, customFields: p.customFields
        });
          updated++;
        } else {
          var result = await API._fetch('POST', '/parts/', {
            code: p.code, name: p.name, spec: p.spec, version: p.version, status: p.status, customFields: p.customFields
        });
          p._newId = result.id;
          created++;
        }
      } catch(e) { errors.push(p.code + ': ' + e.message); }
    }

    // 建立关联图文档
    for (var j = 0; j < relPreview.length; j++) {
      var rel = relPreview[j];
      if (!rel.docId) continue;
      // 找到零件ID
      var partItem = preview.find(function(p) { return p.code === rel.partCode && p.version === rel.partVersion; });
      var partId = partItem ? (partItem._newId || partItem.matchId) : null;
      if (!partId) continue;
      try {
        await API._fetch('POST', '/parts/' + partId + '/documents', {
          document_id: rel.docId, sort_order: 0
        });
      } catch(e) { /* skip */ }
    }

    return { created: created, updated: updated, errors: errors };
  }

  // ==================== 部件导出 ====================

  async function exportAllAssemblies() {
    if (!_checkFSAccess()) {
      UI.alert('您的浏览器不支持文件夹操作，请使用 Chrome 或 Edge 浏览器');
      return;
    }

    try {
      UI.toast('正在导出...', 'info');
      var dirHandle = await _pickDirectory('readwrite');
      var folderName = '部件数据_' + _today();
      var subDir = await dirHandle.getDirectoryHandle(folderName, { create: true });

      var components = Store.getAll('components');
      var cfDefs = _getCfDefs('component');

      // 写入部件清单
      var listData = components.map(function(c) {
        var row = {
          '部件件号': c.code, '中文名称': c.name, '规格型号': c.spec || '',
          '版本': c.version, '状态': _statusLabel(c.status),
        };
        cfDefs.forEach(function(d) { row[d.name] = _getCfValue(c, d.field_key); });
        return row;
      });


      // 获取关联图文档
      var relData = [];
      var relPromises = components.map(function(comp) {
        return API._fetch('GET', '/assemblies/' + comp.id + '/documents').then(function(list) {
          list.forEach(function(ed) {
            var doc = ed.document || {};
            relData.push({
              '部件件号': comp.code, '部件版本': comp.version,
              '图文档编号': doc.code || '', '图文档名称': doc.name || '', '图文档版本': doc.version || ''
            });
          });
        }).catch(function() {});
      });
      await Promise.all(relPromises);

      // 写入关联图文档Sheet到部件清单
      // 需要重新构建workbook包含两个sheet
      var listSheets = [{ name: '部件清单', data: listData }];
      if (relData.length > 0) listSheets.push({ name: '关联图文档', data: relData });
      var listWb2 = _buildWorkbook(listSheets);
      await _writeToDir(subDir, '部件清单.xlsx', _wbToBlob(listWb2));

      // 写入每个部件的BOM
      var allParts = Store.getAll('parts');
      var allComps = Store.getAll('components');
      for (var i = 0; i < components.length; i++) {
        var comp = components[i];
        if (!comp.parts || comp.parts.length === 0) continue;
        var bomRows = _buildBomRows(comp, allParts, allComps);
        var fileName = 'BOM_' + comp.code + '_' + comp.version + '.xlsx';
        fileName = fileName.replace(/[\\/:*?"<>|]/g, '_');
        var bomWb = _buildWorkbook([{ name: 'BOM', data: bomRows }]);
        await _writeToDir(subDir, fileName, _wbToBlob(bomWb));
      }

      Store.addLog('数据导出', '导出部件数据（' + components.length + '个部件）');
      UI.toast('导出完成，共 ' + components.length + ' 个部件，保存至 ' + folderName, 'success');
    } catch(e) {
      if (e.message.indexOf('浏览器不支持') === -1) {
        UI.toast('导出失败: ' + e.message, 'error');
      }
    }
  }

  function _buildBomRows(comp, allParts, allComps) {
    var rows = [];
    // 顶层部件
    rows.push({ '层级': 0, '类型': '部件', '件号': comp.code, '中文名称': comp.name, '规格型号': comp.spec || '', '版本': comp.version, '状态': _statusLabel(comp.status), '用量': 1 });
    // 递归收集子项
    _collectBom(comp.parts || [], allParts, allComps, rows, 1);
    return rows;
  }

  function _collectBom(items, allParts, allComps, rows, depth) {
    if (!items) return;
    items.forEach(function(item) {
      var childType = item.childType || 'part';
      var refId = childType === 'component' ? (item.componentId || '') : (item.partId || '');
      var info = childType === 'part'
        ? allParts.find(function(p) { return p.id === refId; })
        : allComps.find(function(c) { return c.id === refId; });
      if (!info) return;
      rows.push({
        '层级': depth, '类型': childType === 'part' ? '零件' : '部件',
        '件号': info.code, '中文名称': info.name, '规格型号': info.spec || '',
        '版本': info.version || '', '状态': _statusLabel(info.status),
        '用量': item.quantity || 1
      });
      if (childType === 'component' && info.parts && info.parts.length > 0) {
        _collectBom(info.parts, allParts, allComps, rows, depth + 1);
      }
    });
  }

  // ==================== 部件导入 ====================

  async function importAssemblies(onPreview, onConfirm) {
    if (!_checkFSAccess()) {
      UI.alert('您的浏览器不支持文件夹操作，请使用 Chrome 或 Edge 浏览器');
      return;
    }

    try {
      var dirHandle = await _pickDirectory('read');
      var entries = await _readDirFiles(dirHandle);

      // 找部件清单
      var listEntry = entries.find(function(e) { return e.name === '部件清单.xlsx'; });
      if (!listEntry) { UI.toast('未找到"部件清单.xlsx"', 'error'); return; }

      var listFile = await _readDirEntryAsFile(listEntry);
      var wb = await _parseExcelFile(listFile);
      var rows = _sheetToJson(wb, '部件清单');

      if (rows.length === 0) { UI.toast('部件清单为空', 'error'); return; }
      if (rows.length > MAX_IMPORT_ROWS) { UI.toast('超出导入上限 ' + MAX_IMPORT_ROWS + ' 条', 'error'); return; }

      var allComps = Store.getAll('components');
      var preview = rows.map(function(r) {
        var code = String(r['部件件号'] || '').trim();
        var name = String(r['中文名称'] || '').trim();
        var version = String(r['版本'] || 'V1.0').trim();
        var errors = [];
        if (!code) errors.push('件号为空');
        if (!name) errors.push('名称为空');

        var match = allComps.find(function(c) { return c.code === code && c.version === version; });
        var action = match ? 'update' : 'create';
        var statusMap = {'草稿':'draft','冻结':'frozen','发布':'released','作废':'obsolete'};
        var statusVal = statusMap[String(r['状态'] || '')] || String(r['状态'] || '') || 'draft';

        return {
          code: code, name: name, spec: String(r['规格型号'] || '').trim(),
          version: version, status: statusVal, action: action, errors: errors,
          matchId: match ? match.id : null, bomRows: []
        };
      });

      // 找所有 BOM 文件
      var bomEntries = entries.filter(function(e) { return e.name.startsWith('BOM_') && e.name.endsWith('.xlsx'); });
      for (var i = 0; i < bomEntries.length; i++) {
        var bomFile = await _readDirEntryAsFile(bomEntries[i]);
        var bomWb = await _parseExcelFile(bomFile);
        var bomData = _sheetToJson(bomWb, 'BOM');
        // 从文件名提取件号和版本：BOM_ASM-001_V2.0.xlsx
        var bomName = bomEntries[i].name.replace('.xlsx', '');
        var bomCode = '', bomVersion = '';
        // 文件名：BOM_ASM-001_V1.0.xlsx → 件号=ASM-001, 版本=V1.0
        var parts = bomName.substring(4).split('_');
        if (parts.length >= 2) {
          bomVersion = parts.pop();
          bomCode = parts.join('_');
        } else { bomCode = bomName.substring(4); }

        var target = preview.find(function(p) { return p.code === bomCode; });
        if (target) target.bomRows = bomData;
      }

      // 读取关联图文档Sheet
      var relData = [];
      var relSheetName = wb.SheetNames ? wb.SheetNames.find(function(n) { return n.indexOf('关联图文档') >= 0; }) : null;
      if (relSheetName) relData = _sheetToJson(wb, relSheetName);

      var stats = {
        total: preview.length,
        create: preview.filter(function(p) { return p.action === 'create'; }).length,
        update: preview.filter(function(p) { return p.action === 'update'; }).length,
        bomFiles: bomEntries.length
      };

      if (onPreview) onPreview(preview, stats, relData);
      if (onConfirm) onConfirm(preview, stats, relData);
    } catch(e) {
      if (e.message.indexOf('浏览器不支持') === -1) {
        UI.toast('导入失败: ' + e.message, 'error');
      }
    }
  }

  async function _executeImportAssemblies(preview, relData) {
    var created = 0, updated = 0, errors = [];

    for (var i = 0; i < preview.length; i++) {
      var p = preview[i];
      if (p.errors.length > 0) continue;
      try {
        if (p.action === 'update') {
          await API._fetch('PUT', '/assemblies/' + p.matchId, {
            code: p.code, name: p.name, spec: p.spec, version: p.version, status: p.status, customFields: p.customFields
          });
          updated++;
        } else {
          var result = await API._fetch('POST', '/assemblies/', {
            code: p.code, name: p.name, spec: p.spec, version: p.version, status: p.status, customFields: p.customFields
          });
          p._newId = result.id;
          created++;
        }
      } catch(e) { errors.push(p.code + ': ' + e.message); }
    }

    // 建立 BOM 关系（按层级逐级导入，先浅后深）
    // 1. 收集所有 BOM 子项，按层级分组
    // 2. 逐层处理：先导入层级1，再层级2...
    // 3. 已存在的子项跳过，缺少的零件自动创建
    var allParts = Store.getAll('parts');
    var allComps = Store.getAll('components');
    var bomErrors = [];

    for (var j = 0; j < preview.length; j++) {
      var comp = preview[j];
      var compId = comp._newId || comp.matchId;
      if (!compId || !comp.bomRows || comp.bomRows.length === 0) continue;

      // 获取该部件已有的 BOM 子项
      var existingItems = [];
      try { existingItems = await API._fetch('GET', '/assemblies/' + compId + '/parts'); } catch(e) {}

      // 收集所有子项并按层级排序
      var childItems = comp.bomRows.filter(function(r) { return (r['层级'] || 0) > 0; });
      childItems.sort(function(a, b) { return (a['层级'] || 1) - (b['层级'] || 1); });

      for (var k = 0; k < childItems.length; k++) {
        var item = childItems[k];
        var childCode = String(item['件号'] || '').trim();
        var childTypeStr = String(item['类型'] || '');
        var isPart = childTypeStr === '零件';
        if (!childCode) continue;

        // 查找子项 ID
        var childId = null;
        // 1) 先在 preview 中查找（本轮新建的部件）
        for (var m = 0; m < preview.length; m++) {
          if (preview[m].code === childCode) {
            childId = preview[m]._newId || preview[m].matchId;
            isPart = false; // 在 preview 中找到的是部件
            break;
          }
        }
        // 2) 在 Store 中查找
        if (!childId) {
          if (isPart) {
            var found = allParts.find(function(p) { return p.code === childCode; });
            if (found) childId = found.id;
          } else {
            var found2 = allComps.find(function(cc) { return cc.code === childCode; });
            if (found2) childId = found2.id;
          }
        }
        // 3) 零件不存在则自动创建
        if (!childId && isPart) {
          try {
            var newPart = await API._fetch('POST', '/parts/', {
              code: childCode,
              name: String(item['中文名称'] || childCode).trim(),
              spec: String(item['规格型号'] || '').trim(),
              version: String(item['版本'] || 'A').trim(),
              status: 'draft'
            });
            childId = newPart.id;
            allParts.push(newPart);
          } catch(e) { bomErrors.push(childCode + ': 零件自动创建失败'); continue; }
        }
        if (!childId) { bomErrors.push(childCode + ': 未找到'); continue; }

        // 检查是否已存在该子项关系
        var alreadyExists = existingItems.some(function(ei) {
          return ei.child_id === childId || (ei.child_detail && ei.child_detail.id === childId);
        });
        if (alreadyExists) continue; // 跳过已存在的

        // 添加 BOM 子项（使用 Store 同样的 API 调用方式）
        try {
          await API.addAssemblyPart(compId, {
            child_type: isPart ? 'part' : 'component',
            child_id: childId,
            quantity: Number(item['用量']) || 1
          });
        } catch(e) { bomErrors.push(childCode + ': BOM添加失败 - ' + e.message); }
      }
    }
    errors = errors.concat(bomErrors);

    // 建立关联图文档
    for (var j = 0; j < relPreview.length; j++) {
      var rel = relPreview[j];
      if (!rel.docId) continue;
      // 找到零件ID
      var partItem = preview.find(function(p) { return p.code === rel.partCode && p.version === rel.partVersion; });
      var partId = partItem ? (partItem._newId || partItem.matchId) : null;
      if (!partId) continue;
      try {
        await API._fetch('POST', '/parts/' + partId + '/documents', {
          document_id: rel.docId, sort_order: 0
        });
      } catch(e) { /* skip */ }
    }

    return { created: created, updated: updated, errors: errors };
  }

  // ==================== 部件导出 ====================

  async function exportAllAssemblies() {
    if (!_checkFSAccess()) {
      UI.alert('您的浏览器不支持文件夹操作，请使用 Chrome 或 Edge 浏览器');
      return;
    }

    try {
      UI.toast('正在导出...', 'info');
      var dirHandle = await _pickDirectory('readwrite');
      var folderName = '部件数据_' + _today();
      var subDir = await dirHandle.getDirectoryHandle(folderName, { create: true });

      var components = Store.getAll('components');
      var cfDefs = _getCfDefs('component');

      // 写入部件清单
      var listData = components.map(function(c) {
        var row = {
          '部件件号': c.code, '中文名称': c.name, '规格型号': c.spec || '',
          '版本': c.version, '状态': _statusLabel(c.status),
        };
        cfDefs.forEach(function(d) { row[d.name] = _getCfValue(c, d.field_key); });
        return row;
      });


      // 获取关联图文档
      var relData = [];
      var relPromises = components.map(function(comp) {
        return API._fetch('GET', '/assemblies/' + comp.id + '/documents').then(function(list) {
          list.forEach(function(ed) {
            var doc = ed.document || {};
            relData.push({
              '部件件号': comp.code, '部件版本': comp.version,
              '图文档编号': doc.code || '', '图文档名称': doc.name || '', '图文档版本': doc.version || ''
            });
          });
        }).catch(function() {});
      });
      await Promise.all(relPromises);

      // 写入关联图文档Sheet到部件清单
      // 需要重新构建workbook包含两个sheet
      var listSheets = [{ name: '部件清单', data: listData }];
      if (relData.length > 0) listSheets.push({ name: '关联图文档', data: relData });
      var listWb2 = _buildWorkbook(listSheets);
      await _writeToDir(subDir, '部件清单.xlsx', _wbToBlob(listWb2));

      // 写入每个部件的BOM
      var allParts = Store.getAll('parts');
      var allComps = Store.getAll('components');
      for (var i = 0; i < components.length; i++) {
        var comp = components[i];
        if (!comp.parts || comp.parts.length === 0) continue;
        var bomRows = _buildBomRows(comp, allParts, allComps);
        var fileName = 'BOM_' + comp.code + '_' + comp.version + '.xlsx';
        fileName = fileName.replace(/[\\/:*?"<>|]/g, '_');
        var bomWb = _buildWorkbook([{ name: 'BOM', data: bomRows }]);
        await _writeToDir(subDir, fileName, _wbToBlob(bomWb));
      }

      Store.addLog('数据导出', '导出部件数据（' + components.length + '个部件）');
      UI.toast('导出完成，共 ' + components.length + ' 个部件，保存至 ' + folderName, 'success');
    } catch(e) {
      if (e.message.indexOf('浏览器不支持') === -1) {
        UI.toast('导出失败: ' + e.message, 'error');
      }
    }
  }

  function _buildBomRows(comp, allParts, allComps) {
    var rows = [];
    // 顶层部件
    rows.push({ '层级': 0, '类型': '部件', '件号': comp.code, '中文名称': comp.name, '规格型号': comp.spec || '', '版本': comp.version, '状态': _statusLabel(comp.status), '用量': 1 });
    // 递归收集子项
    _collectBom(comp.parts || [], allParts, allComps, rows, 1);
    return rows;
  }

  function _collectBom(items, allParts, allComps, rows, depth) {
    if (!items) return;
    items.forEach(function(item) {
      var childType = item.childType || 'part';
      var refId = childType === 'component' ? (item.componentId || '') : (item.partId || '');
      var info = childType === 'part'
        ? allParts.find(function(p) { return p.id === refId; })
        : allComps.find(function(c) { return c.id === refId; });
      if (!info) return;
      rows.push({
        '层级': depth, '类型': childType === 'part' ? '零件' : '部件',
        '件号': info.code, '中文名称': info.name, '规格型号': info.spec || '',
        '版本': info.version || '', '状态': _statusLabel(info.status),
        '用量': item.quantity || 1
      });
      if (childType === 'component' && info.parts && info.parts.length > 0) {
        _collectBom(info.parts, allParts, allComps, rows, depth + 1);
      }
    });
  }

  // ==================== 部件导入 ====================

  async function importAssemblies(onPreview, onConfirm) {
    if (!_checkFSAccess()) {
      UI.alert('您的浏览器不支持文件夹操作，请使用 Chrome 或 Edge 浏览器');
      return;
    }

    try {
      var dirHandle = await _pickDirectory('read');
      var entries = await _readDirFiles(dirHandle);

      // 找部件清单
      var listEntry = entries.find(function(e) { return e.name === '部件清单.xlsx'; });
      if (!listEntry) { UI.toast('未找到"部件清单.xlsx"', 'error'); return; }

      var listFile = await _readDirEntryAsFile(listEntry);
      var wb = await _parseExcelFile(listFile);
      var rows = _sheetToJson(wb, '部件清单');

      if (rows.length === 0) { UI.toast('部件清单为空', 'error'); return; }
      if (rows.length > MAX_IMPORT_ROWS) { UI.toast('超出导入上限 ' + MAX_IMPORT_ROWS + ' 条', 'error'); return; }

      var allComps = Store.getAll('components');
      var preview = rows.map(function(r) {
        var code = String(r['部件件号'] || '').trim();
        var name = String(r['中文名称'] || '').trim();
        var version = String(r['版本'] || 'V1.0').trim();
        var errors = [];
        if (!code) errors.push('件号为空');
        if (!name) errors.push('名称为空');

        var match = allComps.find(function(c) { return c.code === code && c.version === version; });
        var action = match ? 'update' : 'create';
        var statusMap = {'草稿':'draft','冻结':'frozen','发布':'released','作废':'obsolete'};
        var statusVal = statusMap[String(r['状态'] || '')] || String(r['状态'] || '') || 'draft';

        return {
          code: code, name: name, spec: String(r['规格型号'] || '').trim(),
          version: version, status: statusVal, action: action, errors: errors,
          matchId: match ? match.id : null, bomRows: []
        };
      });

      // 找所有 BOM 文件
      var bomEntries = entries.filter(function(e) { return e.name.startsWith('BOM_') && e.name.endsWith('.xlsx'); });
      for (var i = 0; i < bomEntries.length; i++) {
        var bomFile = await _readDirEntryAsFile(bomEntries[i]);
        var bomWb = await _parseExcelFile(bomFile);
        var bomData = _sheetToJson(bomWb, 'BOM');
        // 从文件名提取件号和版本：BOM_ASM-001_V2.0.xlsx
        var bomName = bomEntries[i].name.replace('.xlsx', '');
        var bomCode = '', bomVersion = '';
        // 文件名：BOM_ASM-001_V1.0.xlsx → 件号=ASM-001, 版本=V1.0
        var parts = bomName.substring(4).split('_');
        if (parts.length >= 2) {
          bomVersion = parts.pop();
          bomCode = parts.join('_');
        } else { bomCode = bomName.substring(4); }

        var target = preview.find(function(p) { return p.code === bomCode; });
        if (target) target.bomRows = bomData;
      }

      // 读取关联图文档Sheet
      var relData = [];
      var relSheetName = wb.SheetNames ? wb.SheetNames.find(function(n) { return n.indexOf('关联图文档') >= 0; }) : null;
      if (relSheetName) relData = _sheetToJson(wb, relSheetName);

      var stats = {
        total: preview.length,
        create: preview.filter(function(p) { return p.action === 'create'; }).length,
        update: preview.filter(function(p) { return p.action === 'update'; }).length,
        bomFiles: bomEntries.length
      };

      if (onPreview) onPreview(preview, stats, relData);
      if (onConfirm) onConfirm(preview, stats, relData);
    } catch(e) {
      if (e.message.indexOf('浏览器不支持') === -1) {
        UI.toast('导入失败: ' + e.message, 'error');
      }
    }
  }

  async function _executeImportAssemblies(preview, relData) {
    var created = 0, updated = 0, errors = [];

    for (var i = 0; i < preview.length; i++) {
      var p = preview[i];
      if (p.errors.length > 0) continue;
      try {
        if (p.action === 'update') {
          await API._fetch('PUT', '/assemblies/' + p.matchId, {
            code: p.code, name: p.name, spec: p.spec, version: p.version, status: p.status, customFields: p.customFields
          });
          updated++;
        } else {
          var result = await API._fetch('POST', '/assemblies/', {
            code: p.code, name: p.name, spec: p.spec, version: p.version, status: p.status, customFields: p.customFields
          });
          p._newId = result.id;
          created++;
        }
      } catch(e) { errors.push(p.code + ': ' + e.message); }
    }

    // 建立 BOM 关系
    var allParts = Store.getAll('parts');
    var allComps = Store.getAll('components');
    for (var j = 0; j < preview.length; j++) {
      var comp = preview[j];
      var compId = comp._newId || comp.matchId;
      if (!compId || comp.bomRows.length === 0) continue;

      var childItems = comp.bomRows.filter(function(r) { return (r['层级'] || 0) > 0; });
      for (var k = 0; k < childItems.length; k++) {
        var item = childItems[k];
        var childCode = String(item['件号'] || '').trim();
        var childType = String(item['类型'] || '');
        var isPart = childType === '零件';
        // 先在 preview 中查找（本轮新建的部件）
        var child = null;
        for (var m = 0; m < preview.length; m++) {
          if (preview[m].code === childCode) {
            child = { id: preview[m]._newId || preview[m].matchId };
            isPart = false;
            break;
          }
        }
        if (!child) {
          child = isPart
            ? allParts.find(function(p) { return p.code === childCode; })
            : allComps.find(function(c) { return c.code === childCode; });
        }
        if (!child) continue;

        var body = {};
        if (isPart) { body.child_id = child.id; body.child_type = 'part'; }
        else { body.child_id = child.id; body.child_type = 'component'; }
        body.quantity = Number(item['用量']) || 1;

        try { await API._fetch('POST', '/assemblies/' + compId + '/parts', body); } catch(e) { /* skip */ }
      }
    }

    // 建立关联图文档（参考零件导入逻辑）
    if (relData && relData.length > 0) {
      var allDocs = Store.getAll('documents');
      for (var r = 0; r < relData.length; r++) {
        var rel = relData[r];
        var compCode = String(rel['部件件号'] || '').trim();
        var compVer = String(rel['部件版本'] || '').trim();
        var docCode = String(rel['图文档编号'] || '').trim();
        var docVersion = String(rel['图文档版本'] || '').trim();
        if (!compCode || !docCode) continue;
        // 找到部件ID
        var compItem = preview.find(function(p) { return p.code === compCode && p.version === compVer; });
        var compId2 = compItem ? (compItem._newId || compItem.matchId) : null;
        if (!compId2) continue;
        // 找到图文档ID
        var doc = allDocs.find(function(d) { return d.code === docCode && d.version === docVersion; });
        if (!doc) continue;
        try {
          await API._fetch('POST', '/assemblies/' + compId2 + '/documents', {
            document_id: doc.id, sort_order: 0
          });
        } catch(e) { /* skip */ }
      }
    }

    return { created: created, updated: updated, errors: errors };
  }


  // ==================== 图文档导出 ====================

  async function exportDocuments() {
    if (!_checkFSAccess()) {
      UI.alert('您的浏览器不支持文件夹操作，请使用 Chrome 或 Edge 浏览器');
      return;
    }

    try {
      UI.toast('正在导出...', 'info');
      var dirHandle = await _pickDirectory('readwrite');
      var folderName = '图文档数据_' + _today();
      var subDir = await dirHandle.getDirectoryHandle(folderName, { create: true });
      var attDir = await subDir.getDirectoryHandle('attachments', { create: true });

      var documents = Store.getAll('documents');
      var cfDefs = _getCfDefs('document');

      // 构建清单数据（直接用文档对象的 file_name 字段）
      var listData = documents.map(function(d) {
        var row = {
          '图文档编号': d.code, '名称': d.name, '版本': d.version,
          '状态': _statusLabel(d.status), '描述': d.description || '',
          '附件文件名': d.file_name || '',
          '创建时间': d.createdAt || '', '更新时间': d.updatedAt || ''
        };
        cfDefs.forEach(function(cf) { row[cf.name] = _getCfValue(d, cf.field_key); });
        return row;
      });

      var listWb = _buildWorkbook([{ name: '图文档清单', data: listData }]);
      await _writeToDir(subDir, '图文档清单.xlsx', _wbToBlob(listWb));

      // 下载附件文件并写入文件夹
      var attCount = 0;
      for (var i = 0; i < documents.length; i++) {
        var doc = documents[i];
        if (!doc.file_id || !doc.file_name) continue;
        try {
          var resp = await fetch(API._base + '/v2/attachments/' + doc.file_id + '/stream', { headers: _getAuthHeaders() });
          if (!resp.ok) continue;
          var blob = await resp.blob();
          var safeName = (doc.code + '_' + doc.version + '_' + doc.file_name).replace(/[\\/:*?"<>|]/g, '_');
          await _writeToDir(attDir, safeName, blob);
          attCount++;
        } catch(e) { /* skip */ }
      }

      Store.addLog('数据导出', '导出图文档数据（' + documents.length + '条，' + attCount + '个附件）');
      UI.toast('导出完成，共 ' + documents.length + ' 条图文档，' + attCount + ' 个附件', 'success');
    } catch(e) {
      if (e.message.indexOf('浏览器不支持') === -1) {
        UI.toast('导出失败: ' + e.message, 'error');
      }
    }
  }
  // ==================== 图文档导入 ====================

  async function importDocuments(onPreview, onConfirm) {
    if (!_checkFSAccess()) {
      UI.alert('您的浏览器不支持文件夹操作，请使用 Chrome 或 Edge 浏览器');
      return;
    }

    try {
      var dirHandle = await _pickDirectory('read');
      var entries = await _readDirFiles(dirHandle);

      // 找图文档清单
      var listEntry = entries.find(function(e) { return e.name === '图文档清单.xlsx'; });
      if (!listEntry) { UI.toast('未找到"图文档清单.xlsx"', 'error'); return; }

      var listFile = await _readDirEntryAsFile(listEntry);
      var wb = await _parseExcelFile(listFile);
      var rows = _sheetToJson(wb);

      if (rows.length === 0) { UI.toast('图文档清单为空', 'error'); return; }
      if (rows.length > MAX_IMPORT_ROWS) { UI.toast('超出导入上限 ' + MAX_IMPORT_ROWS + ' 条', 'error'); return; }

      var allDocs = Store.getAll('documents');
      var preview = rows.map(function(r) {
        var code = String(r['图文档编号'] || '').trim();
        var name = String(r['名称'] || '').trim();
        var version = String(r['版本'] || 'A').trim();
        var errors = [];
        if (!code) errors.push('编号为空');
        if (!name) errors.push('名称为空');

        var match = allDocs.find(function(d) { return d.code === code && d.version === version; });
        var action = match ? 'update' : 'create';
        var statusMap = {'草稿':'draft','冻结':'frozen','发布':'released','作废':'obsolete'};
        var statusVal = statusMap[String(r['状态'] || '')] || String(r['状态'] || '') || 'draft';

        return {
          code: code, name: name, version: version,
          description: String(r['描述'] || '').trim(),
          status: statusVal, action: action, errors: errors,
          matchId: match ? match.id : null
        };
      });

      // 扫描 attachments 文件夹
      var attFiles = [];
      var attEntry = entries.find(function(e) { return e.kind === 'directory' && e.name === 'attachments'; });
      if (attEntry) {
        var attEntries = await _readDirFiles(attEntry);
        for (var i = 0; i < attEntries.length; i++) {
          if (attEntries[i].kind === 'file') {
            var f = await _readDirEntryAsFile(attEntries[i]);
            attFiles.push({ name: attEntries[i].name, file: f, size: f.size });
          }
        }
      }

      var stats = {
        total: preview.length,
        create: preview.filter(function(p) { return p.action === 'create'; }).length,
        update: preview.filter(function(p) { return p.action === 'update'; }).length,
        attachments: attFiles.length
      };

      if (onPreview) onPreview(preview, attFiles, stats);
      if (onConfirm) onConfirm(preview, attFiles, stats);
    } catch(e) {
      if (e.message.indexOf('浏览器不支持') === -1) {
        UI.toast('导入失败: ' + e.message, 'error');
      }
    }
  }

  async function _executeImportDocuments(preview, attFiles) {
    var created = 0, updated = 0, errors = [];

    for (var i = 0; i < preview.length; i++) {
      var p = preview[i];
      if (p.errors.length > 0) continue;
      try {
        if (p.action === 'update') {
          await API._fetch('PUT', '/documents/' + p.matchId, {
            code: p.code, name: p.name, version: p.version,
            description: p.description, status: p.status, customFields: p.customFields
        });
          updated++;
        } else {
          var result = await API._fetch('POST', '/documents/', {
            code: p.code, name: p.name, version: p.version,
            description: p.description, status: p.status, customFields: p.customFields
        });
          p._newId = result.id;
          created++;
        }
      } catch(e) { errors.push(p.code + ': ' + e.message); }
    }

    // 上传附件
    for (var j = 0; j < attFiles.length; j++) {
      var af = attFiles[j];
      if (af.size > ATTACHMENT_WARN_SIZE) {
        UI.toast('附件 ' + af.name + ' 超过 1GB，跳过', 'warning');
        continue;
      }
      // 从文件名提取图文档编号和版本：编号_v版本_文件名
      var parts = af.name.split('_');
      if (parts.length < 3) continue;
      var docCode = parts[0];
      var docVersion = parts[1].replace(/^v/i, '');
      var docItem = preview.find(function(p) { return p.code === docCode && p.version === docVersion; });
      var docId = docItem ? (docItem._newId || docItem.matchId) : null;
      if (!docId) continue;

      try {
        var formData = new FormData();
        formData.append('file', af.file);
        formData.append('entity_type', 'document');
        formData.append('entity_id', docId);
        await fetch(API_BASE + '/attachments/upload', {
          method: 'POST',
          headers: _getAuthHeaders(),
          body: formData
        });
      } catch(e) { /* skip */ }
    }

    return { created: created, updated: updated, errors: errors };
  }

  // ==================== 模板下载 ====================

  function downloadTemplate(type) {
    if (type === 'parts') {
      var wb = _buildWorkbook([
        { name: '零件数据', data: [{ '零件件号': 'PT-001', '中文名称': '示例零件', '规格型号': 'M12×50', '版本': 'A', '状态': '草稿' }] },
        { name: '关联图文档', data: [{ '零件件号': 'PT-001', '零件版本': 'A', '图文档编号': 'DOC-001', '图文档名称': '示例图文档', '图文档版本': 'A' }] }
      ]);
      _downloadBlob(_wbToBlob(wb), '零件导入模板.xlsx');
    }
    // 部件和图文档模板需要文件夹，在对应导入功能中处理
  }

  // ==================== 公开接口 ====================

  return {
    checkFSAccess: _checkFSAccess,
    exportParts: exportParts,
    exportAllAssemblies: exportAllAssemblies,
    exportDocuments: exportDocuments,
    importParts: importParts,
    executeImportParts: _executeImportParts,
    importAssemblies: importAssemblies,
    executeImportAssemblies: _executeImportAssemblies,
    importDocuments: importDocuments,
    executeImportDocuments: _executeImportDocuments,
    downloadTemplate: downloadTemplate,
    // 暴露内部工具供 UI 使用
    _pickDirectory: _pickDirectory
  };

})();

window.ImportExport = ImportExport;

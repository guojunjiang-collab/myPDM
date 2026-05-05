const Store = {

  _prefix: 'bom_',


  // ===== 同步元数据 =====
  // UUID 由前端统一生成，后端直接使用，不再需要 ID 映射


  // ===== 后台同步队列 =====

  _syncQueue: [],         // 待同步任务队列

  _syncRunning: false,    // 是否正在处理

  _syncStatus: 'idle',    // idle | syncing | error | offline

  _syncErrorCount: 0,     // 连续失败计数

  _currentTask: null,

  _uploadProgress: null,

  _syncStats: { success: 0, failed: 0, total: 0 },

  _taskHistory: [], // 已完成任务历史（用于面板显示）



  // 实体 → API 方法映射

  _entityMap: {

    parts:      { create: 'createPart',  update: 'updatePart',  delete: 'deletePart',  plural: 'getParts',     key: 'code' },

    components: { create: 'createAssembly', update: 'updateAssembly', delete: 'deleteAssembly', plural: 'getAssemblies', key: 'code' },

    documents:  { create: 'createDocument', update: 'updateDocument', delete: 'deleteDocument', plural: 'getDocuments', key: 'code' },

    users:      { create: 'createUser',  update: 'updateUser',  delete: 'deleteUser',  plural: 'getUsers',     key: 'username' },

  },



  // 实体字段到 API 字段的映射（本地字段名 → API 字段名）

_fieldMap: {
    parts:      {
      status: 'status',
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    components: {
      version: 'version',
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    },
    bom_items:  { childId: 'child_id', childType: 'child_type', partId: 'part_id', componentId: 'component_id', quantity: 'quantity', parentType: 'parent_type', parentId: 'parent_id', createdAt: 'created_at' },

    users:      { realName: 'real_name', department: 'department', phone: 'phone', createdAt: 'created_at', updatedAt: 'updated_at' },

    dict_materials: { id: 'id', value: 'value', name: 'name' },

  },


  // 入队：本地操作完成后自动触发后台同步

  // 清除本地缓存的图文档与自定义字段数据
  // 作用：当用户点击“清除缓存”时，除了清除通用缓存，还应将本地缓存的图文档和自定义字段一并清空，确保下一次检出从服务器获取最新数据。
  clearLocalDocAndCFCache: function() {
    // 清空本地内存缓存（如果存在）
    if (this._cache && typeof this._cache === 'object') {
      if (Array.isArray(this._cache.documents)) { this._cache.documents = []; }
      if (Array.isArray(this._cache.custom_field_defs)) { this._cache.custom_field_defs = []; }
      if (Array.isArray(this._cache.users)) { this._cache.users = []; }
      if (this._cache.parts) this._cache.parts = {};
      if (this._cache.components) this._cache.components = {};
      // 其他缓存条目按需清空
    }

    // 清空本地存储中的相关缓存常量（若应用有使用 LocalStorage/IndexedDB 等存储缓存）
    try { localStorage.removeItem('documents_cache'); } catch (e) {}
    try { localStorage.removeItem('cf_defs_cache'); } catch (e) {}
    try { localStorage.removeItem('custom_field_defs'); } catch (e) {}
    try { localStorage.removeItem('part_cache'); } catch (e) {}
    try { localStorage.removeItem('assembly_cache'); } catch (e) {}
    try { localStorage.removeItem('users_cache'); } catch (e) {}

    // 指示用户和系统缓存已清除
    if (this._updateProgress) {
      this._updateProgress(0, '本地缓存已清除（图文档、自定义字段、用户）', '');
    }

    // 清理完毕后，尽量清空零件的本地检出图文档缓存，确保界面不再显示老数据
    try {
      var partsCache = this.getAll('parts');
      if (Array.isArray(partsCache)) {
        var self = this;
        partsCache.forEach(function(p){ if (p) p._entityDocs = []; });
        self.saveAll('parts', partsCache);
      }
    } catch (e) {
      // ignore
    }

    // 重新渲染/刷新视图，确保后续操作从服务端重新拉取数据
    // 清理完毕后，尽量清空零件的本地检出图文档缓存，确保界面不再显示老数据
    try {
      var partsCache = this.getAll('parts');
      if (Array.isArray(partsCache)) {
        partsCache.forEach(function(p){ if (p) p._entityDocs = []; });
        this.saveAll('parts', partsCache);
      }
    } catch (e) {
      // ignore
    }
    if (Router && typeof Router.render === 'function') {
      Router.render();
    }
  },

  _enqueue(op, entity, record, oldRecord) {

    // 不同步 logs（只读）

    if (entity === 'logs') return;

    this._syncQueue.push({ op, entity, record, oldRecord, ts: Date.now() });

    this._needsRefresh = true;  // 标记需要刷新

    this._processQueue();

  },



  // 处理队列（非阻塞，串行执行）

  async _processQueue() {

    if (this._syncRunning || !API._token) return;

    this._syncRunning = true;

    this._syncStatus = 'syncing';

    this._updateSyncIndicator();



    while (this._syncQueue.length > 0 && API._token) {

      const task = this._syncQueue.shift();

      this._currentTask = task; // 设置当前任务

      try {

        await this._execSync(task);

        // 同步成功

        this._syncErrorCount = 0;

        this._syncStats.success++;

        this._syncStats.total++;

        this._taskHistory.push({

          task: task,

          status: 'success',

          timestamp: Date.now()

        });

      } catch (e) {

        // 网络错误 / 未登录：重新放回队列

        if (!API._token || e.message.includes('401') || e.message.includes('Failed to fetch') || e.message.includes('NetworkError') || e.message.includes('net::ERR')) {

          this._syncQueue.unshift(task);  // 退回队列末尾

          this._syncStatus = 'offline';

          this._syncErrorCount++;

          // 网络错误不计入失败统计，因为任务会被重试

          break;  // 暂停，等网络恢复

        } else {

          // 其他错误（业务逻辑错误）忽略，继续下一个

          console.warn('[Sync] 同步失败:', task.entity, task.record.id || task.record.code, e.message);

          this._syncStats.failed++;

          this._syncStats.total++;

          this._taskHistory.push({

            task: task,

            status: 'failed',

            error: e.message,

            timestamp: Date.now()

          });

        }

      } finally {

        this._currentTask = null; // 清除当前任务

      }

    }



    this._syncRunning = false;

    this._syncStatus = this._syncErrorCount > 0 ? 'error' : (this._syncQueue.length > 0 ? 'offline' : 'idle');

    this._updateSyncIndicator();



    // ===== 同步完成后刷新当前页面（仅当有待刷新标记时）=====

    if (this._syncStatus === 'idle' && this._needsRefresh && typeof Router !== 'undefined' && Router.render) {

      this._needsRefresh = false;

      Router.render();

    }

  },



  // 执行单个同步任务

  async _execSync(task) {

    const { op, entity, record, oldRecord } = task;

    const map = this._entityMap[entity];

    if (!map) return;



    // 本地字段名 → API 字段名

    const toApi = (rec) => {

      const fmap = this._fieldMap[entity] || {};

      const out = {};

      for (const k in rec) {

        out[fmap[k] || k] = rec[k];

      }

      return out;

    };



    if (op === 'add') {

      const apiData = toApi(record);


      // ===== 冲突检测：检查服务器是否已有相同 code+version =====

      if (entity === 'components' && record.code && record.version) {

        // 获取服务器上所有部件，检查 code+version 冲突

        const serverComps = await API.getAssemblies().catch(() => []);

        const conflict = serverComps.find(c => c.code === record.code && c.version === record.version);

        if (conflict) {

          throw new Error('CREATE_CONFLICT: 服务器已存在相同件号和版本的部件，请从服务器检出数据后再操作');

        }

      } else if (entity === 'parts' && record.code) {

        // 获取服务器上所有零件，检查 code+version 冲突（零件用 code+version 作为组合唯一键）

        const serverParts = await API.getParts().catch(() => []);

        const conflict = serverParts.find(p => p.code === record.code && p.version === record.version);

        if (conflict) {

          throw new Error('CREATE_CONFLICT: 服务器已存在相同件号和版本的零件，请从服务器检出数据后再操作');

        }

      }



      if (entity === 'components') {

        const { parts, ...rest } = apiData;

        console.log('[Sync.add.components] parts=' + JSON.stringify(parts) + ', record.id=' + record.id + ', rest.id=' + rest.id);

        await API[map.create](rest);

        if (parts && parts.length > 0) {

          for (const item of parts) {

            const isComponent = item.childType === 'component';

            const childId = isComponent ? item.componentId : item.partId;

            const childType = isComponent ? 'assembly' : 'part';

            console.log('[Sync.add.components] calling addAssemblyPart record.id=' + record.id + ' childId=' + childId + ' childType=' + childType);

            await API.addAssemblyPart(record.id, { child_type: childType, child_id: childId, quantity: item.quantity || 1 }).catch(function(e) { console.warn('[Sync.add.components] addAssemblyPart failed:', e); });

          }

        }

      } else {

        await API[map.create](apiData);

      }

    } else if (op === 'update') {

      const apiData = toApi(record);



      // ===== 冲突检测：检查服务器数据是否比本地更新 =====

      let serverItem = null;

      if (entity === 'components') {

        serverItem = await API.getAssembly(record.id).catch(() => null);

      } else if (entity === 'parts') {

        serverItem = await API.getPart(record.id).catch(() => null);

      }

      if (serverItem && serverItem.updated_at) {

        const serverTime = new Date(serverItem.updated_at).getTime();

        const localTime = record.updatedAt || 0;

        if (serverTime > localTime) {

          throw new Error('UPDATE_CONFLICT: 服务器数据已更新，请从服务器检出数据后再操作');

        }

      }



      if (entity === 'components') {

        const { parts, ...rest } = apiData;

        console.log('[Sync.update.components] parts=' + JSON.stringify(parts) + ', record.id=' + record.id);

        await API[map.update](record.id, rest);



        // ===== 同步子项（增删改）=====

        console.log('[Sync.update.components] parts=' + JSON.stringify(parts));

        if (parts && parts.length > 0) {

          console.log('[Sync.update.components] syncing ' + parts.length + ' sub-items');

          const serverParts = await API.getAssemblyParts(record.id).catch(() => []);

          const serverChildIds = new Set(serverParts.map(sp => sp.child_id));

          const localChildIds = new Set();



          // 1. 上传新增的子项

          for (const item of parts) {

            const isComponent = item.childType === 'component';

            const childId = isComponent ? item.componentId : item.partId;

            // 跳过无效的子项（ID 为空或无效）

            if (!childId || childId.length < 10) {

              console.warn('[Sync.update.components] 跳过无效子项:', item);

              continue;

            }

            const childType = isComponent ? 'assembly' : 'part';

            localChildIds.add(childId);

            if (!serverChildIds.has(childId)) {

              console.log('[Sync.update.components] addAssemblyPart childId=' + childId + ' childType=' + childType);

              await API.addAssemblyPart(record.id, { child_type: childType, child_id: childId, quantity: item.quantity || 1 }).catch(function(e) { console.warn('[Sync.update] addAssemblyPart failed:', e.message); });

            } else {

              console.log('[Sync.update.components] childId=' + childId + ' exists, check quantity');

              const serverItem = serverParts.find(sp => sp.child_id === childId);

              if (serverItem && serverItem.quantity !== (item.quantity || 1)) {

                console.log('[Sync.update.components] updating quantity: server=' + serverItem.quantity + ' local=' + item.quantity);

                await API.updateAssemblyPart(record.id, serverItem.id, { quantity: item.quantity || 1 }).catch(function(e) { console.warn('[Sync.update] updateAssemblyPart failed:', e.message); });

              }

            }

          }



          // 2. 删除服务器有但本地没有的子项

          for (const sp of serverParts) {

            if (!localChildIds.has(sp.child_id)) {
              console.log('[Sync.update.components] remove childId=' + sp.child_id + ' itemId=' + sp.id);
              await API.removeAssemblyPart(record.id, sp.id).catch(function(e) { console.warn('[Sync.update] removeAssemblyPart failed:', e.message); });
            }
          }

        } else {

          console.log('[Sync.update.components] no sub-items to sync (parts empty/undefined)');

        }

      } else {

        await API[map.update](record.id, apiData);

      }



      // ===== 更新成功后，从服务器获取最新数据同步到本地 =====

      if (entity === 'parts') {

        const serverPart = await API.getPart(record.id).catch(() => null);

        if (serverPart) {

          const fmap = Store._fieldMap['parts'] || {};

          const reverseMap = {};

          for (const k in fmap) { reverseMap[fmap[k]] = k; }

          const converted = {};

          for (const k in serverPart) { converted[reverseMap[k] || k] = serverPart[k]; }

          const localParts = Store.getAll('parts');

          const idx = localParts.findIndex(p => p.id === record.id);

          if (idx >= 0) {

            Object.assign(localParts[idx], converted);

            Store.saveAll('parts', localParts);

            console.log('[Sync.update.parts] 本地数据已从服务器同步更新');

          }

        }

      } else if (entity === 'components') {

        // 获取最新的部件数据（包含子项详情）

        const serverComp = await API.getAssembly(record.id).catch(() => null);

        if (serverComp) {

          const fmap = Store._fieldMap['components'] || {};

          const reverseMap = {};

          for (const k in fmap) { reverseMap[fmap[k]] = k; }

          const converted = {};

          for (const k in serverComp) { converted[reverseMap[k] || k] = serverComp[k]; }

          // 转换服务器返回的 parts 数组为本地格式

          if (serverComp.parts && Array.isArray(serverComp.parts)) {

            converted.parts = this._convertServerPartsToLocal(serverComp.parts);

          }

          const localComps = Store.getAll('components');

          const idx = localComps.findIndex(c => c.id === record.id);

          if (idx >= 0) {

            Object.assign(localComps[idx], converted);

            Store.saveAll('components', localComps);

            console.log('[Sync.update.components] 本地数据已从服务器同步更新，包含转换后的子项');

          }

        }

      }

    } else if (op === 'delete') {

      await API[map.delete](record.id);

    }

  },



  // 将服务器返回的 parts 数组转换为本地格式

  _convertServerPartsToLocal(serverParts) {

    if (!serverParts || !Array.isArray(serverParts)) return [];

    return serverParts.map(item => {

      // 服务器格式：childType: 'assembly' | 'part', childId, componentId, partId, child_detail, ...

      // 本地格式：childType: 'component' | 'part', componentId, partId, quantity

      const childType = item.childType === 'assembly' ? 'component' : (item.childType === 'part' ? 'part' : item.childType);

      const quantity = item.quantity || 1;

      if (childType === 'component') {

        return {

          childType: 'component',

          componentId: item.componentId || item.child_detail?.id || '',

          quantity: quantity

        };

      } else {

        return {

          childType: 'part',

          partId: item.partId || item.child_detail?.id || '',

          quantity: quantity

        };

      }

    });

  },



  // 同步状态指示器：页面右下角小圆点

  _updateSyncIndicator() {

    let el = document.getElementById('sync-indicator');

    if (!el) return;

    const labels = { idle: '', syncing: '🔄 检出中…', error: '⚠️ 检出失败', offline: '📴 离线' };

    el.textContent = labels[this._syncStatus] || '';

    el.title = '队列剩余: ' + this._syncQueue.length + ' 项';

  },



  // ===== 初始化 =====

  init() {

    // 页面加载时尝试消费队列

    if (API._token) { try { this._processQueue(); } catch(e) { console.warn('[Sync]', e); } }

  },



  // ===== 基础 CRUD（同步，返回数据） =====

  _key(e) { return this._prefix + e; },

  getAll(e) { try { return JSON.parse(localStorage.getItem(this._key(e))) || []; } catch { return []; } },

  saveAll(e, d) { localStorage.setItem(this._key(e), JSON.stringify(d)); },

  getById(e, id) { return this.getAll(e).find(r => r.id === id); },

  add(e, rec, opts) {

    opts = opts || {};

    const d = this.getAll(e);

    rec.id = rec.id || this._genId(e);

    rec.createdAt = rec.createdAt || Date.now();

    rec.updatedAt = Date.now();

    d.push(rec);

    this.saveAll(e, d);

    // 后台同步（skipSync 为 true 时跳过）

    if (!opts.skipSync) {

      this._enqueue('add', e, rec, null);

    }

    return rec;

  },

  update(e, id, upd, opts) {

    opts = opts || {};

    const d = this.getAll(e);

    const i = d.findIndex(r => r.id === id);

    if (i < 0) return null;

    const oldRecord = Object.assign({}, d[i]);

    Object.assign(d[i], upd, { updatedAt: Date.now() });

    this.saveAll(e, d);

    // 后台同步（skipSync 为 true 时跳过）

    if (!opts.skipSync) {

      this._enqueue('update', e, d[i], oldRecord);

    }

    return d[i];

  },

  remove(e, id, opts) {

    opts = opts || {};

    const d = this.getAll(e);

    const rec = d.find(r => r.id === id);

    this.saveAll(e, d.filter(r => r.id !== id));

    // 后台同步（skipSync 为 true 时跳过）

    if (rec && !opts.skipSync) this._enqueue('delete', e, rec, null);

  },

  _genId(e) {

    // 使用 UUID v4 格式，与后端 PostgreSQL UUID 类型兼容

    return _uuid();

  },

  addLog(action, detail) {

    const u = Auth.getUser();

    this.add('logs', { action, detail: detail || '', user: u ? u.username : 'system', time: Date.now() });

  },



  // ===== 手动全量同步（管理员可触发） =====

  async syncAll() {

    if (!API._token) return { error: '未登录后端' };

    const parts = this.getAll('parts');

    const assemblies = this.getAll('components');

    return await API.syncAll(parts, assemblies);

  },



  // ===== 首次登录后主动推送本地数据 =====

  async onLogin() {

    if (!API._token) return;

    this._syncStatus = 'syncing';

    this._updateSyncIndicator();

    try {

      await this._loadDataFromServer();

      const results = await this.syncAll();

      await this._loadCustomFieldData();

      this._syncStatus = 'idle';

      this._updateSyncIndicator();

      return results;

    } catch (e) {

      this._syncStatus = 'error';

      this._updateSyncIndicator();

      return { error: e.message };

    }

  },

  // ===== 从服务器拉取数据到本地 =====

  async _loadDataFromServer() {

    try {

      const serverParts = await API.getParts().catch(() => []);

      const serverComps = await API.getAssemblies().catch(() => []);

      const serverDocs = await API.getDocuments().catch(() => []);

      // 转换字段名 snake_case -> camelCase
      const convertFields = (data) => {
        return data.map(item => {
          const out = {};
          for (const k in item) {
            const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
            out[camel] = item[k];
          }
          return out;
        });
      };

      const localParts = convertFields(serverParts);
      const localComps = convertFields(serverComps);
      const localDocs = convertFields(serverDocs);

      this.saveAll('parts', localParts);
      this.saveAll('components', localComps);
      this.saveAll('documents', localDocs);

    } catch (e) {

      console.warn('[Store] 从服务器加载数据失败:', e.message);

    }

  },

  // ===== 加载自定义字段数据 =====

  async _loadCustomFieldData() {

    try {

      const cfDefs = await API.getCustomFieldDefinitions();

      this.saveAll('custom_field_defs', cfDefs || []);

      const parts = this.getAll('parts');

      const partPromises = parts.map(async function(part) {
        try {
          const values = await API.getCustomFieldValues('part', part.id);
          if (values && Array.isArray(values)) {
            const cfMap = {};
            values.forEach(function(v) {
              if (v.field_key) cfMap[v.field_key] = v.value;
            });
            return { partId: part.id, customFields: cfMap };
          }
        } catch (e) {
          console.warn('[Store] 加载零件自定义字段失败:', part.id, e.message);
        }
        return null;
      });

      const partResults = await Promise.all(partPromises);
      partResults.forEach(function(r) {
        if (r) {
          const p = parts.find(function(x) { return x.id === r.partId; });
          if (p) p.customFields = r.customFields;
        }
      });
      this.saveAll('parts', parts);

      const components = this.getAll('components');

      const compPromises = components.map(async function(comp) {
        try {
          const values = await API.getCustomFieldValues('component', comp.id);
          if (values && Array.isArray(values)) {
            const cfMap = {};
            values.forEach(function(v) {
              if (v.field_key) cfMap[v.field_key] = v.value;
            });
            return { compId: comp.id, customFields: cfMap };
          }
        } catch (e) {
          console.warn('[Store] 加载部件自定义字段失败:', comp.id, e.message);
        }
        return null;
      });

      const compResults = await Promise.all(compPromises);
      compResults.forEach(function(r) {
        if (r) {
          const c = components.find(function(x) { return x.id === r.compId; });
          if (c) c.customFields = r.customFields;
        }
      });
      this.saveAll('components', components);

    } catch (e) {

      console.warn('[Store] 加载自定义字段定义失败:', e);

    }

  },
  
};

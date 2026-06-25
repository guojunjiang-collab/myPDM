import axios, { AxiosError } from 'axios';
import { useAuthStore } from '../stores/auth';
import type { ECRListParams, ECRCreateData } from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
  paramsSerializer: {
    serialize: (params) => {
      // 强制将数组序列化为 JSON 字符串，避免 axios 把单元素数组变成字符串
      return Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) =>
          Array.isArray(v)
            ? `${encodeURIComponent(k)}=${encodeURIComponent(JSON.stringify(v))}`
            : `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`
        )
        .join('&');
    },
  },
});

// 请求拦截器：自动添加 Token
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器：401 自动刷新
let refreshing: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const rt = localStorage.getItem('refresh_token');
  if (!rt) return null;
  try {
    const resp = await axios.post('/api/auth/refresh', { refresh_token: rt });
    const { access_token, refresh_token } = resp.data;
    useAuthStore.getState().setUser(useAuthStore.getState().user, access_token);
    if (refresh_token) localStorage.setItem('refresh_token', refresh_token);
    return access_token;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original: any = error.config;
    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      refreshing = refreshing || doRefresh();
      const newToken = await refreshing;
      refreshing = null;
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
      useAuthStore.getState().logout();
      localStorage.removeItem('refresh_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// 认证 API
export const authApi = {
  login: (username: string, password: string) => {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    return api.post('/auth/token', formData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  },
  getCurrentUser: () => api.get('/auth/me'),
  changePassword: (oldPassword: string, newPassword: string) =>
    api.post('/auth/change-password', {
      old_password: oldPassword,
      new_password: newPassword,
    }),
};

// 零件 API
export const partsApi = {
  list: (params?: { page?: number; page_size?: number; search?: string; status?: string; brief?: boolean; updated_since?: number }) =>
    api.get('/parts/', { params }),
  get: (id: string) => api.get(`/parts/${id}`),
  create: (data: unknown) => api.post('/parts/', data),
  update: (id: string, data: unknown) => api.put(`/parts/${id}`, data),
  delete: (id: string) => api.delete(`/parts/${id}`),
  upgrade: (id: string, note?: string) => api.post(`/parts/${id}/upgrade`, { note }),
  versions: (id: string) => api.get(`/parts/${id}/versions`),
  exportExcel: (params?: { status?: string }) =>
    api.get('/parts/export', { params, responseType: 'blob' }),
};

// 部件 API
export const assembliesApi = {
  list: (params?: { page?: number; page_size?: number; search?: string; status?: string; brief?: boolean; updated_since?: number; top_level?: boolean }) =>
    api.get('/assemblies/', { params }),
  get: (id: string) => api.get(`/assemblies/${id}`),
  create: (data: unknown) => api.post('/assemblies/', data),
  update: (id: string, data: unknown) => api.put(`/assemblies/${id}`, data),
  delete: (id: string) => api.delete(`/assemblies/${id}`),
  upgrade: (id: string, note?: string) => api.post(`/assemblies/${id}/upgrade`, { note }),
  versions: (id: string) => api.get(`/assemblies/${id}/versions`),
  exportBOM: (id: string) =>
    api.get(`/assemblies/${id}/bom/export`, { responseType: 'blob' }),
};

// 图文档 API
export const documentsApi = {
  list: (params?: { page?: number; page_size?: number; keyword?: string; status?: string; brief?: boolean; updated_since?: number }) =>
    api.get('/documents/', { params }),
  get: (id: string) => api.get(`/documents/${id}`),
  create: (data: unknown) => api.post('/documents/', data),
  update: (id: string, data: unknown) => api.put(`/documents/${id}`, data),
  delete: (id: string) => api.delete(`/documents/${id}`),
  upgrade: (id: string, note?: string) => api.post(`/documents/${id}/upgrade`, { note }),
  versions: (id: string) => api.get(`/documents/${id}/versions`),
  // 图文档附件
  uploadAttachment: (docId: string, data: { id?: string; file_name: string; file_data: string }) =>
    api.post(`/documents/${docId}/attachments`, data),
  listAttachments: (docId: string) => api.get(`/documents/${docId}/attachments/`),
  getAttachment: (docId: string, attId: string) => api.get(`/documents/${docId}/attachments/${attId}`),
  deleteAttachment: (docId: string, attId: string) => api.delete(`/documents/${docId}/attachments/${attId}`),
  /** 图文档反查：查询引用该文档的零件、部件和用户看板 */
  references: (docId: string) => api.get(`/documents/${docId}/references`),
};

// BOM API
export const bomApi = {
  getTree: (type: 'part' | 'assembly', id: string) =>
    api.get(`/bom/tree/${type}/${id}`),
  getAll: (params?: { updated_since?: number }) =>
    api.get('/bom/items/all', { params }),
  checkReferences: (entityType: string, entityId: string) =>
    api.get(`/bom/references/${entityType}/${entityId}`),
  createItem: (data: { parent_type: string; parent_id: string; child_type: string; child_id: string; qty: number }) =>
    api.post('/bom/items', data),
  deleteItem: (id: string) => api.delete(`/bom/items/${id}`),
  compare: (leftAssemblyId: string, rightAssemblyId: string) =>
    api.post('/bom/compare', { left_assembly_id: leftAssemblyId, right_assembly_id: rightAssemblyId }),
  trace: (type: string, id: string) =>
    api.get(`/bom/trace/${type}/${id}`),
};

// 用户 API
export const usersApi = {
  list: (params?: { page?: number; page_size?: number; search?: string; skip?: number; limit?: number }) =>
    api.get('/users/', { params }),
  get: (id: string) => api.get(`/users/${id}`),
  create: (data: unknown) => api.post('/users/', data),
  update: (id: string, data: unknown) => api.put(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
  getGroups: (id: string) => api.get(`/users/${id}/groups`),
  setGroups: (id: string, groupIds: string[]) => api.put(`/users/${id}/groups`, { group_ids: groupIds }),
};

// 用户组 API
export const userGroupsApi = {
  list: () => api.get('/user-groups/'),
  create: (data: { name: string; description?: string }) => api.post('/user-groups/', data),
  update: (id: string, data: { name?: string; description?: string }) => api.put(`/user-groups/${id}`, data),
  delete: (id: string) => api.delete(`/user-groups/${id}`),
  getMembers: (id: string) => api.get(`/user-groups/${id}/members`),
  setMembers: (id: string, userIds: string[]) => api.put(`/user-groups/${id}/members`, { user_ids: userIds }),
};

// 操作日志 API
export const logsApi = {
  list: (params?: { page?: number; page_size?: number; user_id?: string; start_date?: string; end_date?: string }) =>
    api.get('/logs/', { params }),
};

// 用户看板 API
export const boardApi = {
  /** 获取当前用户看板（含完整文件夹树 + 关联项 + 共享文件夹） */
  getDashboard: () => api.get('/dashboard/'),
  /** 初始化用户看板 */
  initDashboard: () => api.post('/dashboard/init'),
  /** 创建文件夹 */
  createFolder: (data: { name: string; parent_id?: string | null }) =>
    api.post('/dashboard/folders', data),
  /** 更新文件夹（重命名/移动） */
  updateFolder: (id: string, data: { name?: string; parent_id?: string | null }) =>
    api.put(`/dashboard/folders/${id}`, data),
  /** 删除文件夹（级联删除子文件夹+关联项） */
  deleteFolder: (id: string) => api.delete(`/dashboard/folders/${id}`),
  /** 批量添加关联项到文件夹 */
  addItems: (folderId: string, items: { entity_type: string; entity_id: string }[]) =>
    api.post('/dashboard/items', { folder_id: folderId, items }),
  /** 删除单个关联项 */
  removeItem: (itemId: string) => api.delete(`/dashboard/items/${itemId}`),
  /** 获取文件夹共享列表 */
  getShares: (folderId: string) => api.get(`/dashboard/folders/${folderId}/shares`),
  /** 添加共享 */
  addShare: (folderId: string, userId: string, permission: string) =>
    api.post(`/dashboard/folders/${folderId}/shares`, { shared_with_user_id: userId, permission }),
  /** 取消共享（文件夹所有者操作） */
  removeShare: (folderId: string, shareId: string) =>
    api.delete(`/dashboard/folders/${folderId}/shares/${shareId}`),
  /** 修改共享权限（仅文件夹所有者） */
  updateSharePermission: (folderId: string, shareId: string, permission: string) =>
    api.put(`/dashboard/folders/${folderId}/shares/${shareId}`, { permission }),
  /** 批量保存共享设置（原子操作） */
  saveShares: (folderId: string, shares: { shared_with_user_id: string; permission: string }[]) =>
    api.post(`/dashboard/folders/${folderId}/shares/batch`, { shares }),
  /** 移除共享文件夹（被共享者主动退出） */
  removeSharedFolder: (folderId: string) =>
    api.delete(`/dashboard/shared-folder/${folderId}`),
  /** @deprecated 兼容旧调用 */
  getFolders: () => api.get('/dashboard/'),
  /** @deprecated 兼容旧调用 */
  getItems: (_folderId: string) => Promise.resolve({ data: [] }),
  /** @deprecated 兼容旧调用 */
  addItem: (folderId: string, data: { item_type: string; item_id: string }) =>
    api.post('/dashboard/items', { folder_id: folderId, items: [{ entity_type: data.item_type, entity_id: data.item_id }] }),
  /** @deprecated 兼容旧调用 */
  shareFolder: (_id: string, _data: { shared: boolean }) => Promise.resolve({ data: {} }),
};

// 仪表盘 API
export const dashboardApi = {
  getStats: () => api.get('/dashboard/stats'),
};

// 实体-图文档关联 API
export const entityDocumentsApi = {
  list: (entityType: 'part' | 'assembly' | 'configuration', entityId: string) => {
    const base = entityType === 'part' ? 'parts' : entityType === 'assembly' ? 'assemblies' : 'configurations/items';
    return api.get(`/${base}/${entityId}/documents`);
  },
  add: (entityType: 'part' | 'assembly' | 'configuration', entityId: string, data: { document_id: string; category?: string; sort_order?: number }) => {
    const base = entityType === 'part' ? 'parts' : entityType === 'assembly' ? 'assemblies' : 'configurations/items';
    return api.post(`/${base}/${entityId}/documents`, data);
  },
  update: (entityType: 'part' | 'assembly' | 'configuration', entityId: string, edocId: string, data: { category?: string; sort_order?: number }) => {
    const base = entityType === 'part' ? 'parts' : entityType === 'assembly' ? 'assemblies' : 'configurations/items';
    return api.put(`/${base}/${entityId}/documents/${edocId}`, data);
  },
  remove: (entityType: 'part' | 'assembly' | 'configuration', entityId: string, edocId: string) => {
    const base = entityType === 'part' ? 'parts' : entityType === 'assembly' ? 'assemblies' : 'configurations/items';
    return api.delete(`/${base}/${entityId}/documents/${edocId}`);
  },
};

// 附件下载
export const attachmentApi = {
  download: (id: string) => api.get(`/v2/attachments/${id}/download`, { responseType: 'blob' }),
  archiveTree: (id: string, token: string) =>
    api.get<import('../types').ArchiveTreeResponse>(`/v2/attachments/${id}/archive-tree`, { params: { token } }),
};

// 媒体令牌 API（替代 ?token= 的会话 JWT）
export const mediaApi = {
  token: (attId: string, action: 'preview' | 'direct-download' | 'gltf' | 'archive-tree' | 'extract-file' | 'office-pdf') =>
    api.get(`/v2/attachments/${attId}/media-token`, { params: { action } }).then(r => r.data.token as string),
};

// ============================================================
// V2 分块上传 API (支持大文件上传)
// ============================================================

// 创建专用于大文件上传的 axios 实例 (10 分钟超时)
const uploadAxios = axios.create({
  baseURL: '/api',
  timeout: 600000, // 10 分钟
  headers: {
    'Content-Type': 'multipart/form-data',
  },
});

// 上传请求拦截器
uploadAxios.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// V2 大文件上传 API
export const v2UploadApi = {
  /**
   * 小文件直接上传 (multipart)
   * 适用于文件 < CHUNK_SIZE * 2 (默认 10MB)
   */
  uploadSmallFile: (
    file: File,
    entityType: string = 'documents',
    entityId: string,
    onProgress?: (percent: number) => void
  ): Promise<{ id: string; file_name: string; file_size: number; file_path: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entity_type', entityType);
    formData.append('entity_id', entityId);

    return uploadAxios.post('/v2/attachments/upload', formData, {
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
          onProgress(percent);
        }
      },
    }).then(res => res.data);
  },

  /**
   * 初始化分块上传
   * 返回 upload_id 和分块信息
   */
  initChunkedUpload: (
    filename: string,
    fileSize: number,
    entityType: string = 'documents',
    entityId: string
  ): Promise<{
    upload_id: string;
    total_chunks: number;
    chunk_size: number;
  }> => {
    const formData = new FormData();
    formData.append('filename', filename);
    formData.append('file_size', String(fileSize));
    formData.append('entity_type', entityType);
    formData.append('entity_id', entityId);

    return uploadAxios.post('/v2/attachments/chunk/init', formData)
      .then(res => res.data);
  },

  /**
   * 上传单个分块
   */
  uploadChunk: (
    uploadId: string,
    chunkIndex: number,
    chunk: Blob,
    onProgress?: (percent: number) => void
  ): Promise<{
    upload_id: string;
    chunk_index: number;
    uploaded_chunks: number[];
    total_chunks: number;
    progress: number;
    is_complete: boolean;
  }> => {
    const formData = new FormData();
    formData.append('upload_id', uploadId);
    formData.append('chunk_index', String(chunkIndex));
    formData.append('chunk', chunk);

    return uploadAxios.post('/v2/attachments/chunk/upload', formData, {
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
          onProgress(percent);
        }
      },
    }).then(res => res.data);
  },

  /**
   * 完成分块上传，合并文件
   */
  completeChunkedUpload: (
    uploadId: string
  ): Promise<{
    id: string;
    file_name: string;
    file_size: number;
    file_path: string;
  }> => {
    const formData = new FormData();
    formData.append('upload_id', uploadId);

    return uploadAxios.post('/v2/attachments/chunk/complete', formData)
      .then(res => res.data);
  },
};

// 分块大小阈值 (10MB) - 与后端 CHUNK_SIZE * 2 保持一致
export const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
export const CHUNK_THRESHOLD = CHUNK_SIZE * 2; // 10MB

// 部件子项 API
export const assemblyPartsApi = {
  list: (assemblyId: string) => api.get(`/assemblies/${assemblyId}/parts`),
  add: (assemblyId: string, data: { child_type: string; child_id: string; quantity: number }) =>
    api.post(`/assemblies/${assemblyId}/parts`, data),
  update: (assemblyId: string, itemId: string, data: { quantity: number }) =>
    api.put(`/assemblies/${assemblyId}/parts/${itemId}`, data),
  remove: (assemblyId: string, itemId: string) =>
    api.delete(`/assemblies/${assemblyId}/parts/${itemId}`),
};

// 自定义字段 API
export const customFieldsApi = {
  listDefinitions: () =>
    api.get('/custom-fields/definitions/'),
  createDefinition: (data: unknown) => api.post('/custom-fields/definitions/', data),
  updateDefinition: (id: string, data: unknown) => api.put(`/custom-fields/definitions/${id}`, data),
  deleteDefinition: (id: string) => api.delete(`/custom-fields/definitions/${id}`),
  reorderDefinitions: (items: { id: string; sort_order: number }[]) =>
    api.put('/custom-fields/definitions/reorder', { items }),
  getValues: (entityType: string, entityId: string) =>
    api.get(`/custom-fields/values/${entityType}/${entityId}`),
  getValuesBatch: (params: { type: string; ids: string }) =>
    api.get('/custom-fields/values/batch', { params }),
  setValues: (entityType: string, entityId: string, values: unknown[]) =>
    api.put(`/custom-fields/values/${entityType}/${entityId}`, { values }),
  resetData: (password: string) => api.post('/custom-fields/reset-data', { password }),
};

// ECR API
export const ecrApi = {
  list: (params?: ECRListParams) =>
    api.get('/ecrs/', { params }),
  get: (id: string) =>
    api.get(`/ecrs/${id}?t=${Date.now()}`),
  create: (data: ECRCreateData) =>
    api.post('/ecrs/', data),
  update: (id: string, data: Partial<ECRCreateData>) =>
    api.put(`/ecrs/${id}`, data),
  delete: (id: string) =>
    api.delete(`/ecrs/${id}`),
  submit: (id: string) =>
    api.post(`/ecrs/${id}/submit`),
  withdraw: (id: string) =>
    api.post(`/ecrs/${id}/withdraw`),
  review: (id: string, decision: string, comment?: string) =>
    api.post(`/ecrs/${id}/review`, { decision, comment }),
  close: (id: string, comment?: string) =>
    api.post(`/ecrs/${id}/close`, { comment }),
  addAffectedItem: (ecrId: string, data: { entity_type: string; entity_id: string; change_description?: string; change_type?: string }) =>
    api.post(`/ecrs/${ecrId}/affected-items`, data),
  removeAffectedItem: (ecrId: string, itemId: string) =>
    api.delete(`/ecrs/${ecrId}/affected-items/${itemId}`),
  getStatusLogs: (ecrId: string) =>
    api.get(`/ecrs/${ecrId}/status-logs`),
  bomTrace: (ecrId: string, entityType: string, entityId: string) =>
    api.post(`/ecrs/${ecrId}/bom-trace/${entityType}/${entityId}`),
  updateAffectedItem: (ecrId: string, itemId: string, data: unknown) =>
    api.put(`/ecrs/${ecrId}/affected-items/${itemId}`, data),
  cc: (ecrId: string, userIds: string[]) =>
    api.post(`/ecrs/${ecrId}/cc`, { user_ids: userIds }),
  uncc: (ecrId: string, userId: string) =>
    api.delete(`/ecrs/${ecrId}/cc/${userId}`),
};

export default api;

// ECO API
export const ecoApi = {
  list: (params: { page?: number; page_size?: number; search?: string; status?: string; priority?: string }) =>
    api.get('/ecos/', { params }),
  detail: (id: string) =>
    api.get(`/ecos/${id}?t=${Date.now()}`),
  create: (data: unknown) =>
    api.post('/ecos/', data),
  update: (id: string, data: unknown) =>
    api.put(`/ecos/${id}`, data),
  delete: (id: string) =>
    api.delete(`/ecos/${id}`),
  submit: (id: string) =>
    api.post(`/ecos/${id}/submit`),
  withdraw: (id: string) =>
    api.post(`/ecos/${id}/withdraw`),
  review: (id: string, decision: string, comment?: string) =>
    api.post(`/ecos/${id}/review`, { decision, comment }),
  close: (id: string, comment?: string) =>
    api.post(`/ecos/${id}/close`, { comment }),
  startExecution: (id: string) =>
    api.post(`/ecos/${id}/execute`),
  completeExecution: (id: string) =>
    api.post(`/ecos/${id}/complete`),
  executeItem: (ecoId: string, itemId: string) =>
    api.post(`/ecos/${ecoId}/execute-item/${itemId}`),
  upgradeItem: (ecoId: string, itemId: string) =>
    api.post(`/ecos/${ecoId}/execution-items/${itemId}/upgrade`),
  releaseItem: (ecoId: string, itemId: string, newEntityId?: string) =>
    api.post(`/ecos/${ecoId}/execution-items/${itemId}/release`, newEntityId ? { new_entity_id: newEntityId } : undefined),
  freezeItem: (ecoId: string, itemId: string, newEntityId?: string) =>
    api.post(`/ecos/${ecoId}/execution-items/${itemId}/freeze`, newEntityId ? { new_entity_id: newEntityId } : undefined),
  revertItem: (ecoId: string, itemId: string, newEntityId?: string) =>
    api.post(`/ecos/${ecoId}/execution-items/${itemId}/revert`, newEntityId ? { new_entity_id: newEntityId } : undefined),
  publishAllReleaseItems: (ecoId: string) =>
    api.post(`/ecos/${ecoId}/release-items/publish-all`),
  getReleaseItemsPublishStatus: (ecoId: string) =>
    api.get(`/ecos/${ecoId}/release-items/publish-status`),
  executeAll: (id: string) =>
    api.post(`/ecos/${id}/execute-all`),
  getExecutionItems: (ecoId: string) =>
    api.get(`/ecos/${ecoId}/execution-items`),
  addExecutionItem: (ecoId: string, data: unknown) =>
    api.post(`/ecos/${ecoId}/execution-items`, data),
  updateExecutionItem: (ecoId: string, itemId: string, data: unknown) =>
    api.put(`/ecos/${ecoId}/execution-items/${itemId}`, data),
  deleteExecutionItem: (ecoId: string, itemId: string) =>
    api.delete(`/ecos/${ecoId}/execution-items/${itemId}`),
  getStatusLogs: (ecoId: string) =>
    api.get(`/ecos/${ecoId}/status-logs`),
  cc: (ecoId: string, userIds: string[]) =>
    api.post(`/ecos/${ecoId}/cc`, { user_ids: userIds }),
  uncc: (ecoId: string, userId: string) =>
    api.delete(`/ecos/${ecoId}/cc/${userId}`),
  bomTrace: (ecoId: string, entityType: string, entityId: string) =>
    api.post(`/ecos/${ecoId}/bom-trace/${entityType}/${entityId}`),
};

// ──────────────────────────────────────────
// 构型项管理 API
// ──────────────────────────────────────────

export const configurationApi = {
  listItems: (params?: any) =>
    api.get('/configurations/items', { params }),
  getItem: (id: string) =>
    api.get(`/configurations/items/${id}`),
  createItem: (data: { code: string; name: string; spec?: string; remark?: string }) =>
    api.post('/configurations/items', data),
  updateItem: (id: string, data: Record<string, unknown>) =>
    api.put(`/configurations/items/${id}`, data),
  deleteItem: (id: string) =>
    api.delete(`/configurations/items/${id}`),

  addParts: (id: string, items: { part_type: string; part_id: string; is_required: boolean }[]) =>
    api.post(`/configurations/items/${id}/parts`, { items }),
  updatePart: (id: string, partId: string, data: { is_required?: boolean }) =>
    api.put(`/configurations/items/${id}/parts/${partId}`, data),
  removePart: (id: string, partId: string) =>
    api.delete(`/configurations/items/${id}/parts/${partId}`),

  addChildren: (id: string, items: { child_id: string; is_required: boolean }[]) =>
    api.post(`/configurations/items/${id}/children`, { items }),
  updateChild: (id: string, childId: string, data: { is_required?: boolean }) =>
    api.put(`/configurations/items/${id}/children/${childId}`, data),
  removeChild: (id: string, childId: string) =>
    api.delete(`/configurations/items/${id}/children/${childId}`),
};

// ──────────────────────────────────────────
// 构型配置 API
// ──────────────────────────────────────────

export const configurationProfileApi = {
  list: (params?: { page?: number; page_size?: number; search?: string; status?: string }) =>
    api.get('/configurations/profiles', { params }),

  get: (id: string) =>
    api.get(`/configurations/profiles/${id}`),

  create: (data: {
    code: string; name: string; configuration_item_id?: string;
    effectivity_start?: string; effectivity_end?: string; remark?: string;
  }) =>
    api.post('/configurations/profiles', data),

  update: (id: string, data: {
    code?: string; name?: string; configuration_item_id?: string | null;
    effectivity_start?: string; effectivity_end?: string; remark?: string;
  }) =>
    api.put(`/configurations/profiles/${id}`, data),

  delete: (id: string) =>
    api.delete(`/configurations/profiles/${id}`),

  submit: (id: string) =>
    api.post(`/configurations/profiles/${id}/submit`).then(r => r.data),

  withdraw: (id: string, comment = '') =>
    api.post(`/configurations/profiles/${id}/withdraw`, { comment }).then(r => r.data),

  review: (id: string, decision: 'approved' | 'rejected' | 'returned', comment = '') =>
    api.post(`/configurations/profiles/${id}/review`, { decision, comment }).then(r => r.data),

  reopen: (id: string) =>
    api.post(`/configurations/profiles/${id}/reopen`).then(r => r.data),

  archive: (id: string) =>
    api.post(`/configurations/profiles/${id}/archive`).then(r => r.data),

  updateItem: (profileId: string, itemId: string, data: { is_selected: boolean }) =>
    api.put(`/configurations/profiles/${profileId}/items/${itemId}`, data),

  restoreChecklist: (
    profileId: string,
    items: { item_type: string; item_code: string; source_ci_code: string; is_selected: boolean }[],
  ) =>
    api.put(`/configurations/profiles/${profileId}/restore-checklist`, { items }),

  toggleConfigNode: (profileId: string, configItemId: string) =>
    api.put(`/configurations/profiles/${profileId}/config-items/${configItemId}/toggle`),

  regenerate: (profileId: string) =>
    api.post(`/configurations/profiles/${profileId}/regenerate`),

  statusLogs: (id: string) =>
    api.get(`/configurations/profiles/${id}/status-logs`).then(r => r.data),

  addCc: (id: string, user_id: string, user_name = '') =>
    api.post(`/configurations/profiles/${id}/cc`, { user_id, user_name }).then(r => r.data),

  removeCc: (id: string, userId: string) =>
    api.delete(`/configurations/profiles/${id}/cc/${userId}`).then(r => r.data),

  updateStatus: (profileId: string, status: string) =>
    api.put(`/configurations/profiles/${profileId}/status`, { status }),
};
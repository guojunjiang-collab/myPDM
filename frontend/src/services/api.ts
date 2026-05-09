import axios, { AxiosError } from 'axios';
import { useAuthStore } from '../stores/auth';

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

// 响应拦截器：统一错误处理
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
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
  list: (params?: { page?: number; page_size?: number; search?: string; status?: string }) =>
    api.get('/parts/', { params }),
  get: (id: string) => api.get(`/parts/${id}`),
  create: (data: unknown) => api.post('/parts/', data),
  update: (id: string, data: unknown) => api.put(`/parts/${id}`, data),
  delete: (id: string) => api.delete(`/parts/${id}`),
  exportExcel: (params?: { status?: string }) =>
    api.get('/parts/export', { params, responseType: 'blob' }),
};

// 部件 API
export const assembliesApi = {
  list: (params?: { page?: number; page_size?: number; search?: string; status?: string }) =>
    api.get('/assemblies/', { params }),
  get: (id: string) => api.get(`/assemblies/${id}`),
  create: (data: unknown) => api.post('/assemblies/', data),
  update: (id: string, data: unknown) => api.put(`/assemblies/${id}`, data),
  delete: (id: string) => api.delete(`/assemblies/${id}`),
  exportBOM: (id: string) =>
    api.get(`/assemblies/${id}/bom/export`, { responseType: 'blob' }),
};

// 图文档 API
export const documentsApi = {
  list: (params?: { page?: number; page_size?: number; search?: string; status?: string }) =>
    api.get('/documents/', { params }),
  get: (id: string) => api.get(`/documents/${id}`),
  create: (data: unknown) => api.post('/documents/', data),
  update: (id: string, data: unknown) => api.put(`/documents/${id}`, data),
  delete: (id: string) => api.delete(`/documents/${id}`),
  // 图文档附件
  uploadAttachment: (docId: string, data: { id?: string; file_name: string; file_data: string }) =>
    api.post(`/documents/${docId}/attachments`, data),
  listAttachments: (docId: string) => api.get(`/documents/${docId}/attachments/`),
  getAttachment: (docId: string, attId: string) => api.get(`/documents/${docId}/attachments/${attId}`),
  deleteAttachment: (docId: string, attId: string) => api.delete(`/documents/${docId}/attachments/${attId}`),
};

// BOM API
export const bomApi = {
  getTree: (type: 'part' | 'assembly', id: string) =>
    api.get(`/bom/tree/${type}/${id}`),
  getAllItems: () => api.get('/bom/items/all'),
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
  list: (params?: { page?: number; page_size?: number; search?: string }) =>
    api.get('/users/', { params }),
  get: (id: string) => api.get(`/users/${id}`),
  create: (data: unknown) => api.post('/users/', data),
  update: (id: string, data: unknown) => api.put(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
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
  /** 取消共享 */
  removeShare: (folderId: string, shareId: string) =>
    api.delete(`/dashboard/folders/${folderId}/shares/${shareId}`),
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
  list: (entityType: 'part' | 'assembly', entityId: string) =>
    api.get(`/${entityType === 'part' ? 'parts' : 'assemblies'}/${entityId}/documents`),
  add: (entityType: 'part' | 'assembly', entityId: string, data: { document_id: string; category?: string; sort_order?: number }) =>
    api.post(`/${entityType === 'part' ? 'parts' : 'assemblies'}/${entityId}/documents`, data),
  update: (entityType: 'part' | 'assembly', entityId: string, edocId: string, data: { category?: string; sort_order?: number }) =>
    api.put(`/${entityType === 'part' ? 'parts' : 'assemblies'}/${entityId}/documents/${edocId}`, data),
  remove: (entityType: 'part' | 'assembly', entityId: string, edocId: string) =>
    api.delete(`/${entityType === 'part' ? 'parts' : 'assemblies'}/${entityId}/documents/${edocId}`),
};

// 附件下载
export const attachmentApi = {
  download: (id: string) => api.get(`/v2/attachments/${id}/download`, { responseType: 'blob' }),
};

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
  setValues: (entityType: string, entityId: string, values: unknown[]) =>
    api.put(`/custom-fields/values/${entityType}/${entityId}`, { values }),
  resetData: () => api.post('/custom-fields/reset-data'),
};

export default api;
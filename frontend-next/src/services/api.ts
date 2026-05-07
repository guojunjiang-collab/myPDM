import axios, { AxiosError } from 'axios';
import { useAuthStore } from '../stores/auth';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
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
};

// 附件 API
export const attachmentsApi = {
  upload: (docId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/attachments/upload?doc_id=${docId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  download: (id: string) =>
    api.get(`/attachments/${id}/download`, { responseType: 'blob' }),
  preview: (id: string) => api.get(`/attachments/${id}/preview`, { responseType: 'blob' }),
  delete: (id: string) => api.delete(`/attachments/${id}`),
};

// BOM API
export const bomApi = {
  getTree: (type: 'part' | 'assembly', id: string) =>
    api.get(`/bom/tree/${type}/${id}`),
  createItem: (data: { parent_type: string; parent_id: string; child_type: string; child_id: string; qty: number }) =>
    api.post('/bom/items', data),
  deleteItem: (id: string) => api.delete(`/bom/items/${id}`),
  compare: (type1: string, id1: string, type2: string, id2: string) =>
    api.get('/bom/compare', { params: { type1, id1, type2, id2 } }),
  trace: (type: string, id: string) =>
    api.get('/bom/trace', { params: { type, id } }),
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

// 数据字典 API
export const dictApi = {
  getByType: (type: string) => api.get(`/dict/${type}`),
};

// 自定义字段 API
export const customFieldsApi = {
  list: (entityType?: string) =>
    api.get('/custom_fields/', { params: { entity_type: entityType } }),
  create: (data: unknown) => api.post('/custom_fields/', data),
  update: (id: string, data: unknown) => api.put(`/custom_fields/${id}`, data),
  delete: (id: string) => api.delete(`/custom_fields/${id}`),
};

// 仪表盘 API
export const dashboardApi = {
  getStats: () => api.get('/dashboard/stats'),
};

// 用户看板 API
export const boardApi = {
  getFolders: () => api.get('/dashboard/folders'),
  createFolder: (data: { name: string; parent_id?: string }) =>
    api.post('/dashboard/folders', data),
  updateFolder: (id: string, data: { name: string }) =>
    api.put(`/dashboard/folders/${id}`, data),
  deleteFolder: (id: string) => api.delete(`/dashboard/folders/${id}`),
  getItems: (folderId: string) => api.get(`/dashboard/folders/${folderId}/items`),
  addItem: (folderId: string, data: { item_type: string; item_id: string }) =>
    api.post(`/dashboard/folders/${folderId}/items`, data),
  removeItem: (folderId: string, itemId: string) =>
    api.delete(`/dashboard/folders/${folderId}/items/${itemId}`),
  shareFolder: (id: string, data: { shared: boolean }) =>
    api.put(`/dashboard/folders/${id}/share`, data),
};

export default api;
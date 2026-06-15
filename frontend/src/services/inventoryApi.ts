import axios from 'axios';
import { useAuthStore } from '../stores/auth';

const api = axios.create({ baseURL: '/api/inventory', timeout: 30000 });
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const inventoryApi = {
  // 仓库
  listWarehouses: () => api.get('/warehouses'),
  createWarehouse: (data: any) => api.post('/warehouses', data),
  updateWarehouse: (id: string, data: any) => api.put(`/warehouses/${id}`, data),
  deleteWarehouse: (id: string) => api.delete(`/warehouses/${id}`),
  // 物料
  listMaterials: (params?: { search?: string; source_type?: string; track_mode?: string }) =>
    api.get('/materials', { params }),
  createMaterial: (data: any) => api.post('/materials', data),
  enableFromPdm: (data: any) => api.post('/materials/enable-from-pdm', data),
  updateMaterial: (id: string, data: any) => api.put(`/materials/${id}`, data),
  deleteMaterial: (id: string) => api.delete(`/materials/${id}`),
  // 库存
  listStock: (params?: { material?: string; warehouse_id?: string; low_only?: boolean }) =>
    api.get('/stock', { params }),
  listLedger: (params?: { material_id?: string; warehouse_id?: string; doc_id?: string }) =>
    api.get('/stock/ledger', { params }),
  // 单据
  listDocuments: (params?: { page?: number; page_size?: number; doc_type?: string; status?: string; search?: string }) =>
    api.get('/documents', { params }),
  getDocument: (id: string) => api.get(`/documents/${id}`),
  createDocument: (data: any) => api.post('/documents', data),
  updateDocument: (id: string, data: any) => api.put(`/documents/${id}`, data),
  deleteDocument: (id: string) => api.delete(`/documents/${id}`),
  submit: (id: string) => api.post(`/documents/${id}/submit`),
  withdraw: (id: string) => api.post(`/documents/${id}/withdraw`),
  review: (id: string, data: { decision: string; comment?: string }) => api.post(`/documents/${id}/review`, data),
  assignKeeper: (id: string, keeperId: string) => api.post(`/documents/${id}/assign-keeper`, { keeper_id: keeperId }),
  post: (id: string, data?: { counts?: { line_id: string; counted_quantity: number }[] }) =>
    api.post(`/documents/${id}/post`, data || {}),
  cancel: (id: string) => api.post(`/documents/${id}/cancel`),
};

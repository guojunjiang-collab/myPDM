import axios from 'axios';
import { useAuthStore } from '../stores/auth';

const api = axios.create({ baseURL: '/api/projects', timeout: 30000 });
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const projectApi = {
  listProjects: () => api.get('/'),
  getProject: (id: string) => api.get(`/${id}`),
  createProject: (data: any) => api.post('/', data),
  updateProject: (id: string, data: any) => api.put(`/${id}`, data),
  deleteProject: (id: string) => api.delete(`/${id}`),
  listMembers: (id: string) => api.get(`/${id}/members`),
  addMember: (id: string, data: { user_id: string; role_in_project?: string }) =>
    api.post(`/${id}/members`, data),
  removeMember: (id: string, userId: string) => api.delete(`/${id}/members/${userId}`),
  listTasks: (id: string) => api.get(`/${id}/tasks`),
  createTask: (id: string, data: any) => api.post(`/${id}/tasks`, data),
  updateTask: (id: string, taskId: string, data: any) => api.put(`/${id}/tasks/${taskId}`, data),
  updateTaskStatus: (id: string, taskId: string, status: string) =>
    api.patch(`/${id}/tasks/${taskId}/status`, { status }),
  moveTask: (id: string, taskId: string, data: { parent_id?: string | null; sort_order?: number }) =>
    api.post(`/${id}/tasks/${taskId}/move`, data),
  reorderTask: (id: string, data: { task_id: string; new_parent_id?: string | null; new_sort_order: number }) =>
    api.post(`/${id}/tasks/reorder`, data),
  deleteTask: (id: string, taskId: string) => api.delete(`/${id}/tasks/${taskId}`),
  listLinks: (id: string, taskId: string) => api.get(`/${id}/tasks/${taskId}/links`),
  addLink: (id: string, taskId: string, data: { entity_type: string; entity_id: string }) =>
    api.post(`/${id}/tasks/${taskId}/links`, data),
  removeLink: (id: string, taskId: string, linkId: string) =>
    api.delete(`/${id}/tasks/${taskId}/links/${linkId}`),
  listComments: (id: string, taskId: string) => api.get(`/${id}/tasks/${taskId}/comments`),
  addComment: (id: string, taskId: string, content: string) =>
    api.post(`/${id}/tasks/${taskId}/comments`, { content }),
  deleteComment: (id: string, taskId: string, commentId: string) =>
    api.delete(`/${id}/tasks/${taskId}/comments/${commentId}`),
  getGantt: (id: string) => api.get(`/${id}/gantt`),
  autoSchedule: (id: string) => api.post(`/${id}/auto-schedule`),
  listDeps: (id: string) => api.get(`/${id}/deps`),
  addDep: (id: string, data: { predecessor_id: string; successor_id: string; dep_type?: string; lag_days?: number }) =>
    api.post(`/${id}/deps`, data),
  removeDep: (id: string, depId: string) => api.delete(`/${id}/deps/${depId}`),
};

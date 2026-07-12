import axios from 'axios';
import { useAuthStore } from '../stores/auth';
import type { NotificationListResult } from '../types';

const api = axios.create({ baseURL: '/api', timeout: 30000 });
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const notificationApi = {
  list: (params?: { is_read?: boolean; target_type?: string; page?: number; page_size?: number }) =>
    api.get<NotificationListResult>('/notifications/', { params }).then((r) => r.data),
  unreadCount: () =>
    api.get<{ unread: number }>('/notifications/unread-count').then((r) => r.data.unread),
  markRead: (id: string) => api.post(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => api.post('/notifications/read-all').then((r) => r.data),
  clearRead: () => api.delete('/notifications/read').then((r) => r.data),
};

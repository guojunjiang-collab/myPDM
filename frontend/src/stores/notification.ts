import { create } from 'zustand';
import type { Notification } from '../types';
import { notificationApi } from '../services/notificationApi';

interface NotificationState {
  unread: number;
  recent: Notification[];
  loading: boolean;
  fetchUnread: () => Promise<void>;
  fetchRecent: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  unread: 0,
  recent: [],
  loading: false,
  fetchUnread: async () => {
    try {
      set({ unread: await notificationApi.unreadCount() });
    } catch { /* ignore */ }
  },
  fetchRecent: async () => {
    set({ loading: true });
    try {
      const res = await notificationApi.list({ page: 1, page_size: 10 });
      set({ recent: res.items, unread: res.unread });
    } catch { /* ignore */ } finally {
      set({ loading: false });
    }
  },
  markRead: async (id) => {
    await notificationApi.markRead(id);
    set((s) => ({
      recent: s.recent.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      unread: Math.max(0, s.unread - 1),
    }));
  },
  markAllRead: async () => {
    await notificationApi.markAllRead();
    set((s) => ({ recent: s.recent.map((n) => ({ ...n, is_read: true })), unread: 0 }));
  },
}));

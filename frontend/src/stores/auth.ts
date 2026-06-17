import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';
import { PERMISSIONS, type Permission, type Role } from '../constants/permissions.generated';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setUser: (user: User | null, token: string | null) => void;
  logout: () => void;
  hasRole: (roles: string[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      setUser: (user, token) => set({ user, token, isAuthenticated: !!user }),
      logout: () => { localStorage.removeItem('refresh_token'); set({ user: null, token: null, isAuthenticated: false }); },
      hasRole: (roles) => {
        const { user } = get();
        if (!user) return false;
        return roles.includes(user.role);
      },
    }),
    {
      name: 'auth-storage',
    }
  )
);

// 单一权限判定：角色 × 生成的权限矩阵
export const can = (perm: Permission): boolean => {
  const user = useAuthStore.getState().user;
  if (!user) return false;
  return (PERMISSIONS[perm] as Role[]).includes(user.role as Role);
};

// 旧 helper 改为 can() 薄封装（保持向后兼容）
export const canEdit = () => can('parts:create');
export const canDownload = () => can('parts:export');
export const canPreview = () => true;
export const isAdmin = () => can('parts:delete');
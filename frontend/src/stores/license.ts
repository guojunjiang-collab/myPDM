import { create } from 'zustand';
import type { LicenseStatus } from '../types';
import { licenseApi } from '../services/licenseApi';

interface LicenseState {
  status: LicenseStatus | null;
  loading: boolean;
  fetch: () => Promise<void>;
  setStatus: (s: LicenseStatus) => void;
}

export const useLicenseStore = create<LicenseState>((set) => ({
  status: null,
  loading: false,
  fetch: async () => {
    set({ loading: true });
    try {
      set({ status: await licenseApi.getStatus() });
    } catch {
      /* 状态拉取失败不阻塞页面，后端仍是唯一权威 */
    } finally {
      set({ loading: false });
    }
  },
  setStatus: (status) => set({ status }),
}));

// 非 hook 版，供 Layout 的菜单过滤等非组件上下文使用。
export const hasModule = (module: string): boolean => {
  const status = useLicenseStore.getState().status;
  if (!status) return true;
  return status.modules.includes(module);
};

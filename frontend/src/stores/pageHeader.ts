import { create } from 'zustand';
import type { ReactNode } from 'react';

/**
 * 页面顶栏插槽：页面可把自定义内容（如 Tab 导航）注入 Layout 顶栏左侧，
 * 替代默认的导航标签。未注入时 Layout 回退显示当前导航项标签。
 */
interface PageHeaderState {
  content: ReactNode | null;
  setContent: (content: ReactNode | null) => void;
}

export const usePageHeader = create<PageHeaderState>((set) => ({
  content: null,
  setContent: (content) => set({ content }),
}));

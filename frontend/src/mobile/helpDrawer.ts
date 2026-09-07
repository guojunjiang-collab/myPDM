import { create } from 'zustand';

/** 帮助文档目录抽屉开关（MobileLayout 顶部按钮开，HelpPage 渲染抽屉） */
export const useHelpDrawer = create<{ open: boolean; setOpen: (v: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

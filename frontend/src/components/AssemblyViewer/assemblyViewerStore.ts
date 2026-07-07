import { create } from 'zustand';

interface AssemblyViewerState {
  selectedBomItemId: string | null;
  hiddenBomItemIds: Set<string>;
  isolateMode: boolean;
  selectBomItem: (id: string | null) => void;
  toggleHidden: (id: string) => void;
  setIsolate: (v: boolean) => void;
  reset: () => void;
}

export const useAssemblyStore = create<AssemblyViewerState>((set) => ({
  selectedBomItemId: null,
  hiddenBomItemIds: new Set<string>(),
  isolateMode: true,
  selectBomItem: (id) => set({ selectedBomItemId: id }),
  toggleHidden: (id) => set((s) => {
    const next = new Set(s.hiddenBomItemIds);
    next.has(id) ? next.delete(id) : next.add(id);
    return { hiddenBomItemIds: next };
  }),
  setIsolate: (v) => set({ isolateMode: v }),
  reset: () => set({ selectedBomItemId: null, hiddenBomItemIds: new Set() }),
}));

import { create } from 'zustand';

interface AssemblyViewerState {
  selectedBomItemId: string | null;
  hiddenBomItemIds: Set<string>;
  isolateMode: boolean;
  wireframe: boolean;
  explodeFactor: number;
  selectBomItem: (id: string | null) => void;
  toggleHidden: (id: string) => void;
  setIsolate: (v: boolean) => void;
  setWireframe: (v: boolean) => void;
  setExplodeFactor: (v: number) => void;
  reset: () => void;
}

export const useAssemblyStore = create<AssemblyViewerState>((set) => ({
  selectedBomItemId: null,
  hiddenBomItemIds: new Set<string>(),
  isolateMode: true,
  wireframe: false,
  explodeFactor: 0,
  selectBomItem: (id) => set({ selectedBomItemId: id }),
  toggleHidden: (id) => set((s) => {
    const next = new Set(s.hiddenBomItemIds);
    next.has(id) ? next.delete(id) : next.add(id);
    return { hiddenBomItemIds: next };
  }),
  setIsolate: (v) => set({ isolateMode: v }),
  setWireframe: (v) => set({ wireframe: v }),
  setExplodeFactor: (v) => set({ explodeFactor: v }),
  reset: () => set({ selectedBomItemId: null, hiddenBomItemIds: new Set(), wireframe: false, explodeFactor: 0 }),
}));

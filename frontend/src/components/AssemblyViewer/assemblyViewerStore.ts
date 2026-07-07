import { create } from 'zustand';

interface ClipPlane {
  axis: string;
  position: number;
  flip: boolean;
}

interface AssemblyViewerState {
  selectedBomItemId: string | null;
  hiddenBomItemIds: Set<string>;
  isolateMode: boolean;
  wireframe: boolean;
  explodeFactor: number;
  autoColor: boolean;
  cameraMode: string;
  clipPlanes: ClipPlane[];
  selectBomItem: (id: string | null) => void;
  toggleHidden: (id: string) => void;
  setIsolate: (v: boolean) => void;
  setWireframe: (v: boolean) => void;
  setExplodeFactor: (v: number) => void;
  setAutoColor: (v: boolean) => void;
  setClipPlane: (axis: string, position: number) => void;
  removeClipPlane: (axis: string) => void;
  toggleClipFlip: (axis: string) => void;
  toggleCameraMode: () => void;
  reset: () => void;
}

export const useAssemblyStore = create<AssemblyViewerState>((set) => ({
  selectedBomItemId: null,
  hiddenBomItemIds: new Set<string>(),
  isolateMode: true,
  wireframe: false,
  explodeFactor: 0,
  autoColor: false,
  cameraMode: 'perspective',
  clipPlanes: [],

  selectBomItem: (id) => set({ selectedBomItemId: id }),

  toggleHidden: (id) => set((s) => {
    const next = new Set(s.hiddenBomItemIds);
    next.has(id) ? next.delete(id) : next.add(id);
    return { hiddenBomItemIds: next };
  }),

  setIsolate: (v) => set({ isolateMode: v }),
  setWireframe: (v) => set({ wireframe: v }),
  setExplodeFactor: (v) => set({ explodeFactor: v }),
  setAutoColor: (v) => set({ autoColor: v }),

  setClipPlane: (axis, position) => set((s) => {
    const existing = s.clipPlanes.findIndex((p) => p.axis === axis);
    const next = [...s.clipPlanes];
    if (existing >= 0) {
      next[existing] = { ...next[existing], position };
    } else {
      next.push({ axis, position, flip: false });
    }
    return { clipPlanes: next };
  }),

  removeClipPlane: (axis) => set((s) => ({
    clipPlanes: s.clipPlanes.filter((p) => p.axis !== axis),
  })),

  toggleClipFlip: (axis) => set((s) => ({
    clipPlanes: s.clipPlanes.map((p) =>
      p.axis === axis ? { ...p, flip: !p.flip } : p
    ),
  })),

  toggleCameraMode: () => set((s) => ({
    cameraMode: s.cameraMode === 'orthographic' ? 'perspective' : 'orthographic',
  })),

  reset: () => set({
    selectedBomItemId: null,
    hiddenBomItemIds: new Set(),
    wireframe: false,
    explodeFactor: 0,
    autoColor: false,
    clipPlanes: [],
  }),
}));

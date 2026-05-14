import { create } from 'zustand';

export interface ViewerState {
  // 模型状态
  modelUrl: string | null;
  loadingState: 'idle' | 'converting' | 'loading' | 'ready' | 'error';
  errorMessage: string;

  // 零件交互
  selectedPartId: string | null;
  highlightedPartId: string | null;
  visibleParts: Set<string>;

  // 视图
  clipPlanes: { axis: 'x' | 'y' | 'z'; position: number }[];
  measureMode: 'off' | 'distance' | 'angle';
  explodeDistance: number;
  wireframe: boolean;

  // Actions
  setModelUrl: (url: string | null) => void;
  setLoadingState: (state: ViewerState['loadingState'], msg?: string) => void;
  selectPart: (id: string | null) => void;
  highlightPart: (id: string | null) => void;
  togglePartVisibility: (id: string) => void;
  setClipPlane: (axis: 'x' | 'y' | 'z', position: number) => void;
  removeClipPlane: (axis: 'x' | 'y' | 'z') => void;
  setMeasureMode: (mode: ViewerState['measureMode']) => void;
  setExplodeDistance: (d: number) => void;
  toggleWireframe: () => void;
  reset: () => void;
}

const initialState = {
  modelUrl: null as string | null,
  loadingState: 'idle' as const,
  errorMessage: '',
  selectedPartId: null as string | null,
  highlightedPartId: null as string | null,
  visibleParts: new Set<string>(),
  clipPlanes: [] as { axis: 'x' | 'y' | 'z'; position: number }[],
  measureMode: 'off' as const,
  explodeDistance: 0,
  wireframe: false,
};

export const useViewerStore = create<ViewerState>((set, get) => ({
  ...initialState,

  setModelUrl: (url) => set({ modelUrl: url }),
  setLoadingState: (state, msg = '') =>
    set({ loadingState: state, errorMessage: msg }),

  selectPart: (id) => set({ selectedPartId: id }),
  highlightPart: (id) => set({ highlightedPartId: id }),

  togglePartVisibility: (id) => {
    const visible = new Set(get().visibleParts);
    if (visible.has(id)) visible.delete(id);
    else visible.add(id);
    set({ visibleParts: visible });
  },

  setClipPlane: (axis, position) => {
    const planes = get().clipPlanes.filter((p) => p.axis !== axis);
    set({ clipPlanes: [...planes, { axis, position }] });
  },

  removeClipPlane: (axis) => {
    set({ clipPlanes: get().clipPlanes.filter((p) => p.axis !== axis) });
  },

  setMeasureMode: (mode) => set({ measureMode: mode }),
  setExplodeDistance: (d) => set({ explodeDistance: d }),
  toggleWireframe: () => set({ wireframe: !get().wireframe }),

  reset: () => set({ ...initialState, visibleParts: new Set() }),
}));

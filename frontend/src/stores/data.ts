import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Part, PartBrief, Assembly, AssemblyBrief, Document, DocumentBrief, CustomFieldDefinition, BOMItemBrief, ECRBrief, ECOBrief, ConfigItemBrief } from '../types';
import { partsApi, assembliesApi, documentsApi, customFieldsApi, configurationApi } from '../services/api';

function extractData<T>(response: any): T[] {
  return Array.isArray(response) ? response : (response?.items || []);
}

interface DataState {
  // 列表字段 (brief, 同步用)
  parts: PartBrief[];
  assemblies: AssemblyBrief[];
  documents: DocumentBrief[];
  customFieldDefs: CustomFieldDefinition[];
  // 新增实体
  bomItems: BOMItemBrief[];
  ecrs: ECRBrief[];
  ecos: ECOBrief[];
  configItems: ConfigItemBrief[];

  lastSyncTime: number;
  isSyncing: boolean;
  syncError: string | null;
  autoSyncEnabled: boolean;

  // Setters
  setParts: (parts: PartBrief[]) => void;
  setAssemblies: (assemblies: AssemblyBrief[]) => void;
  setDocuments: (documents: DocumentBrief[]) => void;
  setCustomFieldDefs: (defs: CustomFieldDefinition[]) => void;
  setBomItems: (items: BOMItemBrief[]) => void;
  setEcrs: (ecrs: ECRBrief[]) => void;
  setEcos: (ecos: ECOBrief[]) => void;
  setConfigItems: (items: ConfigItemBrief[]) => void;

  // 更新方法（按需加载完整字段后更新 store）
  updatePart: (id: string, data: Partial<Part>) => void;
  updateAssembly: (id: string, data: Partial<Assembly>) => void;
  updateDocument: (id: string, data: Partial<Document>) => void;

  // Sync 控制
  setSyncing: (syncing: boolean) => void;
  setSyncError: (error: string | null) => void;
  setLastSyncTime: (time: number) => void;
  setAutoSyncEnabled: (enabled: boolean) => void;
  clearCache: () => void;
  syncAll: () => Promise<void>;
}

export const useDataStore = create<DataState>()(
  persist(
    (set) => ({
      parts: [],
      assemblies: [],
      documents: [],
      customFieldDefs: [],
      bomItems: [],
      ecrs: [],
      ecos: [],
      configItems: [],
      lastSyncTime: 0,
      isSyncing: false,
      syncError: null,
      autoSyncEnabled: true,

      setParts: (parts) => set({ parts }),
      setAssemblies: (assemblies) => set({ assemblies }),
      setDocuments: (documents) => set({ documents }),
      setCustomFieldDefs: (defs) => set({ customFieldDefs: defs }),
      setBomItems: (bomItems) => set({ bomItems }),
      setEcrs: (ecrs) => set({ ecrs }),
      setEcos: (ecos) => set({ ecos }),
      setConfigItems: (configItems) => set({ configItems }),

      updatePart: (id, data) =>
        set((state) => ({
          parts: state.parts.map((p) =>
            p.id === id ? { ...p, ...data } : p
          ),
        })),
      updateAssembly: (id, data) =>
        set((state) => ({
          assemblies: state.assemblies.map((a) =>
            a.id === id ? { ...a, ...data } : a
          ),
        })),
      updateDocument: (id, data) =>
        set((state) => ({
          documents: state.documents.map((d) =>
            d.id === id ? { ...d, ...data } : d
          ),
        })),

      setSyncing: (syncing) => set({ isSyncing: syncing }),
      setSyncError: (error) => set({ syncError: error }),
      setLastSyncTime: (time) => set({ lastSyncTime: time }),
      setAutoSyncEnabled: (autoSyncEnabled) => set({ autoSyncEnabled }),

      clearCache: () =>
        set({
          parts: [],
          assemblies: [],
          documents: [],
          customFieldDefs: [],
          bomItems: [],
          ecrs: [],
          ecos: [],
          configItems: [],
          lastSyncTime: 0,
        }),

      syncAll: async () => {
        set({ isSyncing: true, syncError: null });
        try {
          const [partsRes, assembliesRes, documentsRes, fieldsRes, configRes] = await Promise.allSettled([
            partsApi.list({ page_size: 10000, brief: true }),
            assembliesApi.list({ page_size: 10000, brief: true }),
            documentsApi.list({ page_size: 10000, brief: true }),
            customFieldsApi.listDefinitions(),
            configurationApi.listItems({ page_size: 10000 }),
          ]);

          set({
            parts: partsRes.status === 'fulfilled' ? extractData<PartBrief>(partsRes.value.data) : [],
            assemblies: assembliesRes.status === 'fulfilled' ? extractData<AssemblyBrief>(assembliesRes.value.data) : [],
            documents: documentsRes.status === 'fulfilled' ? extractData<DocumentBrief>(documentsRes.value.data) : [],
            customFieldDefs: fieldsRes.status === 'fulfilled' ? extractData<CustomFieldDefinition>(fieldsRes.value.data) : [],
            configItems: configRes.status === 'fulfilled' ? extractData<ConfigItemBrief>(configRes.value.data) : [],
            lastSyncTime: Math.floor(Date.now() / 1000),
            isSyncing: false,
          });
        } catch (e: any) {
          set({ syncError: e.message || 'Sync failed', isSyncing: false });
        }
      },
    }),
    {
      name: 'data-storage',
      partialize: (state) => ({
        parts: state.parts,
        assemblies: state.assemblies,
        documents: state.documents,
        customFieldDefs: state.customFieldDefs,
        bomItems: state.bomItems,
        ecrs: state.ecrs,
        ecos: state.ecos,
        configItems: state.configItems,
        lastSyncTime: state.lastSyncTime,
        autoSyncEnabled: state.autoSyncEnabled,
      }),
    }
  )
);

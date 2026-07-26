import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PartListItem, Document, DocumentBrief, CustomFieldDefinition, BOMItemBrief, ECRBrief, ECOBrief, ConfigItemBrief } from '../types';
import { partsApi, documentsApi, customFieldsApi, configurationApi } from '../services/api';

function extractData<T>(response: any): T[] {
  return Array.isArray(response) ? response : (response?.items || []);
}

interface DataState {
  parts: any[];
  documents: DocumentBrief[];
  customFieldDefs: CustomFieldDefinition[];
  bomItems: BOMItemBrief[];
  ecrs: ECRBrief[];
  ecos: ECOBrief[];
  configItems: ConfigItemBrief[];

  lastSyncTime: number;
  isSyncing: boolean;
  syncError: string | null;
  autoSyncEnabled: boolean;

  setParts: (parts: any[]) => void;
  setDocuments: (documents: DocumentBrief[]) => void;
  setCustomFieldDefs: (defs: CustomFieldDefinition[]) => void;
  setBomItems: (items: BOMItemBrief[]) => void;
  setEcrs: (ecrs: ECRBrief[]) => void;
  setEcos: (ecos: ECOBrief[]) => void;
  setConfigItems: (items: ConfigItemBrief[]) => void;

  updatePart: (id: string, data: any) => void;
  updateDocument: (id: string, data: Partial<Document>) => void;

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
      setDocuments: (documents) => set({ documents }),
      setCustomFieldDefs: (defs) => set({ customFieldDefs: defs }),
      setBomItems: (bomItems) => set({ bomItems }),
      setEcrs: (ecrs) => set({ ecrs }),
      setEcos: (ecos) => set({ ecos }),
      setConfigItems: (configItems) => set({ configItems }),

      updatePart: (id, data) =>
        set((state) => ({
          parts: state.parts.map((c) =>
            c.revision_id === id ? { ...c, ...data } : c
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
          const [partsRes, documentsRes, fieldsRes, configRes] = await Promise.allSettled([
            partsApi.list({ page_size: 10000, show_all_versions: true }),
            documentsApi.list({ page_size: 10000, show_all_versions: true }),
            customFieldsApi.listDefinitions(),
            configurationApi.listItems({ page_size: 10000 }),
          ]);

          set({
            // partsApi.list 已解包为 payload（{items,total}），不再有 .data 层
            parts: partsRes.status === 'fulfilled' ? extractData<PartListItem>(partsRes.value) : [],
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

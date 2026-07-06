import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PartListItem, Document, DocumentBrief, CustomFieldDefinition, BOMItemBrief, ECRBrief, ECOBrief, ConfigItemBrief } from '../types';
import { partsApi, documentsApi, customFieldsApi, configurationApi } from '../services/api';

function extractData<T>(response: any): T[] {
  return Array.isArray(response) ? response : (response?.items || []);
}

interface DataState {
  components: any[];
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

  setComponents: (components: any[]) => void;
  setDocuments: (documents: DocumentBrief[]) => void;
  setCustomFieldDefs: (defs: CustomFieldDefinition[]) => void;
  setBomItems: (items: BOMItemBrief[]) => void;
  setEcrs: (ecrs: ECRBrief[]) => void;
  setEcos: (ecos: ECOBrief[]) => void;
  setConfigItems: (items: ConfigItemBrief[]) => void;

  updateComponent: (id: string, data: any) => void;
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
      components: [],
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

      setComponents: (components) => set({ components }),
      setDocuments: (documents) => set({ documents }),
      setCustomFieldDefs: (defs) => set({ customFieldDefs: defs }),
      setBomItems: (bomItems) => set({ bomItems }),
      setEcrs: (ecrs) => set({ ecrs }),
      setEcos: (ecos) => set({ ecos }),
      setConfigItems: (configItems) => set({ configItems }),

      updateComponent: (id, data) =>
        set((state) => ({
          components: state.components.map((c) =>
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
          components: [],
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
          const [componentsRes, documentsRes, fieldsRes, configRes] = await Promise.allSettled([
            partsApi.list({ page_size: 10000, show_all_versions: true }),
            documentsApi.list({ page_size: 10000, brief: true }),
            customFieldsApi.listDefinitions(),
            configurationApi.listItems({ page_size: 10000 }),
          ]);

          set({
            components: componentsRes.status === 'fulfilled' ? extractData<PartListItem>(componentsRes.value.data) : [],
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
        components: state.components,
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

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Part, Assembly, Document, CustomFieldDefinition } from '../types';
import { partsApi, assembliesApi, documentsApi, customFieldsApi } from '../services/api';

function extractData<T>(response: any): T[] {
  return Array.isArray(response) ? response : (response?.items || []);
}

interface DataState {
  parts: Part[];
  assemblies: Assembly[];
  documents: Document[];
  customFieldDefs: CustomFieldDefinition[];
  lastSyncTime: number;
  isSyncing: boolean;
  syncError: string | null;
  setParts: (parts: Part[]) => void;
  setAssemblies: (assemblies: Assembly[]) => void;
  setDocuments: (documents: Document[]) => void;
  setCustomFieldDefs: (defs: CustomFieldDefinition[]) => void;
  setSyncing: (syncing: boolean) => void;
  setSyncError: (error: string | null) => void;
  setLastSyncTime: (time: number) => void;
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
      lastSyncTime: 0,
      isSyncing: false,
      syncError: null,
      setParts: (parts) => set({ parts }),
      setAssemblies: (assemblies) => set({ assemblies }),
      setDocuments: (documents) => set({ documents }),
      setCustomFieldDefs: (defs) => set({ customFieldDefs: defs }),
      setSyncing: (syncing) => set({ isSyncing: syncing }),
      setSyncError: (error) => set({ syncError: error }),
      setLastSyncTime: (time) => set({ lastSyncTime: time }),
      clearCache: () =>
        set({
          parts: [],
          assemblies: [],
          documents: [],
          customFieldDefs: [],
          lastSyncTime: 0,
        }),

      syncAll: async () => {
        set({ isSyncing: true, syncError: null });
        try {
          const [partsRes, assembliesRes, documentsRes, fieldsRes] = await Promise.allSettled([
            partsApi.list({ page_size: 10000 }),
            assembliesApi.list({ page_size: 10000 }),
            documentsApi.list({ page_size: 10000 }),
            customFieldsApi.listDefinitions(),
          ]);

          set({
            parts: partsRes.status === 'fulfilled' ? extractData<Part>(partsRes.value.data) : [],
            assemblies: assembliesRes.status === 'fulfilled' ? extractData<Assembly>(assembliesRes.value.data) : [],
            documents: documentsRes.status === 'fulfilled' ? extractData<Document>(documentsRes.value.data) : [],
            customFieldDefs: fieldsRes.status === 'fulfilled' ? extractData<CustomFieldDefinition>(fieldsRes.value.data) : [],
            lastSyncTime: Date.now(),
            isSyncing: false,
          });
        } catch (error) {
          set({ isSyncing: false, syncError: '同步失败，请重试' });
          throw error;
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
        lastSyncTime: state.lastSyncTime,
      }),
    }
  )
);
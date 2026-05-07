import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Part, Assembly, Document, CustomFieldDef } from '../types';

interface DataState {
  parts: Part[];
  assemblies: Assembly[];
  documents: Document[];
  customFieldDefs: CustomFieldDef[];
  lastSyncTime: number;
  isSyncing: boolean;
  setParts: (parts: Part[]) => void;
  setAssemblies: (assemblies: Assembly[]) => void;
  setDocuments: (documents: Document[]) => void;
  setCustomFieldDefs: (defs: CustomFieldDef[]) => void;
  setSyncing: (syncing: boolean) => void;
  setLastSyncTime: (time: number) => void;
  clearCache: () => void;
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
      setParts: (parts) => set({ parts }),
      setAssemblies: (assemblies) => set({ assemblies }),
      setDocuments: (documents) => set({ documents }),
      setCustomFieldDefs: (defs) => set({ customFieldDefs: defs }),
      setSyncing: (syncing) => set({ isSyncing: syncing }),
      setLastSyncTime: (time) => set({ lastSyncTime: time }),
      clearCache: () =>
        set({
          parts: [],
          assemblies: [],
          documents: [],
          customFieldDefs: [],
          lastSyncTime: 0,
        }),
    }),
    {
      name: 'data-storage',
    }
  )
);
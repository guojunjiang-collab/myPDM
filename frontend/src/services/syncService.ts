import { useDataStore } from '../stores/data';
import { syncApi } from './syncApi';
import { partsApi, assembliesApi, documentsApi, bomApi, configurationApi } from './api';
import type { SyncStatus, Part, Assembly, Document, BOMItem, ConfigItemBrief } from '../types';

interface SyncEntity {
  name: string;
  key: keyof SyncStatus;
  fetch: (since: number) => Promise<any[]>;
  merge: (items: any[]) => void;
}

/**
 * Build entity configurations mapping entity names to their
 * fetch and merge strategies.
 *
 * Merge logic: for each delta item, handle delete (deleted_at)
 * or upsert (update existing by id, add new).
 */
function buildEntities(): SyncEntity[] {
  return [
    {
      name: 'parts',
      key: 'parts',
      fetch: async (since: number) => {
        const res = await partsApi.list({
          updated_since: since,
          page_size: 10000,
          brief: true,
        } as any);
        return Array.isArray(res.data)
          ? res.data
          : res.data?.items || [];
      },
      merge: (items: Part[]) => {
        const store = useDataStore.getState();
        const current = [...store.parts];
        mergeItems(current, items as any[]);
        store.setParts(current);
      },
    },
    {
      name: 'assemblies',
      key: 'assemblies',
      fetch: async (since: number) => {
        const res = await assembliesApi.list({
          updated_since: since,
          page_size: 10000,
          brief: true,
        } as any);
        return Array.isArray(res.data)
          ? res.data
          : res.data?.items || [];
      },
      merge: (items: Assembly[]) => {
        const store = useDataStore.getState();
        const current = [...store.assemblies];
        mergeItems(current, items as any[]);
        store.setAssemblies(current);
      },
    },
    {
      name: 'documents',
      key: 'documents',
      fetch: async (since: number) => {
        const res = await documentsApi.list({
          updated_since: since,
          page_size: 10000,
          brief: true,
        } as any);
        return Array.isArray(res.data)
          ? res.data
          : res.data?.items || [];
      },
      merge: (items: Document[]) => {
        const store = useDataStore.getState();
        const current = [...store.documents];
        mergeItems(current, items as any[]);
        store.setDocuments(current);
      },
    },
    {
      name: 'bom_items',
      key: 'bom_items',
      fetch: async (since: number) => {
        const res = await bomApi.getAll({
          updated_since: since,
        } as any);
        return Array.isArray(res.data) ? res.data : [];
      },
      merge: (items: BOMItem[]) => {
        // NOTE: BOM items are not yet cached in the store.
        // Store support will be added in Phase 3.
        // For now, silently skip — BOM items are fetched on-demand.
        void items;
      },
    },
    {
      name: 'config_items',
      key: 'config_items',
      fetch: async (since: number) => {
        const res = await configurationApi.listItems({
          updated_since: since,
          page_size: 10000,
        });
        return Array.isArray(res.data)
          ? res.data
          : res.data?.items || [];
      },
      merge: (items: ConfigItemBrief[]) => {
        const store = useDataStore.getState();
        const current = [...store.configItems];
        mergeItems(current, items as any[]);
        store.setConfigItems(current);
      },
    },
  ];
}

/**
 * Merge delta items into a current array in-place.
 * Handles: new items (push), updated items (replace by id),
 * and deleted items (splice by id when deleted_at is set).
 */
function mergeItems<T extends { id: string }>(
  current: T[],
  delta: Array<T & { deleted_at?: string | null }>
): void {
  for (const item of delta) {
    const idx = current.findIndex((e) => e.id === item.id);
    if (item.deleted_at) {
      if (idx >= 0) current.splice(idx, 1);
    } else if (idx >= 0) {
      current[idx] = { ...current[idx], ...item };
    } else {
      current.push(item as T);
    }
  }
}

class SyncService {
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Per-entity last-sync timestamps (server max timestamps) */
  private lastSync: SyncStatus = {
    parts: 0,
    assemblies: 0,
    documents: 0,
    bom_items: 0,
    ecrs: 0,
    ecos: 0,
    config_items: 0,
  };

  async start() {
    const store = useDataStore.getState();

    // Trigger initial full pull if store is empty or configItems not yet synced (migration)
    const needsInitialSync =
      (store.parts.length === 0 &&
       store.assemblies.length === 0 &&
       store.documents.length === 0) ||
      store.configItems.length === 0;
    if (needsInitialSync) {
      store.setSyncing(true);
      try {
        await store.syncAll();
        store.setLastSyncTime(Date.now() / 1000);
      } catch (e) {
        store.setSyncError('初始同步失败');
      } finally {
        store.setSyncing(false);
      }
    }

    // Start 10s polling
    this.poll();
    this.timer = setInterval(() => this.poll(), 10000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll() {
    const store = useDataStore.getState();

    try {
      const res = await syncApi.getStatus();
      const serverTime: SyncStatus = res.data;

      const entities = buildEntities();
      let hasChanges = false;

      for (const entity of entities) {
        const serverTs = serverTime[entity.key] || 0;
        const localTs = this.lastSync[entity.key] || 0;

        if (serverTs > localTs) {
          try {
            if (!hasChanges) {
              hasChanges = true;
              store.setSyncing(true);
            }
            const items = await entity.fetch(localTs);
            entity.merge(items);
            this.lastSync[entity.key] = serverTs;
          } catch (e) {
            // Silently skip failed entities, retry next cycle
            console.warn(`Sync: failed to fetch ${entity.name}`, e);
          }
        }
      }

      if (hasChanges) {
        store.setLastSyncTime(Date.now() / 1000);
      }
    } catch (e) {
      store.setSyncError('同步失败，稍后重试');
    } finally {
      store.setSyncing(false);
    }
  }
}

export const syncService = new SyncService();

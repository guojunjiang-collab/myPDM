import { create } from 'zustand';
import { inventoryApi } from '../services/inventoryApi';
import { usersApi } from '../services/api';
import type { Warehouse, InvMaterial } from '../types';

interface InvState {
  warehouses: Warehouse[];
  materials: InvMaterial[];
  users: { id: string; real_name: string; role: string }[];
  loadWarehouses: () => Promise<void>;
  loadMaterials: (search?: string) => Promise<void>;
  loadUsers: () => Promise<void>;
}

export const useInventoryStore = create<InvState>((set) => ({
  warehouses: [],
  materials: [],
  users: [],
  loadWarehouses: async () => {
    const res = await inventoryApi.listWarehouses();
    set({ warehouses: res.data.items });
  },
  loadMaterials: async (search?: string) => {
    const res = await inventoryApi.listMaterials({ search });
    set({ materials: res.data.items });
  },
  loadUsers: async () => {
    const res = await usersApi.list({ skip: 0, limit: 500 });
    const items = (res.data.items || res.data || []).map((u: any) => ({
      id: u.id, real_name: u.real_name, role: u.role,
    }));
    set({ users: items });
  },
}));

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Modal } from '../Modal';
import { toast } from '../Toast';
import { partsApi, assembliesApi } from '../../services/api';
import { useTableSort } from '../../hooks/useTableSort';
import type { Part, Assembly } from '../../types';

// ─── Types ───────────────────────────────────────────────────────
type EntityType = 'all' | 'part' | 'assembly';

interface ItemRow {
  entity_type: 'part' | 'assembly';
  entity_id: string;
  entity_code: string;
  entity_name: string;
  entity_version: string;
}

interface ECRAffectedItemPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (items: ItemRow[]) => void;
  alreadySelected: string[];
}

// ─── Constants ───────────────────────────────────────────────────
const TYPE_TABS: { value: EntityType; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'part', label: '零件' },
  { value: 'assembly', label: '部件' },
];

function normalizeItems<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && 'items' in data) {
    return (data as { items: T[] }).items;
  }
  return [];
}

// ─── Component ───────────────────────────────────────────────────
export function ECRAffectedItemPicker({
  open,
  onClose,
  onSelect,
  alreadySelected,
}: ECRAffectedItemPickerProps) {
  // Filter state
  const [activeTab, setActiveTab] = useState<EntityType>('all');
  const [search, setSearch] = useState('');

  // Data state
  const [parts, setParts] = useState<Part[]>([]);
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [loading, setLoading] = useState(false);

  // Selection state – map of "type:id"
  const [selectedMap, setSelectedMap] = useState<Set<string>>(new Set());

  // ── Load data ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    const loadParts = activeTab === 'all' || activeTab === 'part';
    const loadAssemblies = activeTab === 'all' || activeTab === 'assembly';

    const promises: Promise<unknown>[] = [];

    if (loadParts) {
      promises.push(
        partsApi
          .list({ page_size: 10000, search: search || undefined })
          .then((r) => {
            if (!cancelled) setParts(normalizeItems<Part>(r.data));
          })
          .catch(() => {
            if (!cancelled) toast.error('加载零件列表失败');
          }),
      );
    } else {
      setParts([]);
    }

    if (loadAssemblies) {
      promises.push(
        assembliesApi
          .list({ page_size: 10000, search: search || undefined })
          .then((r) => {
            if (!cancelled) setAssemblies(normalizeItems<Assembly>(r.data));
          })
          .catch(() => {
            if (!cancelled) toast.error('加载部件列表失败');
          }),
      );
    } else {
      setAssemblies([]);
    }

    Promise.all(promises).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open, activeTab, search]);

  // ── Reset selection on open ────────────────────────────────────
  useEffect(() => {
    if (open) {
      setSelectedMap(new Set());
      setSearch('');
    }
  }, [open]);

  // ── Merged & filtered rows ─────────────────────────────────────
  const rows = useMemo<ItemRow[]>(() => {
    const result: ItemRow[] = [];

    if (activeTab === 'all' || activeTab === 'part') {
      for (const p of parts) {
        if (alreadySelected.includes(p.id)) continue;
        result.push({
          entity_type: 'part',
          entity_id: p.id,
          entity_code: p.code,
          entity_name: p.name,
          entity_version: p.version || '—',
        });
      }
    }

    if (activeTab === 'all' || activeTab === 'assembly') {
      for (const a of assemblies) {
        if (alreadySelected.includes(a.id)) continue;
        result.push({
          entity_type: 'assembly',
          entity_id: a.id,
          entity_code: a.code,
          entity_name: a.name,
          entity_version: a.version || '—',
        });
      }
    }

    return result;
  }, [parts, assemblies, activeTab, alreadySelected]);

  const { sortedData, handleSort, getSortIcon } = useTableSort(rows, 'entity_code', 'asc');

  // ── Handlers ───────────────────────────────────────────────────
  const makeKey = (type: string, id: string) => `${type}:${id}`;

  const isSelected = (item: ItemRow) => selectedMap.has(makeKey(item.entity_type, item.entity_id));

  const toggleItem = useCallback((item: ItemRow) => {
    setSelectedMap((prev) => {
      const next = new Set(prev);
      const key = makeKey(item.entity_type, item.entity_id);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedMap((prev) => {
      if (prev.size === sortedData.length) {
        return new Set();
      }
      return new Set(sortedData.map((r) => makeKey(r.entity_type, r.entity_id)));
    });
  }, [sortedData]);

  const handleConfirm = useCallback(() => {
    const selected = sortedData.filter((r) => isSelected(r));
    onSelect(selected);
    onClose();
  }, [sortedData, selectedMap, onSelect, onClose]);

  const allChecked = sortedData.length > 0 && sortedData.every((r) => isSelected(r));

  // ── Render ─────────────────────────────────────────────────────
  return (
    <Modal open={open} onClose={onClose} title="选择受影响项" width="xl">
      <div className="space-y-3">
        {/* Type filter tabs */}
        <div className="flex gap-1">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                activeTab === tab.value
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索编码或名称..."
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>

        {/* Table */}
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">
            {alreadySelected.length > 0 ? '所有项目已添加' : '暂无数据'}
          </div>
        ) : (
          <div className="border border-gray-200 rounded-lg max-h-80 overflow-y-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-gray-50 z-10">
                <tr>
                  <th className="w-10 px-2 py-2">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                  </th>
                  <th
                    className="px-2 py-2 text-left text-xs font-semibold text-gray-500 whitespace-nowrap cursor-pointer select-none"
                    onClick={() => handleSort('entity_type')}
                  >
                    类型 {getSortIcon('entity_type')}
                  </th>
                  <th
                    className="px-2 py-2 text-left text-xs font-semibold text-gray-500 whitespace-nowrap cursor-pointer select-none"
                    onClick={() => handleSort('entity_code')}
                  >
                    编码 {getSortIcon('entity_code')}
                  </th>
                  <th
                    className="px-2 py-2 text-left text-xs font-semibold text-gray-500 whitespace-nowrap cursor-pointer select-none"
                    onClick={() => handleSort('entity_name')}
                  >
                    名称 {getSortIcon('entity_name')}
                  </th>
                  <th
                    className="px-2 py-2 text-left text-xs font-semibold text-gray-500 whitespace-nowrap cursor-pointer select-none"
                    onClick={() => handleSort('entity_version')}
                  >
                    版本 {getSortIcon('entity_version')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map((row) => (
                  <tr
                    key={makeKey(row.entity_type, row.entity_id)}
                    onClick={() => toggleItem(row)}
                    className={`cursor-pointer transition-colors ${
                      isSelected(row) ? 'bg-primary-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected(row)}
                        onChange={() => toggleItem(row)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={`px-1.5 py-0.5 text-xs rounded ${
                          row.entity_type === 'part'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {row.entity_type === 'part' ? '零件' : '部件'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-xs font-mono text-gray-700">{row.entity_code}</td>
                    <td className="px-2 py-1.5 text-xs text-gray-700">{row.entity_name}</td>
                    <td className="px-2 py-1.5 text-xs text-gray-500">{row.entity_version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-200">
          <span className="text-xs text-gray-500">
            已选择 <span className="font-semibold text-primary-600">{selectedMap.size}</span> 项
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedMap.size === 0}
              className="px-4 py-2 text-sm text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              确认 ({selectedMap.size})
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

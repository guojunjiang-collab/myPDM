import { useState, useEffect, useMemo } from 'react';
import { Modal } from '../Modal';
import { configurationApi } from '../../services/api';

/* ----------------------------------------------------------------
   Types
   ---------------------------------------------------------------- */

interface ConfigItem {
  id: string;
  code: string;
  name: string;
  spec: string;
}

interface ConfigItemPickerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (item: ConfigItem) => void;
  excludeId?: string; // 已有构型项 ID，可排除自身
}

/* ----------------------------------------------------------------
   Component
   ---------------------------------------------------------------- */

export default function ConfigItemPicker({
  open,
  onClose,
  onConfirm,
  excludeId,
}: ConfigItemPickerProps) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 加载构型项列表
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    configurationApi.listItems({ page: 1, page_size: 100 })
      .then((r) => {
        const all = (r.data.items || []) as ConfigItem[];
        setItems(excludeId ? all.filter(i => i.id !== excludeId) : all);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open, excludeId]);

  // 搜索过滤
  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return items;
    return items.filter(i =>
      i.code.toLowerCase().includes(kw) ||
      i.name.toLowerCase().includes(kw) ||
      (i.spec || '').toLowerCase().includes(kw)
    );
  }, [items, search]);

  // 确认选择
  const handleConfirm = () => {
    const item = items.find(i => i.id === selectedId);
    if (item) {
      onConfirm(item);
      onClose();
    }
  };

  const handleCancel = () => {
    setSelectedId(null);
    setSearch('');
    onClose();
  };

  return (
    <Modal open={open} title="关联构型项" onClose={handleCancel} width="lg" zIndex={60}>
      <div className="space-y-4 max-h-[70vh] flex flex-col">
        {/* 搜索 */}
        <input
          type="text"
          placeholder="搜索编号、名称、规格..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
        />

        {/* 列表 */}
        <div className="border rounded-lg overflow-hidden flex-1 min-h-0">
          <div className="overflow-y-auto max-h-64">
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">加载中...</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">
                {items.length === 0 ? '无可用构型项' : '无匹配结果'}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b sticky top-0">
                  <tr>
                    <th className="w-10 px-3 py-2"></th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">构型号</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">规格型号</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((item) => {
                    const isSelected = item.id === selectedId;
                    return (
                      <tr
                        key={item.id}
                        onClick={() => setSelectedId(item.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-primary-50 border-l-2 border-primary-500'
                            : 'hover:bg-gray-50 border-l-2 border-transparent'
                        }`}
                      >
                        <td className="px-3 py-2 text-center">
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            isSelected ? 'border-primary-600' : 'border-gray-300'
                          }`}>
                            {isSelected && <div className="w-2 h-2 rounded-full bg-primary-600" />}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-medium">{item.code}</td>
                        <td className="px-3 py-2">{item.name}</td>
                        <td className="px-3 py-2 text-gray-500">{item.spec || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 底部 */}
        <div className="flex justify-between items-center pt-2 border-t">
          <span className="text-sm text-gray-500">
            {selectedId ? '已选择 1 项' : '请选择一个构型项'}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!selectedId}
              className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              确认关联
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

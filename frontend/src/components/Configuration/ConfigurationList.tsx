import { useEffect, useState } from 'react';
import { configurationApi } from '../../services/api';
import type { ConfigurationItem } from '../../types';
import { canEdit, isAdmin } from '../../stores/auth';
import { Modal, ConfirmModal } from '../Modal';
import ConfigurationCreateModal from './ConfigurationCreateModal';
import ConfigurationDetailModal from './ConfigurationDetailModal';

export default function ConfigurationList() {
  const [items, setItems] = useState<ConfigurationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  // 弹窗
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<ConfigurationItem | null>(null);
  const [detailItem, setDetailItem] = useState<ConfigurationItem | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await configurationApi.listItems({ page, page_size: 20, search: search || undefined });
      setItems(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [page]);

  const handleSearch = () => { setPage(1); load(); };

  const handleDelete = async () => {
    if (!deleteId) return;
    try { await configurationApi.deleteItem(deleteId); setDeleteId(null); load(); } catch { }
  };

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div>
      {/* 搜索 + 新建 */}
      <div className="flex gap-2 mb-4">
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="搜索构型号/名称..." className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
        <button onClick={handleSearch} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm">搜索</button>
        {canEdit() && (
          <button onClick={() => setCreateOpen(true)} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">+ 新建构型</button>
        )}
      </div>

      {/* 表格 */}
       <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">构型号</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">名称</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">规格型号</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">暂无数据</td></tr>
            ) : items.map((item) => (
              <tr key={item.id} onClick={() => setDetailItem(item)} className="hover:bg-gray-50 cursor-pointer">
                <td className="px-4 py-3 text-sm font-medium">{item.code}</td>
                <td className="px-4 py-3 text-sm">{item.name}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{item.spec || '-'}</td>
                <td className="px-4 py-3 text-right space-x-1">
                  {canEdit() && (
                    <button onClick={(e) => { e.stopPropagation(); setEditItem(item); }} className="text-primary-600 hover:text-primary-800 mr-3">编辑</button>
                  )}
                  {isAdmin() && (
                    <button onClick={(e) => { e.stopPropagation(); setDeleteId(item.id); }} className="text-red-600 hover:text-red-800">删除</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-1 mt-4">
          {Array.from({ length: totalPages }, (_, i) => (
            <button key={i} onClick={() => setPage(i + 1)}
              className={`px-3 py-1 text-xs rounded ${page === i + 1 ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >{i + 1}</button>
          ))}
        </div>
      )}

      {/* 新建弹窗 */}
      <ConfigurationCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => { setCreateOpen(false); load(); }}
      />

      {/* 编辑弹窗 */}
      <ConfigurationCreateModal
        open={!!editItem}
        item={editItem || undefined}
        onClose={() => setEditItem(null)}
        onSaved={() => { setEditItem(null); load(); }}
      />

      {/* 详情弹窗 */}
      <ConfigurationDetailModal
        itemId={detailItem?.id || null}
        onClose={() => setDetailItem(null)}
      />

      {/* 删除确认 */}
      <ConfirmModal
        open={!!deleteId}
        title="删除构型项"
        content="确认删除该构型项？此操作不可恢复。"
        confirmText="删除"
        type="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}

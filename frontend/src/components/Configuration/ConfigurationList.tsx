import { useEffect, useState, useMemo } from 'react';
import { configurationApi } from '../../services/api';
import type { ConfigurationItem } from '../../types';
import { canEdit, isAdmin } from '../../stores/auth';
import { Modal, ConfirmModal } from '../Modal';
import ConfigurationCreateModal from './ConfigurationCreateModal';
import ConfigurationDetailModal from './ConfigurationDetailModal';
import { useDataStore } from '../../stores/data';

const PAGE_SIZE = 20;

export default function ConfigurationList() {
  const [items, setItems] = useState<ConfigurationItem[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [loading, setLoading] = useState(false);

  // 弹窗
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<ConfigurationItem | null>(null);
  const [detailItem, setDetailItem] = useState<ConfigurationItem | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const storeCustomDefs = useDataStore((s) => s.customFieldDefs);
  const configCustomDefs = storeCustomDefs.filter((d) => d.applies_to?.includes('configuration_item'));

  const load = async () => {
    setLoading(true);
    try {
      const res = await configurationApi.listItems({ page: 1, page_size: 100 });
      setItems(res.data.items || []);
    } catch { } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // 客户端筛选
  const filteredData = useMemo(() => {
    if (!search) return items;
    const keyword = search.toLowerCase();
    const match = (val: string | undefined) => val?.toLowerCase().includes(keyword);
    return items.filter(item => {
      if (searchField === 'all') {
        return match(item.code) || match(item.name) || match(item.spec) || match(item.remark);
      }
      if (searchField === 'code') return match(item.code);
      if (searchField === 'name') return match(item.name);
      if (searchField === 'spec') return match(item.spec);
      if (searchField === 'remark') return match(item.remark);
      return true;
    });
  }, [items, search, searchField]);

  // 分页
  const total = filteredData.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pagedData = filteredData.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 搜索变化时重置页码
  useEffect(() => { setPage(1); }, [search, searchField]);

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteError(null);
    try {
      await configurationApi.deleteItem(deleteId);
      setDeleteId(null);
      load();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (detail) {
        setDeleteError(typeof detail === 'string' ? detail : '删除失败');
      } else {
        setDeleteError('删除失败，请重试');
      }
    }
  };

  return (
    <div>
      {/* 搜索 + 新建 */}
      <div className="flex gap-2 mb-4">
        <select
          value={searchField}
          onChange={(e) => setSearchField(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
        >
          <option value="all">全部字段</option>
          <option value="code">构型号</option>
          <option value="name">名称</option>
          <option value="spec">规格型号</option>
          <option value="remark">备注</option>
          {configCustomDefs.map(def => (
            <option key={def.id} value={`cf_${def.id}`}>{def.name}</option>
          ))}
        </select>
        <input
          type="text"
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={searchField === 'all' ? '搜索全部字段...' : searchField.startsWith('cf_') ? `搜索${configCustomDefs.find(d => d.id === searchField.replace('cf_', ''))?.name || '自定义字段'}...` : `搜索${searchField === 'code' ? '构型号' : searchField === 'name' ? '名称' : searchField === 'spec' ? '规格型号' : '备注'}...`}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 flex-1"
        />
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
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">备注</th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">暂无数据</td></tr>
            ) : pagedData.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">无匹配结果</td></tr>
            ) : pagedData.map((item) => (
              <tr key={item.id} onClick={() => setDetailItem(item)} className="hover:bg-gray-50 cursor-pointer">
                <td className="px-4 py-3 text-sm font-medium">{item.code}</td>
                <td className="px-4 py-3 text-sm">{item.name}</td>
                <td className="px-4 py-3 text-sm text-gray-500">{item.remark || '-'}</td>
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
        title={deleteError ? "无法删除" : "删除构型项"}
        content={deleteError || "确认删除该构型项？此操作不可恢复。"}
        confirmText={deleteError ? "知道了" : "删除"}
        type="danger"
        onConfirm={deleteError ? () => { setDeleteId(null); setDeleteError(null); } : handleDelete}
        onCancel={() => { setDeleteId(null); setDeleteError(null); }}
      />
    </div>
  );
}

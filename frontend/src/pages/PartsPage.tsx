import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { partsApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import type { PartListItem } from '../types';
import { toast } from '../components/Toast';
import { ConfirmModal } from '../components/Modal';
import { useTableSort } from '../hooks/useTableSort';
import PartDetailModal from '../components/PartDetailModal';

const statusTag = (s: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
    frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
    released: { label: '发布', cls: 'bg-green-100 text-green-800' },
    obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
  };
  return map[s] || { label: s, cls: 'bg-gray-100 text-gray-800' };
};

export default function PartsPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [items, setItems] = useState<PartListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [allData, setAllData] = useState<PartListItem[]>([]);

  const [detailMasterId, setDetailMasterId] = useState<string | null>(null);
  const [detailRevisionId, setDetailRevisionId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<PartListItem | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page_size: 200, show_all_versions: true };
      if (statusFilter) params.status = statusFilter;
      if (typeFilter) params.type = typeFilter;
      if (search && searchField === 'all') params.search = search;
      else if (searchField === 'code') params.search = search;
      else if (searchField === 'name') params.search = search;
      else if (searchField === 'spec') params.search = search;
      const res = await partsApi.list(params);
      const rawItems = res.items || [];
      setAllData(rawItems);

      let filtered: PartListItem[] = rawItems;
      if (search && searchField !== 'all') {
        const kw = search.toLowerCase();
        if (searchField === 'code') filtered = rawItems.filter((i: PartListItem) => i.code?.toLowerCase().includes(kw));
        else if (searchField === 'name') filtered = rawItems.filter((i: PartListItem) => i.name?.toLowerCase().includes(kw));
        else if (searchField === 'spec') filtered = rawItems.filter((i: PartListItem) => i.spec?.toLowerCase().includes(kw));
      }

      if (!showAllVersions) {
        const latestMap: Record<string, PartListItem> = {};
        filtered.forEach((item: PartListItem) => {
          const existing = latestMap[item.code];
          if (!existing || new Date(item.created_at || 0) > new Date(existing.created_at || 0)) {
            latestMap[item.code] = item;
          }
        });
        filtered = Object.values(latestMap);
      }

      setItems(filtered);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, searchField, statusFilter, typeFilter, showAllVersions]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const versionCountMap: Record<string, number> = {};
  allData.forEach(item => {
    versionCountMap[item.code] = (versionCountMap[item.code] || 0) + 1;
  });

  const { sortedData, handleSort, getSortIcon } = useTableSort<PartListItem>(items, 'code', 'asc');

  const handleCheckout = async (revId: string) => {
    try {
      await partsApi.checkout(revId);
      toast.success('签出成功');
      loadData();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '签出失败');
    }
  };

  const showCheckoutButton = (item: PartListItem) => {
    return item.status === 'draft' && !item.check_out_user_id;
  };

  const openDetail = (masterId: string, revisionId: string) => {
    setDetailMasterId(masterId);
    setDetailRevisionId(revisionId);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await partsApi.delete(deleteTarget.master_id);
      toast.success('已删除');
      loadData();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '删除失败');
    }
    setDeleteTarget(null);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <select
          value={searchField}
          onChange={(e) => setSearchField(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
        >
          <option value="all">全部字段</option>
          <option value="code">件号</option>
          <option value="name">中文名称</option>
          <option value="spec">规格型号</option>
        </select>
        <input
          type="text"
          placeholder={searchField === 'all' ? '搜索...' : `搜索${searchField === 'code' ? '件号' : searchField === 'name' ? '名称' : '规格型号'}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-44 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="frozen">冻结</option>
          <option value="released">发布</option>
          <option value="obsolete">作废</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
        >
          <option value="">全部类型</option>
          <option value="part">零件</option>
          <option value="assembly">部件</option>
        </select>
        <label className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm whitespace-nowrap">
          <input
            type="checkbox"
            checked={showAllVersions}
            onChange={(e) => setShowAllVersions(e.target.checked)}
            className="w-3.5 h-3.5"
          />
          全部版本
        </label>
        <div className="flex-1" />
        <button
          onClick={() => navigate('/parts/new')}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
        >
          + 新增零件
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th onClick={() => handleSort('code' as keyof PartListItem)} className="w-56 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                件号 {getSortIcon('code' as keyof PartListItem)}
              </th>
              <th onClick={() => handleSort('name' as keyof PartListItem)} className="w-80 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                中文名称 {getSortIcon('name' as keyof PartListItem)}
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">
                规格型号
              </th>
              <th onClick={() => handleSort('version' as keyof PartListItem)} className="w-16 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                版本 {getSortIcon('version' as keyof PartListItem)}
              </th>
              <th onClick={() => handleSort('type' as keyof PartListItem)} className="w-20 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                类型 {getSortIcon('type' as keyof PartListItem)}
              </th>
              <th onClick={() => handleSort('status' as keyof PartListItem)} className="w-20 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                状态 {getSortIcon('status' as keyof PartListItem)}
              </th>
              <th className="w-28 px-4 py-3 text-left text-sm font-medium text-gray-500">
                签出状态
              </th>
              <th className="w-32 px-4 py-3 text-right text-sm font-medium text-gray-500">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  加载中...
                </td>
              </tr>
            ) : sortedData.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  无匹配数据
                </td>
              </tr>
            ) : (
              sortedData.map((item) => (
                <tr key={item.revision_id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openDetail(item.master_id, item.revision_id)}>
                  <td className="px-4 py-3 text-sm font-medium">
                    {item.code}
                    {!showAllVersions && (versionCountMap[item.code] || 0) > 1 && (
                      <span className="ml-1.5 text-xs text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
                        {(versionCountMap[item.code] || 0)}个版本
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm truncate">{item.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 break-words whitespace-normal">{item.spec || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{item.version}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${item.type === 'assembly' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'}`}>
                      {item.type === 'assembly' ? '部件' : '零件'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${statusTag(item.status).cls}`}>
                      {statusTag(item.status).label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {item.check_out_user_name ? (
                      <span className="text-orange-600">{item.check_out_user_name}</span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-sm" onClick={(e) => e.stopPropagation()}>
                    {showCheckoutButton(item) && (
                      <button
                        onClick={() => handleCheckout(item.revision_id)}
                        className="text-primary-600 hover:text-primary-800 mr-3"
                      >
                        签出
                      </button>
                    )}
                    {user?.role === 'admin' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(item); }}
                        className="text-red-500 hover:text-red-700"
                      >
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PartDetailModal
        masterId={detailMasterId || ''}
        revisionId={detailRevisionId || undefined}
        open={!!detailMasterId}
        onClose={() => { setDetailMasterId(null); setDetailRevisionId(null); }}
      />

      {deleteTarget && (
        <ConfirmModal
          open={!!deleteTarget}
          title="确认删除"
          content={`确定要删除零件「${deleteTarget.code} ${deleteTarget.name}」吗？此操作不可恢复。`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

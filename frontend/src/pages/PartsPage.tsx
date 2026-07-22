import { useState, useEffect, useCallback } from 'react';
import { partsApi, customFieldsApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import { useDataStore } from '../stores/data';
import type { PartListItem, CustomFieldDefinition } from '../types';
import { toast } from '../components/Toast';
import { Modal, ConfirmModal } from '../components/Modal';
import { useTableSort } from '../hooks/useTableSort';
import PartDetailModal from '../components/PartDetailModal';
import { CADWorkspaceModal } from '../components/CADWorkspace/CADWorkspaceModal';

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
  const { user } = useAuthStore();

  const [items, setItems] = useState<PartListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [topLevelOnly, setTopLevelOnly] = useState(false);
  const [allData, setAllData] = useState<PartListItem[]>([]);

  const [cfValuesMap, setCfValuesMap] = useState<Record<string, Record<string, any>>>({});
  const storeCustomDefs = useDataStore((s) => s.customFieldDefs);
  const componentCustomDefs = storeCustomDefs.filter((d: CustomFieldDefinition) =>
    d.applies_to?.includes('component') || d.applies_to?.includes('part')
  );

  const [detailMasterId, setDetailMasterId] = useState<string | null>(null);
  const [detailRevisionId, setDetailRevisionId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<PartListItem | null>(null);
  const [showCADWorkspace, setShowCADWorkspace] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPart, setNewPart] = useState({ code: '', name: '', spec: '' });
  const [createSaving, setCreateSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page_size: 200, show_all_versions: true };
      if (statusFilter) params.status = statusFilter;
      if (topLevelOnly) params.top_level = true;
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
        else if (searchField.startsWith('cf_')) {
          const fieldId = searchField.slice(3);
          filtered = rawItems.filter((i: PartListItem) => {
            const cfVals = cfValuesMap[i.revision_id] || {};
            const v = cfVals[fieldId];
            if (v === null || v === undefined) return false;
            if (Array.isArray(v)) return v.some(s => String(s).toLowerCase().includes(kw));
            return String(v).toLowerCase().includes(kw);
          });
        }
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

      if (componentCustomDefs.length > 0 && filtered.length > 0) {
        const ids = filtered.map((i: PartListItem) => i.revision_id).filter(Boolean);
        if (ids.length > 0) {
          customFieldsApi.getValuesBatch({ type: 'component', ids: ids.join(',') }).then(res => {
            setCfValuesMap(res.data || {});
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search, searchField, statusFilter, showAllVersions, topLevelOnly]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const versionCountMap: Record<string, number> = {};
  allData.forEach(item => {
    versionCountMap[item.code] = (versionCountMap[item.code] || 0) + 1;
  });

  const { sortedData, handleSort, getSortIcon } = useTableSort<PartListItem>(items, 'code', 'asc');

  const openDetail = (masterId: string, revisionId: string) => {
    setDetailMasterId(masterId);
    setDetailRevisionId(revisionId);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await partsApi.deleteRevision(deleteTarget.revision_id);
      toast.success('已删除');
      loadData();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '删除失败');
    }
    setDeleteTarget(null);
  };

  const handleCreate = async () => {
    if (!newPart.code || !newPart.name) {
      toast.error('件号和名称不能为空');
      return;
    }
    setCreateSaving(true);
    try {
      const created = await partsApi.create(newPart);
      toast.success('创建成功');
      setShowCreateModal(false);
      setNewPart({ code: '', name: '', spec: '' });
      loadData();
      if (created.latest_revision?.id) {
        setDetailMasterId(created.id);
        setDetailRevisionId(created.latest_revision.id);
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '创建失败');
    } finally {
      setCreateSaving(false);
    }
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
          {componentCustomDefs.map(def => (
            <option key={def.id} value={`cf_${def.id}`}>{def.name}</option>
          ))}
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
        <label className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm whitespace-nowrap">
          <input
            type="checkbox"
            checked={showAllVersions}
            onChange={(e) => setShowAllVersions(e.target.checked)}
            className="w-3.5 h-3.5"
          />
          全部版本
        </label>
        <label className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm whitespace-nowrap" title="只显示没有父项的最顶层零部件">
          <input
            type="checkbox"
            checked={topLevelOnly}
            onChange={(e) => setTopLevelOnly(e.target.checked)}
            className="w-3.5 h-3.5"
          />
          仅顶层零部件
        </label>
        <button
          onClick={() => setShowCADWorkspace(true)}
          className="px-4 py-2 bg-sky-500 text-white rounded-lg hover:bg-sky-600 text-sm flex items-center gap-1.5"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          CAD入口
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setShowCreateModal(true)}
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
              <th onClick={() => handleSort('name' as keyof PartListItem)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                中文名称 {getSortIcon('name' as keyof PartListItem)}
              </th>
              <th onClick={() => handleSort('version' as keyof PartListItem)} className="w-16 px-4 py-3 text-center text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                版本 {getSortIcon('version' as keyof PartListItem)}
              </th>
              <th onClick={() => handleSort('type' as keyof PartListItem)} className="w-20 px-4 py-3 text-center text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                类型 {getSortIcon('type' as keyof PartListItem)}
              </th>
              <th onClick={() => handleSort('status' as keyof PartListItem)} className="w-20 px-4 py-3 text-center text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                状态 {getSortIcon('status' as keyof PartListItem)}
              </th>
              <th className="w-20 px-4 py-3 text-center text-sm font-medium text-gray-500 select-none whitespace-nowrap">
                签出状态
              </th>
              <th className="w-16 px-4 py-3 text-center text-sm font-medium text-gray-500 select-none whitespace-nowrap">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  加载中...
                </td>
              </tr>
            ) : sortedData.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
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
                  <td className="px-4 py-3 text-sm text-gray-500 text-center">{item.version}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 text-xs rounded-full ${item.type === 'assembly' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'}`}>
                      {item.type === 'assembly' ? '部件' : '零件'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 text-xs rounded-full ${statusTag(item.status).cls}`}>
                      {statusTag(item.status).label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-center">
                    {item.check_out_user_name ? (
                      <span className="text-orange-600">{item.check_out_user_name}</span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-sm" onClick={(e) => e.stopPropagation()}>
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

      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="新建零件" width="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">件号 <span className="text-red-500">*</span></label>
            <input type="text" value={newPart.code}
              onChange={(e) => setNewPart(p => ({...p, code: e.target.value}))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">名称 <span className="text-red-500">*</span></label>
            <input type="text" value={newPart.name}
              onChange={(e) => setNewPart(p => ({...p, name: e.target.value}))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">规格型号</label>
            <input type="text" value={newPart.spec}
              onChange={(e) => setNewPart(p => ({...p, spec: e.target.value}))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setShowCreateModal(false)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">取消</button>
            <button onClick={handleCreate} disabled={createSaving}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50">
              {createSaving ? '创建中...' : '创建'}
            </button>
          </div>
        </div>
      </Modal>

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
          content={`确定要删除「${deleteTarget.code} ${deleteTarget.name}」版本 ${deleteTarget.version} 吗？此操作不可恢复。`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      <CADWorkspaceModal open={showCADWorkspace} onClose={() => { setShowCADWorkspace(false); loadData(); }} />
    </div>
  );
}

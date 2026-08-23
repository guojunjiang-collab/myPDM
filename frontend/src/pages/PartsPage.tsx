import { useState, useEffect } from 'react';
import { formatDate } from '../lib/date';
import { partsApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import { useDataStore } from '../stores/data';
import type { PartListItem, CustomFieldDefinition } from '../types';
import { toast } from '../components/Toast';
import { Modal, ConfirmModal } from '../components/Modal';
import { useDebounced } from '../hooks/useDebounced';
import PartDetailModal from '../components/PartDetailModal';
import { CADWorkspaceModal } from '../components/CADWorkspace/CADWorkspaceModal';
import PartCompareModal from '../components/PartCompareModal';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';

type SortField = 'code' | 'name' | 'created_at' | 'version' | 'status' | 'check_out_user_name' | 'type';
type SortOrder = 'asc' | 'desc';

export default function PartsPage() {
  const { user } = useAuthStore();
  const storeCustomDefs = useDataStore((s) => s.customFieldDefs);
  const componentCustomDefs = storeCustomDefs.filter((d: CustomFieldDefinition) =>
    d.applies_to?.includes('component') || d.applies_to?.includes('part')
  );

  const [items, setItems] = useState<PartListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const [sortField, setSortField] = useState<SortField>('code');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 400);
  const [searchField, setSearchField] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [topLevelOnly, setTopLevelOnly] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const [detailMasterId, setDetailMasterId] = useState<string | null>(null);
  const [detailRevisionId, setDetailRevisionId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PartListItem | null>(null);
  const [showCADWorkspace, setShowCADWorkspace] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [newPart, setNewPart] = useState({ code: '', name: '', spec: '' });
  const [createSaving, setCreateSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    partsApi.list({
      page,
      page_size: pageSize,
      sort_field: sortField,
      sort_order: sortOrder,
      search: debouncedSearch || undefined,
      search_field: searchField.startsWith('cf_') ? 'all' : searchField,
      include_custom_fields: true,
      status: statusFilter || undefined,
      show_all_versions: showAllVersions,
      top_level: topLevelOnly,
    }).then((res: any) => {
      setItems(res.items || []);
      setTotal(res.total || 0);
      setPage(res.page || 1);
    }).catch(() => {
      setItems([]);
      setTotal(0);
    }).finally(() => setLoading(false));
  }, [page, sortField, sortOrder, debouncedSearch, searchField, statusFilter, showAllVersions, topLevelOnly, refreshToken]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, searchField, statusFilter, showAllVersions, topLevelOnly, sortField, sortOrder]);

  const onSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };
  const sortIcon = (field: SortField) =>
    sortField === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : ' ⇅';

  const openDetail = (masterId: string, revisionId: string) => {
    setDetailMasterId(masterId);
    setDetailRevisionId(revisionId);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await partsApi.deleteRevision(deleteTarget.revision_id);
      toast.success('已删除');
      setItems(prev => prev.filter(it => it.revision_id !== deleteTarget.revision_id));
      setRefreshToken(t => t + 1);
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
      setPage(1);
      setRefreshToken(t => t + 1);
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
        <Input
          type="text"
          placeholder={
            searchField.startsWith('cf_') ? '搜索...' :
            searchField === 'all' ? '搜索...' :
            searchField === 'code' ? '搜索件号...' :
            searchField === 'name' ? '搜索名称...' : '搜索规格型号...'
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-0"
        />
        <Select
          className="!w-auto"
          value={searchField}
          onChange={(e) => setSearchField(e.target.value)}
        >
          <option value="all">全部字段</option>
          <option value="code">件号</option>
          <option value="name">中文名称</option>
          <option value="spec">规格型号</option>
          {componentCustomDefs.map(def => (
            <option key={def.id} value={`cf_${def.id}`}>{def.name}</option>
          ))}
        </Select>
        <Select
          className="!w-auto"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="frozen">冻结</option>
          <option value="released">发布</option>
          <option value="obsolete">作废</option>
        </Select>
        <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg cursor-pointer text-sm whitespace-nowrap transition-colors select-none bg-[var(--ui-btn-primary-bg)] text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-hover)]">
          <input
            type="checkbox"
            checked={showAllVersions}
            onChange={(e) => setShowAllVersions(e.target.checked)}
            className="w-3.5 h-3.5"
          />
          全部版本
        </label>
        <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg cursor-pointer text-sm whitespace-nowrap transition-colors select-none bg-[var(--ui-btn-primary-bg)] text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-hover)]" title="只显示没有父项的最顶层零部件">
          <input
            type="checkbox"
            checked={topLevelOnly}
            onChange={(e) => setTopLevelOnly(e.target.checked)}
            className="w-3.5 h-3.5"
          />
          仅顶层零部件
        </label>

        <Button onClick={() => setShowCADWorkspace(true)}>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          CAD工作台
        </Button>
        <Button onClick={() => setShowCompareModal(true)}>
          ⇄ BOM对比
        </Button>
        <div className="flex-1" />
        <Button onClick={() => setShowCreateModal(true)}>
          + 新增零件
        </Button>
      </div>

      <div className="relative bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)] sticky top-0 z-10">
            <tr>
              <th onClick={() => onSort('code')} className="w-56 px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                件号{sortIcon('code')}
              </th>
              <th onClick={() => onSort('name')} className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                中文名称{sortIcon('name')}
              </th>
              <th onClick={() => onSort('created_at')} className="w-44 px-2 py-3 text-center text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                创建时间{sortIcon('created_at')}
              </th>
              <th onClick={() => onSort('version')} className="w-16 px-4 py-3 text-center text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                版本{sortIcon('version')}
              </th>
              <th onClick={() => onSort('type')} className="w-20 px-4 py-3 text-center text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                类型{sortIcon('type')}
              </th>
              <th onClick={() => onSort('status')} className="w-20 px-4 py-3 text-center text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                状态{sortIcon('status')}
              </th>
              <th onClick={() => onSort('check_out_user_name')} className="w-20 px-4 py-3 text-center text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">
                签出状态{sortIcon('check_out_user_name')}
              </th>
              <th className="w-16 px-4 py-3 text-center text-sm font-medium text-[var(--ui-text-secondary)] select-none whitespace-nowrap">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">
                  加载中...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">
                  无匹配数据
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.revision_id} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer" onClick={() => openDetail(item.master_id, item.revision_id)}>
                  <td className="px-4 py-3 text-sm font-medium">
                    {item.code}
                    {item.version_count && item.version_count > 1 && !showAllVersions && (
                      <span className="ml-1.5 text-xs text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
                        {item.version_count}个版本
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm truncate">{item.name}</td>
                  <td className="px-2 py-3 text-sm text-[var(--ui-text-secondary)] text-center whitespace-nowrap">{formatDate(item.created_at, 'YYYY-MM-DD HH:mm')}</td>
                  <td className="px-4 py-3 text-sm text-[var(--ui-text-secondary)] text-center">{item.version}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge tone={item.type === 'assembly' ? 'blue' : 'gray'} label={item.type === 'assembly' ? '部件' : '零件'} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge status={item.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-center">
                    {item.check_out_user_name ? (
                      <span className="text-orange-600">{item.check_out_user_name}</span>
                    ) : <span className="text-[var(--ui-text-tertiary)]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-sm" onClick={(e) => e.stopPropagation()}>
                    {user?.role === 'admin' && (
                      <Button variant="danger" size="xs"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(item); }}
                      >
                        删除
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="sticky bottom-0 flex justify-center py-2 pointer-events-none">
          <div className="inline-flex items-center gap-3 text-sm text-[var(--ui-text-secondary)] bg-[var(--ui-bg-surface)] border border-[var(--ui-border)] rounded-full shadow-lg px-4 py-2 pointer-events-auto">
            共 <span className="font-medium">{total}</span> 条
            <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading}>上一页</Button>
            <span className="tabular-nums">第 {page} / {pageCount} 页</span>
            <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page >= pageCount || loading}>下一页</Button>
          </div>
        </div>
       </div>

      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="新建零件" width="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">件号 <span className="text-red-500">*</span></label>
            <Input type="text" value={newPart.code}
              onChange={(e) => setNewPart(p => ({...p, code: e.target.value}))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">名称 <span className="text-red-500">*</span></label>
            <Input type="text" value={newPart.name}
              onChange={(e) => setNewPart(p => ({...p, name: e.target.value}))} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">规格型号</label>
            <Input type="text" value={newPart.spec}
              onChange={(e) => setNewPart(p => ({...p, spec: e.target.value}))} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowCreateModal(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={createSaving}>
              {createSaving ? '创建中...' : '创建'}
            </Button>
          </div>
        </div>
      </Modal>

      <PartDetailModal
        masterId={detailMasterId || ''}
        revisionId={detailRevisionId || undefined}
        open={!!detailMasterId}
        onClose={(saved: any) => {
          setDetailMasterId(null);
          setDetailRevisionId(null);
          if (saved && detailMasterId) {
            const applyPatch = (item: PartListItem) =>
              item.master_id === detailMasterId ? { ...item, ...saved } : item;
            setItems(prev => prev.map(applyPatch));
          } else {
            setRefreshToken(t => t + 1);
          }
        }}
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
      <CADWorkspaceModal open={showCADWorkspace} onClose={() => { setShowCADWorkspace(false); setRefreshToken(t => t + 1); }} />
      <PartCompareModal open={showCompareModal} onClose={() => setShowCompareModal(false)} />
    </div>
  );
}

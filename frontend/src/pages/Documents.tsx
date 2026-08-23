import { useEffect, useState } from 'react';
import { formatDate } from '../lib/date';
import { documentsApi, customFieldsApi, bomApi, userGroupsApi } from '../services/api';
import type { Document, CustomFieldDefinition, CustomFieldValue } from '../types';
import { canEdit, isAdmin } from '../stores/auth';
import { Modal, ConfirmModal } from '../components/Modal';
import DocumentDetailContent from '../components/DocumentDetailContent';
import DocumentDetailModal from '../components/DocumentDetailModal';
import { toast } from '../components/Toast';
import VersionHistory from '../components/VersionHistory';
import { useDataStore } from '../stores/data';
import { useDebounced } from '../hooks/useDebounced';
import ArchiveTreeModal from '../components/ArchiveTreeModal';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import Textarea from '../components/ui/Textarea';

type SortField = 'code' | 'name' | 'created_at' | 'version' | 'status' | 'check_out_user_name';
type SortOrder = 'asc' | 'desc';

export default function Documents() {
  const storeCustomDefs = useDataStore((s) => s.customFieldDefs);
  const documentCustomDefs = storeCustomDefs.filter((d: CustomFieldDefinition) =>
    d.applies_to?.includes('document')
  );

  const [items, setItems] = useState<Document[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const [sortField, setSortField] = useState<SortField>('code');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 400);
  const [searchField, setSearchField] = useState('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [showAccessibleOnly, setShowAccessibleOnly] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // 新增图文档弹窗
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createCode, setCreateCode] = useState('');
  const [createName, setCreateName] = useState('');
  const [createRemark, setCreateRemark] = useState('');
  const [createGroupIds, setCreateGroupIds] = useState<string[]>([]);
  const [createSaving, setCreateSaving] = useState(false);
  const [createSaveError, setCreateSaveError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 详情弹窗
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
  const [viewingCustomDefs, setViewingCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [viewingCustomValues, setViewingCustomValues] = useState<Record<string, any>>({});
  const [detailTab, setDetailTab] = useState<'detail' | 'versions'>('detail');
  const [archivePreview, setArchivePreview] = useState<{ attId: string; fileName: string } | null>(null);

  // 详情/编辑合一弹窗（签入签出）
  const [detailDocId, setDetailDocId] = useState<string | null>(null);

  // 用户组关联
  const [allGroups, setAllGroups] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    userGroupsApi.list().then((res) => setAllGroups(Array.isArray(res.data) ? res.data : [])).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    documentsApi.list({
      page,
      page_size: pageSize,
      sort_field: sortField,
      sort_order: sortOrder,
      search: debouncedSearch || undefined,
      search_field: searchField.startsWith('cf_') ? 'all' : searchField,
      include_custom_fields: true,
      status: statusFilter || undefined,
      show_all_versions: showAllVersions,
      show_accessible_only: showAccessibleOnly || undefined,
    }).then((res) => {
      const data = res.data as any;
      setItems((data.items || []) as Document[]);
      setTotal(data.total || 0);
      setPage(data.page || 1);
    }).catch(() => {
      setItems([]);
      setTotal(0);
    }).finally(() => setLoading(false));
  }, [page, sortField, sortOrder, debouncedSearch, searchField, statusFilter, showAllVersions, showAccessibleOnly, refreshToken]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, searchField, statusFilter, showAllVersions, showAccessibleOnly, sortField, sortOrder]);

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

  const handleAdd = () => {
    setCreateCode('');
    setCreateName('');
    setCreateRemark('');
    setCreateGroupIds([]);
    setCreateSaveError(null);
    setCreateModalOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateSaving(true);
    setCreateSaveError(null);
    try {
      const res = await documentsApi.create({
        code: createCode,
        name: createName,
        remark: createRemark || undefined,
        group_ids: createGroupIds,
      });
      const newDoc = res.data as Document;
      setCreateModalOpen(false);
      setDetailDocId(newDoc.id);
      setPage(1);
      setRefreshToken(t => t + 1);
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      setCreateSaveError(typeof detail === 'string' ? detail : '创建失败，请重试');
    } finally {
      setCreateSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteError(null);
    try {
      const res = await bomApi.checkReferences('document', deleteId);
      const refs = res.data || [];
      if (refs.length > 0) {
        const names = refs.map((r: any) => r.label).join(', ');
        setDeleteError('该图文档被以下实体引用，不能删除: ' + names);
        return;
      }
      await documentsApi.del(deleteId);
      setDeleteId(null);
      setItems(prev => prev.filter(d => d.id !== deleteId));
      setRefreshToken(t => t + 1);
    } catch (error) {
      toast.error('删除失败');
    }
  };

  const handleView = async (doc: Document) => {
    setViewingDoc(doc);
    setDetailTab('detail');
    const allDefs = useDataStore.getState().customFieldDefs;
    const docDefs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes('document'));
    setViewingCustomDefs(docDefs);
    try {
      const res = await customFieldsApi.getValues('document', doc.id);
      const values: Record<string, any> = {};
      (res.data || []).forEach((v: CustomFieldValue) => {
        values[v.field_id] = v.value;
      });
      setViewingCustomValues(values);
    } catch {
      setViewingCustomValues({});
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <Input
          type="text"
          placeholder={searchField === 'all' ? '搜索...' : searchField.startsWith('cf_') ? `搜索${documentCustomDefs.find(d => d.id === searchField.replace('cf_', ''))?.name || '自定义字段'}...` : `搜索${searchField === 'code' ? '编号' : searchField === 'name' ? '名称' : '备注'}...`}
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
          <option value="code">编号</option>
          <option value="name">名称</option>
          <option value="remark">备注</option>
          {documentCustomDefs.map(def => (
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
        <Button active={showAllVersions} onClick={() => setShowAllVersions((v) => !v)}>
          全部版本
        </Button>
        <Button active={showAccessibleOnly} onClick={() => setShowAccessibleOnly((v) => !v)}>
          可查看
        </Button>

        <div className="flex-1" />
        {canEdit() && (
          <Button onClick={handleAdd}>+ 新增图文档</Button>
        )}
      </div>

      <div className="relative bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)] sticky top-0 z-10">
            <tr>
              <th onClick={() => onSort('code')} className="w-60 px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none whitespace-nowrap">编号{sortIcon('code')}</th>
              <th onClick={() => onSort('name')} className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none whitespace-nowrap">名称{sortIcon('name')}</th>
              <th onClick={() => onSort('created_at')} className="w-44 px-2 py-3 text-center text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none whitespace-nowrap">创建时间{sortIcon('created_at')}</th>
              <th onClick={() => onSort('version')} className="w-16 px-4 py-3 text-center text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none whitespace-nowrap">版本{sortIcon('version')}</th>
              <th onClick={() => onSort('status')} className="w-20 px-4 py-3 text-center text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none whitespace-nowrap">状态{sortIcon('status')}</th>
              <th onClick={() => onSort('check_out_user_name')} className="w-20 px-4 py-3 text-center text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none whitespace-nowrap">签出状态{sortIcon('check_out_user_name')}</th>
              <th className="w-16 px-4 py-3 text-center text-sm font-medium text-[var(--ui-text-secondary)] select-none whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading && items.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">无匹配数据</td></tr>
            ) : (
              items.map((doc) => (
                <tr key={doc.id} className={`hover:bg-[var(--ui-bg-hover)] cursor-pointer ${(doc as any).accessible === false ? 'opacity-60' : ''}`} onClick={() => { setDetailDocId(doc.id); }}>
                  <td className="px-4 py-3 text-sm font-medium">
                    {(doc as any).accessible === false && <span className="mr-1" title="无权限：需关联用户组成员">🔒</span>}
                    {doc.code}
                    {(doc as any).version_count != null && (doc as any).version_count > 1 && (
                      <span className="ml-1.5 text-xs text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
                        {(doc as any).version_count}个版本
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">{doc.name}</td>
                  <td className="px-2 py-3 text-sm text-[var(--ui-text-secondary)] text-center whitespace-nowrap">{formatDate(doc.created_at, 'YYYY-MM-DD HH:mm')}</td>
                  <td className="px-4 py-3 text-sm text-[var(--ui-text-secondary)] text-center">{doc.version || '-'}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge status={doc.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-center">
                    {doc.check_out_user_name
                      ? <span className="text-orange-600">{doc.check_out_user_name}</span>
                      : <span className="text-[var(--ui-text-tertiary)]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-sm" onClick={(e) => e.stopPropagation()}>
                    {isAdmin() && (doc as any).accessible !== false && (
                      <Button variant="danger" size="xs" onClick={() => setDeleteId(doc.id)}>删除</Button>
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

      <Modal
        open={createModalOpen}
        title="新增图文档"
        onClose={() => setCreateModalOpen(false)}
        width="md"
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">编号 <span className="text-red-500">*</span></label>
            <Input
              type="text"
              value={createCode}
              onChange={(e) => setCreateCode(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">名称 <span className="text-red-500">*</span></label>
            <Input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <Textarea
              value={createRemark}
              onChange={(e) => setCreateRemark(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">关联用户组（留空=全员可预览/下载）</label>
            <div className="max-h-40 overflow-auto border border-[var(--ui-border)] rounded-lg p-2 grid grid-cols-2 gap-x-2 gap-y-0.5">
              {allGroups.length === 0 && <span className="text-[var(--ui-text-tertiary)] text-sm col-span-2">暂无用户组</span>}
              {allGroups.map((g) => (
                <label key={g.id} className="flex items-center gap-1.5 py-0.5">
                  <input
                    type="checkbox"
                    checked={createGroupIds.includes(String(g.id))}
                    onChange={(e) => setCreateGroupIds((prev) =>
                      e.target.checked ? [...prev, String(g.id)] : prev.filter((x) => x !== String(g.id)))}
                  />
                  <span className="text-sm truncate">{g.name}</span>
                </label>
              ))}
            </div>
          </div>
          {createSaveError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
              {createSaveError}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="secondary" type="button" onClick={() => setCreateModalOpen(false)}>取消</Button>
            <Button type="submit" disabled={createSaving}>
              {createSaving ? '创建中...' : '创建'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={!!deleteId}
        title={deleteError ? "无法删除" : "确认删除"}
        content={deleteError || "确定要删除该图文档吗？此操作不可撤销。"}
        confirmText={deleteError ? "知道了" : "删除"}
        cancelText="取消"
        type={deleteError ? "info" : "danger"}
        onConfirm={deleteError ? () => { setDeleteId(null); setDeleteError(null); } : handleDelete}
        onCancel={() => { setDeleteId(null); setDeleteError(null); }}
      />

      {/* 图文档详情弹窗 */}
      <Modal
        open={!!viewingDoc}
        title="图文档详情"
        onClose={() => setViewingDoc(null)}
        width="full"
      >
        {viewingDoc && (
          <div>
            <div className="flex gap-1 mb-4 border-b">
              <button
                onClick={() => setDetailTab('detail')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  detailTab === 'detail'
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
                }`}
              >
                基本信息
              </button>
              <button
                onClick={() => setDetailTab('versions')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  detailTab === 'versions'
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
                }`}
              >
                版本历史
              </button>
            </div>

            {detailTab === 'detail' ? (
              <DocumentDetailContent
                doc={viewingDoc}
                customFieldDefs={viewingCustomDefs}
                customFieldValues={viewingCustomValues}
                accessible={(viewingDoc as any).accessible ?? true}
                groupNames={((viewingDoc as any).group_ids || []).map((gid: string) => allGroups.find(g => g.id === gid)?.name || gid).filter(Boolean)}
                onArchivePreview={(attId, fileName) => setArchivePreview({ attId, fileName })}
              />
            ) : (
              <VersionHistory
                entityType="document"
                entityId={viewingDoc.id}
                onViewVersion={async (id) => {
                  try {
                    const res = await documentsApi.detail(id);
                    handleView(res.data);
                  } catch {
                    toast.error('加载版本失败');
                  }
                }}
              />
            )}
          </div>
        )}
      </Modal>

      {archivePreview && (
        <ArchiveTreeModal
          open={!!archivePreview}
          onClose={() => setArchivePreview(null)}
          attachmentId={archivePreview.attId}
          fileName={archivePreview.fileName}
        />
      )}

      <DocumentDetailModal
        open={!!detailDocId}
        revisionId={detailDocId}
        onClose={() => {
          setDetailDocId(null);
          setRefreshToken(t => t + 1);
        }}
        onSaved={() => {}}
      />
    </div>
  );
}

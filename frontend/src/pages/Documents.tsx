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
      alert('删除失败');
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
        <select
          value={searchField}
          onChange={(e) => setSearchField(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
        >
          <option value="all">全部字段</option>
          <option value="code">编号</option>
          <option value="name">名称</option>
          <option value="remark">备注</option>
          {documentCustomDefs.map(def => (
            <option key={def.id} value={`cf_${def.id}`}>{def.name}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder={searchField === 'all' ? '搜索...' : searchField.startsWith('cf_') ? `搜索${documentCustomDefs.find(d => d.id === searchField.replace('cf_', ''))?.name || '自定义字段'}...` : `搜索${searchField === 'code' ? '编号' : searchField === 'name' ? '名称' : '备注'}...`}
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
        <label className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-sm whitespace-nowrap">
          <input
            type="checkbox"
            checked={showAccessibleOnly}
            onChange={(e) => setShowAccessibleOnly(e.target.checked)}
            className="w-3.5 h-3.5"
          />
          可查看
        </label>

        <div className="flex-1" />
        {canEdit() && (
          <button onClick={handleAdd} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">+ 新增图文档</button>
        )}
      </div>

      <div className="relative bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th onClick={() => onSort('code')} className="w-60 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">编号{sortIcon('code')}</th>
              <th onClick={() => onSort('name')} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">名称{sortIcon('name')}</th>
              <th onClick={() => onSort('created_at')} className="w-44 px-2 py-3 text-center text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">创建时间{sortIcon('created_at')}</th>
              <th onClick={() => onSort('version')} className="w-16 px-4 py-3 text-center text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">版本{sortIcon('version')}</th>
              <th onClick={() => onSort('status')} className="w-20 px-4 py-3 text-center text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">状态{sortIcon('status')}</th>
              <th onClick={() => onSort('check_out_user_name')} className="w-20 px-4 py-3 text-center text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">签出状态{sortIcon('check_out_user_name')}</th>
              <th className="w-16 px-4 py-3 text-center text-sm font-medium text-gray-500 select-none whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading && items.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">无匹配数据</td></tr>
            ) : (
              items.map((doc) => (
                <tr key={doc.id} className={`hover:bg-gray-50 cursor-pointer ${(doc as any).accessible === false ? 'opacity-60' : ''}`} onClick={() => { setDetailDocId(doc.id); }}>
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
                  <td className="px-2 py-3 text-sm text-gray-500 text-center whitespace-nowrap">{formatDate(doc.created_at, 'YYYY-MM-DD HH:mm')}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 text-center">{doc.version || '-'}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge status={doc.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-center">
                    {doc.check_out_user_name
                      ? <span className="text-orange-600">{doc.check_out_user_name}</span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-sm" onClick={(e) => e.stopPropagation()}>
                    {isAdmin() && (doc as any).accessible !== false && (
                      <button onClick={() => setDeleteId(doc.id)} className="text-red-500 hover:text-red-700">删除</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="sticky bottom-0 flex justify-center py-2 pointer-events-none">
          <div className="inline-flex items-center gap-3 text-sm text-gray-600 bg-white border border-gray-200 rounded-full shadow-lg px-4 py-2 pointer-events-auto">
            共 <span className="font-medium">{total}</span> 条
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading}
              className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-40">上一页</button>
            <span className="tabular-nums">第 {page} / {pageCount} 页</span>
            <button onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page >= pageCount || loading}
              className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-40">下一页</button>
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
            <input
              type="text"
              value={createCode}
              onChange={(e) => setCreateCode(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">名称 <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <textarea
              value={createRemark}
              onChange={(e) => setCreateRemark(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">关联用户组（留空=全员可预览/下载）</label>
            <div className="max-h-40 overflow-auto border border-gray-200 rounded-lg p-2 grid grid-cols-2 gap-x-2 gap-y-0.5">
              {allGroups.length === 0 && <span className="text-gray-400 text-sm col-span-2">暂无用户组</span>}
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
            <button type="button" onClick={() => setCreateModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
            <button type="submit" disabled={createSaving} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
              {createSaving ? '创建中...' : '创建'}
            </button>
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
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                基本信息
              </button>
              <button
                onClick={() => setDetailTab('versions')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  detailTab === 'versions'
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
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
                    alert('加载版本失败');
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

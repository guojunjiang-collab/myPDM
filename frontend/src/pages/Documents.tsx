import { useEffect, useState } from 'react';
import { documentsApi, customFieldsApi, bomApi, userGroupsApi } from '../services/api';
import type { Document, CustomFieldDefinition, CustomFieldValue } from '../types';
import { canEdit, isAdmin, useAuthStore } from '../stores/auth';
import { compareVersions } from '../constants';
import { Modal, ConfirmModal } from '../components/Modal';
import DocumentDetailContent from '../components/DocumentDetailContent';
import DocumentDetailModal from '../components/DocumentDetailModal';
import { toast } from '../components/Toast';
import VersionHistory from '../components/VersionHistory';
import { useDataStore } from '../stores/data';
import { useTableSort } from '../hooks/useTableSort';
import ArchiveTreeModal from '../components/ArchiveTreeModal';

export default function Documents() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [status, setStatus] = useState('');
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [showAccessibleOnly, setShowAccessibleOnly] = useState(false);

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

  // 从 store 订阅数据
  const storeDocuments = useDataStore((s) => s.documents);

  // Custom fields
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([]);
  // 自定义字段值映射：{ entityId: { fieldId: value } }
  const [customFieldValuesMap, setCustomFieldValuesMap] = useState<Record<string, Record<string, any>>>({});

  // 用户组关联
  const [allGroups, setAllGroups] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    userGroupsApi.list().then((res) => setAllGroups(Array.isArray(res.data) ? res.data : [])).catch(() => {});
  }, []);

  useEffect(() => {
    loadDocuments();
    // 依赖 storeDocuments：跨页变更（创建/编辑/删除/轮询）后自动拉取最新
    // 不依赖 search/status：本地筛选即可，不需要重新拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeDocuments]);

  const { sortedData, handleSort, getSortIcon } = useTableSort<Document>(documents, 'code', 'asc');

  // 获取图文档适用的自定义字段定义
  const documentCustomDefs = customFieldDefs.filter((d) => d.applies_to?.includes('document'));

  // 筛选逻辑
  const filteredData = sortedData.filter(doc => {
    if (status && doc.status !== status) return false;
    if (search) {
      const keyword = search.toLowerCase();
      const match = (val: string | undefined) => val?.toLowerCase().includes(keyword);
      // 基础字段搜索
      if (searchField === 'all') {
        if (match(doc.code) || match(doc.name) || match(doc.version) || match(doc.remark)) return true;
        // 搜索自定义字段
        const docCustomValues = customFieldValuesMap[doc.id] || {};
        for (const def of documentCustomDefs) {
          const val = docCustomValues[def.id];
          if (val != null && String(val).toLowerCase().includes(keyword)) return true;
        }
        return false;
      }
      if (searchField === 'code') return match(doc.code);
      if (searchField === 'name') return match(doc.name);
      if (searchField === 'version') return match(doc.version);
      if (searchField === 'status') return match(doc.status);
      if (searchField === 'remark') return match(doc.remark);
      // 自定义字段搜索
      if (searchField.startsWith('cf_')) {
        const fieldId = searchField.replace('cf_', '');
        const docCustomValues = customFieldValuesMap[doc.id] || {};
        const val = docCustomValues[fieldId];
        return val != null && String(val).toLowerCase().includes(keyword);
      }
      return true;
    }
    return true;
  });

  // 版本计数
  const versionCountMap: Record<string, number> = {};
  documents.forEach(d => {
    versionCountMap[d.code] = (versionCountMap[d.code] || 0) + 1;
  });

  // 仅显示最新版本（按版本号序列 A→B→C...→ZZ 比较）
  const displayData = (() => {
    let data = showAllVersions ? filteredData : (() => {
      const latestMap: Record<string, typeof filteredData[0]> = {};
      filteredData.forEach(d => {
        const existing = latestMap[d.code];
        if (!existing || compareVersions(d.version || 'A', existing.version || 'A') > 0) {
          latestMap[d.code] = d;
        }
      });
      return Object.values(latestMap);
    })();
    if (showAccessibleOnly) {
      data = data.filter((d: any) => d.accessible !== false);
    }
    return data;
  })();

  const loadDocuments = async () => {
    setLoading(true);
    try {
      // 直接调 API 取全量（含所有版本），避免依赖 store 缓存导致看不到「多版本」徽标
      const res = await documentsApi.list({ page_size: 10000 });
      const respData = res.data as Record<string, unknown>;
      const rawItems: Record<string, unknown>[] = Array.isArray(respData) ? respData : (respData?.items || []) as Record<string, unknown>[];
      const localDocuments: Document[] = rawItems.map((item: Record<string, unknown>) => ({
        ...item,
        id: (item.id ?? item.revision_id) as string,
      })) as Document[];
      setDocuments(localDocuments);
      // 不回写 store：会触发 useEffect 无限循环（storeDocuments 变 → loadDocuments → ...）
      // store 由 syncService 轮询维护，跨页同步仍生效
      // 加载自定义字段定义（同步版本）
      const localDefs = useDataStore.getState().customFieldDefs;
      setCustomFieldDefs(localDefs.filter((d: CustomFieldDefinition) =>
        d.applies_to?.includes('document')
      ));
      // 加载所有图文档的自定义字段值
      loadAllCustomFieldValues(localDocuments);
    } catch (error) {
      console.error('加载图文档失败', error);
    } finally {
      setLoading(false);
    }
  };

  // 批量加载所有图文档的自定义字段值（单次 API 调用，避免 N+1 请求触发 429）
  const loadAllCustomFieldValues = async (docsList: Document[]) => {
    if (docsList.length === 0) return;
    try {
      const ids = docsList.map((d) => d.id).filter(Boolean);
      const res = await customFieldsApi.getValuesBatch({ type: 'document', ids: ids.join(',') });
      // 后端返回 { entityId: { field_key: value, ... } }，按 field_key→field_id 映射转换为 { entityId: { field_id: value, ... } }
      // 以兼容列表中按 def.id 查找自定义字段的逻辑
      const fieldDefs = useDataStore.getState().customFieldDefs.filter((d) =>
        d.applies_to?.includes('document')
      );
      const keyToId: Record<string, string> = {};
      fieldDefs.forEach((d) => { keyToId[d.field_key] = d.id; });
      const raw = (res.data || {}) as Record<string, Record<string, any>>;
      const map: Record<string, Record<string, any>> = {};
      Object.entries(raw).forEach(([docId, kvMap]) => {
        const byId: Record<string, any> = {};
        Object.entries(kvMap || {}).forEach(([k, v]) => {
          const id = keyToId[k] || k;
          byId[id] = v;
        });
        map[docId] = byId;
      });
      setCustomFieldValuesMap(map);
    } catch (error) {
      console.error('加载自定义字段值失败', error);
    }
  };

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
      useDataStore.getState().setDocuments([...useDataStore.getState().documents, newDoc]);
      setDetailDocId(newDoc.id);
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
      await documentsApi.delete(deleteId);
      setDeleteId(null);
      useDataStore.getState().setDocuments(
        useDataStore.getState().documents.filter(d => d.id !== deleteId)
      );
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

  const getStatusTag = (s: string) => {
    const tags: Record<string, { label: string; class: string }> = {
      draft: { label: '草稿', class: 'bg-blue-100 text-blue-800' },
      frozen: { label: '冻结', class: 'bg-orange-100 text-orange-800' },
      released: { label: '发布', class: 'bg-green-100 text-green-800' },
      obsolete: { label: '作废', class: 'bg-red-100 text-red-800' },
    };
    return tags[s] || { label: s, class: 'bg-gray-100 text-gray-800' };
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
          <option value="version">版本</option>
          <option value="status">状态</option>
          <option value="remark">备注</option>
          {documentCustomDefs.map(def => (
            <option key={def.id} value={`cf_${def.id}`}>{def.name}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder={searchField === 'all' ? '搜索...' : searchField.startsWith('cf_') ? `搜索${documentCustomDefs.find(d => d.id === searchField.replace('cf_', ''))?.name || '自定义字段'}...` : `搜索${searchField === 'code' ? '编号' : searchField === 'name' ? '名称' : searchField === 'version' ? '版本' : searchField === 'status' ? '状态' : '备注'}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-44 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
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

      <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th onClick={() => handleSort('code' as keyof Document)} className="w-60 px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">编号 {getSortIcon('code' as keyof Document)}</th>
              <th onClick={() => handleSort('name' as keyof Document)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">名称 {getSortIcon('name' as keyof Document)}</th>
              <th onClick={() => handleSort('version' as keyof Document)} className="w-16 px-4 py-3 text-center text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">版本 {getSortIcon('version' as keyof Document)}</th>
              <th onClick={() => handleSort('status' as keyof Document)} className="w-20 px-4 py-3 text-center text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">状态 {getSortIcon('status' as keyof Document)}</th>
              <th className="w-20 px-4 py-3 text-center text-sm font-medium text-gray-500 select-none whitespace-nowrap">签出状态</th>
              <th className="w-16 px-4 py-3 text-center text-sm font-medium text-gray-500 select-none whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : filteredData.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">无匹配数据</td></tr>
            ) : (
              displayData.map((doc) => (
                <tr key={doc.id} className={`hover:bg-gray-50 cursor-pointer ${(doc as any).accessible === false ? 'opacity-60' : ''}`} onClick={() => setDetailDocId(doc.id)}>
                  <td className="px-4 py-3 text-sm font-medium">
                    {(doc as any).accessible === false && <span className="mr-1" title="无权限：需关联用户组成员">🔒</span>}
                    {doc.code}
                    {!showAllVersions && (versionCountMap[doc.code] || 0) > 1 && (
                      <span className="ml-1.5 text-xs text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
                        {(versionCountMap[doc.code] || 0)}个版本
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">{doc.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 text-center">{doc.version || '-'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusTag(doc.status).class}`}>
                      {getStatusTag(doc.status).label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-center">
                    {doc.check_out_user_name
                      ? <span className="text-orange-600">{doc.check_out_user_name}</span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-sm" onClick={(e) => e.stopPropagation()}>
                    {(() => {
                      const isCreator = (doc as any).creator_id === useAuthStore.getState().user?.id;
                      const canManage = isAdmin() || isCreator;
                      return canManage && (doc as any).accessible !== false ? (
                        <button onClick={() => setDeleteId(doc.id)} className="text-red-500 hover:text-red-700">删除</button>
                      ) : null;
                    })()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
                    const res = await documentsApi.get(id);
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
          loadDocuments();
        }}
        onSaved={() => loadDocuments()}
      />
    </div>
  );
}
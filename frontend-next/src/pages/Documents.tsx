import { useEffect, useState } from 'react';
import { documentsApi, customFieldsApi } from '../services/api';
import type { Document, CustomFieldDefinition, CustomFieldValue } from '../types';
import { canEdit, isAdmin } from '../stores/auth';
import { Modal, ConfirmModal } from '../components/Modal';
import { getNextVersion } from '../constants';
import { useDataStore } from '../stores/data';
import { formatDateTime } from '../utils/date';
import { useTableSort } from '../hooks/useTableSort';

interface DocFormData {
  code: string;
  name: string;
  version: string;
  status: string;
  remark: string;
}

const initialFormData: DocFormData = {
  code: '',
  name: '',
  version: 'A',
  status: 'draft',
  remark: '',
};

export default function Documents() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<Document | null>(null);
  const [formData, setFormData] = useState<DocFormData>(initialFormData);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // 详情弹窗
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
  const [viewingCustomDefs, setViewingCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [viewingCustomValues, setViewingCustomValues] = useState<Record<string, any>>({});

  // 从 store 订阅数据
  const storeDocuments = useDataStore((s) => s.documents);

  // Custom fields
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, any>>({});
  const [loadingCustomFields, setLoadingCustomFields] = useState(false);

  useEffect(() => {
    loadDocuments();
  }, [search, status, storeDocuments]);

  const { sortedData, handleSort, getSortIcon } = useTableSort<Document>(documents);

  const loadDocuments = () => {
    const localDocuments = useDataStore.getState().documents;
    setDocuments(localDocuments);
    setLoading(false);
  };

  const loadCustomFields = async () => {
    const localDefs = useDataStore.getState().customFieldDefs;
    if (localDefs.length > 0) {
      setCustomFieldDefs(localDefs.filter((d: CustomFieldDefinition) =>
        d.applies_to?.includes('document')
      ));
      setLoadingCustomFields(false);
      return;
    }
    try {
      setLoadingCustomFields(true);
      const response = await customFieldsApi.listDefinitions();
      const defs = (response.data || []).filter((d: CustomFieldDefinition) =>
        d.applies_to?.includes('document')
      );
      setCustomFieldDefs(defs);
    } catch (error) {
      console.error('加载自定义字段失败', error);
    } finally {
      setLoadingCustomFields(false);
    }
  };

  const loadCustomFieldValues = async (docId: string) => {
    try {
      const response = await customFieldsApi.getValues('document', docId);
      const values: Record<string, any> = {};
      (response.data || []).forEach((v: CustomFieldValue) => {
        values[v.field_id] = v.value;
      });
      setCustomFieldValues(values);
    } catch (error) {
      console.error('加载自定义字段值失败', error);
    }
  };

  const handleAdd = () => {
    setEditingDoc(null);
    setFormData(initialFormData);
    setCustomFieldValues({});
    loadCustomFields();
    setModalOpen(true);
  };

  const handleEdit = async (doc: Document) => {
    setEditingDoc(doc);
    setFormData({
      code: doc.code,
      name: doc.name,
      version: doc.version || 'A',
      status: doc.status,
      remark: doc.remark || '',
    });
    await loadCustomFields();
    await loadCustomFieldValues(doc.id);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);

    const data = {
      code: formData.code,
      name: formData.name,
      version: formData.version || undefined,
      status: formData.status,
      remark: formData.remark || undefined,
    };

    try {
      let newDoc: Document | null = null;
      if (editingDoc) {
        const res = await documentsApi.update(editingDoc.id, data);
        newDoc = res.data;
        useDataStore.getState().setDocuments(
          useDataStore.getState().documents.map(d => d.id === editingDoc.id ? newDoc! : d)
        );
      } else {
        const res = await documentsApi.create(data);
        newDoc = res.data;
        useDataStore.getState().setDocuments([...useDataStore.getState().documents, newDoc!]);
      }

      const fieldValues = customFieldDefs.map(def => ({
        field_id: def.id,
        value: customFieldValues[def.id] ?? null,
      })).filter(fv => fv.value !== null && fv.value !== '');
      
      if (fieldValues.length > 0) {
        await customFieldsApi.setValues('document', newDoc!.id, fieldValues);
      }

      setModalOpen(false);
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      setSaveError(Array.isArray(detail) ? detail.map((e: any) => e.msg || JSON.stringify(e)).join('; ') : (typeof detail === 'string' ? detail : (editingDoc ? '更新失败，请重试' : '创建失败，请检查网络或数据是否已存在')));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
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

  const renderCustomFieldInput = (def: CustomFieldDefinition) => {
    const value = customFieldValues[def.id] ?? '';
    const handleChange = (v: any) => {
      setCustomFieldValues({ ...customFieldValues, [def.id]: v });
    };

    if (def.field_type === 'select' && def.options?.length) {
      return (
        <select
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">请选择</option>
          {def.options.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    }
    if (def.field_type === 'number') {
      return (
        <input
          type="number"
          value={value}
          onChange={(e) => handleChange(e.target.value ? Number(e.target.value) : null)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      );
    }
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">图文档管理</h2>
        {canEdit() && (
          <button onClick={handleAdd} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
            + 新增图文档
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="搜索图文档编号/名称..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 flex-1"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="frozen">冻结</option>
          <option value="released">发布</option>
          <option value="obsolete">作废</option>
        </select>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th onClick={() => handleSort('code' as keyof Document)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">编号 {getSortIcon('code' as keyof Document)}</th>
              <th onClick={() => handleSort('name' as keyof Document)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">名称 {getSortIcon('name' as keyof Document)}</th>
              <th onClick={() => handleSort('version' as keyof Document)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">版本 {getSortIcon('version' as keyof Document)}</th>
              <th onClick={() => handleSort('status' as keyof Document)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">状态 {getSortIcon('status' as keyof Document)}</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : sortedData.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">暂无数据</td></tr>
            ) : (
              sortedData.map((doc) => (
                <tr key={doc.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => handleView(doc)}>
                  <td className="px-4 py-3 text-sm font-medium">{doc.code}</td>
                  <td className="px-4 py-3 text-sm">{doc.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{doc.version || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusTag(doc.status).class}`}>
                      {getStatusTag(doc.status).label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => handleEdit(doc)} className="text-primary-600 hover:text-primary-800 mr-3">编辑</button>
                    {isAdmin() && (
                      <button onClick={() => setDeleteId(doc.id)} className="text-red-600 hover:text-red-800">删除</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalOpen}
        title={editingDoc ? '编辑图文档' : '新增图文档'}
        onClose={() => setModalOpen(false)}
        width="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">编号 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">名称 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">版本</label>
              <input
                type="text"
                value={formData.version}
                onChange={(e) => setFormData({ ...formData, version: e.target.value.toUpperCase() })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="如: A, B, V1.0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="draft">草稿</option>
                <option value="frozen">冻结</option>
                <option value="released">发布</option>
                <option value="obsolete">作废</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <textarea
              value={formData.remark}
              onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              rows={3}
              placeholder="可选"
            />
          </div>

          {/* Custom Fields */}
          {customFieldDefs.length > 0 && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">自定义字段</h4>
              {loadingCustomFields ? (
                <div className="text-sm text-gray-500">加载中...</div>
              ) : (
                <div className="space-y-3">
                  {customFieldDefs.map(def => (
                    <div key={def.id}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {def.name}
                        {def.is_required && <span className="text-red-500 ml-1">*</span>}
                      </label>
                      {renderCustomFieldInput(def)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {saveError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
              {saveError}
            </div>
          )}

          <div className="flex justify-between items-center gap-2 pt-4 border-t">
            <div>
              {editingDoc && (editingDoc.status === 'released' || editingDoc.status === 'obsolete') && (
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, version: getNextVersion(formData.version) })}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  title="升版"
                >
                  升版
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={!!deleteId}
        title="确认删除"
        content="确定要删除该图文档吗？此操作不可撤销。"
        confirmText="删除"
        cancelText="取消"
        type="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />

      {/* 图文档详情弹窗 */}
      <Modal
        open={!!viewingDoc}
        title="图文档详情"
        onClose={() => setViewingDoc(null)}
        width="lg"
      >
        {viewingDoc && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">图文档编号</label>
                <div className="text-sm font-medium">{viewingDoc.code}</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">图文档名称</label>
                <div className="text-sm">{viewingDoc.name}</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">版本</label>
                <div className="text-sm">{viewingDoc.version || '-'}</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">状态</label>
                <span className={`inline-block px-2 py-1 text-xs rounded-full ${getStatusTag(viewingDoc.status).class}`}>
                  {getStatusTag(viewingDoc.status).label}
                </span>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">备注</label>
                <div className="text-sm">{viewingDoc.remark || '-'}</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">创建时间</label>
                <div className="text-sm">{formatDateTime(viewingDoc.created_at)}</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">更新时间</label>
                <div className="text-sm">{formatDateTime(viewingDoc.updated_at)}</div>
              </div>
            </div>

            {/* 自定义字段 */}
            {viewingCustomDefs.length > 0 && (
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium text-gray-700 mb-3">自定义字段</h4>
                <div className="grid grid-cols-2 gap-4">
                  {viewingCustomDefs.map(def => (
                    <div key={def.id}>
                      <label className="block text-xs font-medium text-gray-500 mb-1">{def.name}</label>
                      <div className="text-sm">
                        {def.field_type === 'select'
                          ? (def.options || []).find(o => o === viewingCustomValues[def.id]) || viewingCustomValues[def.id] || '-'
                          : (viewingCustomValues[def.id] ?? '-')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
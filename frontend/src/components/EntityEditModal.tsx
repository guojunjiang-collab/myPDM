import { useState, useEffect, useRef, useCallback } from 'react';
import { Modal } from './Modal';
import { customFieldsApi, partsApi, assembliesApi, assemblyPartsApi } from '../services/api';
import { useDataStore } from '../stores/data';
import EntityDocumentSection from './EntityDocumentSection';
import AssemblyPartPicker from './AssemblyPartPicker';
import VersionSelectModal from './VersionSelectModal';
import type { CustomFieldDefinition, AssemblyPartItem } from '../types';

interface EntityEditModalProps {
  open: boolean;
  entityType: 'part' | 'assembly';
  entityId: string;
  onClose: () => void;
  onSaved: () => void;
}

const STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'frozen', label: '冻结' },
  { value: 'released', label: '发布' },
  { value: 'obsolete', label: '作废' },
];

export default function EntityEditModal({ open, entityType, entityId, onClose, onSaved }: EntityEditModalProps) {
  const [formData, setFormData] = useState({ code: '', name: '', spec: '', remark: '', status: 'draft' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, any>>({});
  const [loadingCustomFields, setLoadingCustomFields] = useState(false);
  const specRef = useRef<HTMLTextAreaElement>(null);
  const remarkRef = useRef<HTMLTextAreaElement>(null);

  // 子项清单（部件专用）
  const [editParts, setEditParts] = useState<AssemblyPartItem[]>([]);
  const [loadingEditParts, setLoadingEditParts] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [versionSelectState, setVersionSelectState] = useState<{ itemId: string; childType: string } | null>(null);

  const api = entityType === 'assembly' ? assembliesApi : partsApi;
  const cfType = entityType === 'assembly' ? 'component' : 'part';

  const loadEditParts = useCallback(async (assemblyId: string) => {
    setLoadingEditParts(true);
    try {
      const res = await assemblyPartsApi.list(assemblyId);
      setEditParts(res.data || []);
    } catch {
      setEditParts([]);
    } finally {
      setLoadingEditParts(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !entityId) return;
    setLoading(true);
    setSaveError(null);
    api.get(entityId).then(r => {
      const d = r.data;
      setFormData({ code: d.code || '', name: d.name || '', spec: d.spec || '', remark: d.remark || '', status: d.status || 'draft' });
    }).catch(() => { setSaveError('加载失败'); }).finally(() => setLoading(false));

    // 加载自定义字段定义
    const allDefs = useDataStore.getState().customFieldDefs;
    const defs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes(cfType));
    setCustomFieldDefs(defs);

    // 加载自定义字段值
    setLoadingCustomFields(true);
    customFieldsApi.getValues(cfType, entityId).then(r => {
      const vals: Record<string, any> = {};
      (r.data || []).forEach((v: any) => { vals[v.field_id] = v.value; });
      setCustomFieldValues(vals);
    }).catch(() => {}).finally(() => setLoadingCustomFields(false));

    // 加载子项清单（部件专用）
    if (entityType === 'assembly') {
      loadEditParts(entityId);
    }
  }, [open, entityId, entityType]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      [specRef, remarkRef].forEach(ref => {
        const el = ref.current;
        if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [open, formData.spec, formData.remark]);

  const handleAddParts = async (items: { child_type: string; child_id: string; quantity: number }[]) => {
    try {
      await Promise.all(items.map((it) => assemblyPartsApi.add(entityId, it)));
      await loadEditParts(entityId);
      setPickerOpen(false);
    } catch {
      alert('添加子项失败');
    }
  };

  const handleRemovePart = async (itemId: string) => {
    try {
      await assemblyPartsApi.remove(entityId, itemId);
      await loadEditParts(entityId);
    } catch {
      alert('删除子项失败');
    }
  };

  const handleVersionSelectChild = async (selectedVersionId: string) => {
    if (!versionSelectState) return;
    const item = editParts.find(p => p.id === versionSelectState.itemId);
    if (!item) return;
    try {
      await assemblyPartsApi.remove(entityId, versionSelectState.itemId);
      await assemblyPartsApi.add(entityId, {
        child_type: versionSelectState.childType,
        child_id: selectedVersionId,
        quantity: item.quantity,
      });
      await loadEditParts(entityId);
    } catch {
      alert('切换版本失败');
    } finally {
      setVersionSelectState(null);
    }
  };

  const handleUpdateQuantity = async (itemId: string, qty: number) => {
    try {
      await assemblyPartsApi.update(entityId, itemId, { quantity: qty });
    } catch {
      alert('更新用量失败');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await api.update(entityId, {
        code: formData.code,
        name: formData.name,
        spec: formData.spec || undefined,
        remark: formData.remark || undefined,
        status: formData.status,
      });
      // 保存自定义字段值
      const fieldDefs = customFieldDefs.filter(d => d.applies_to?.includes(cfType));
      const fieldValues = fieldDefs.map(def => ({
        field_id: def.id,
        value: customFieldValues[def.id] ?? null,
      })).filter(fv => fv.value !== null && fv.value !== '');
      if (fieldValues.length > 0) {
        await customFieldsApi.setValues(cfType, entityId, fieldValues);
      }
      onSaved();
      onClose();
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      setSaveError(Array.isArray(detail) ? detail.map((e: any) => e.msg || JSON.stringify(e)).join('; ') : (typeof detail === 'string' ? detail : '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const renderCustomFieldInput = (def: CustomFieldDefinition) => {
    const value = customFieldValues[def.id] ?? '';
    const onChange = (val: any) => setCustomFieldValues(prev => ({ ...prev, [def.id]: val }));
    const baseClass = "w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500";

    if (def.field_type === 'select') {
      return (
        <select value={value} onChange={e => onChange(e.target.value)} className={baseClass}>
          <option value="">请选择</option>
          {(def.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    }
    if (def.field_type === 'number') {
      return <input type="number" value={value} onChange={e => onChange(e.target.value)} className={baseClass} />;
    }
    return <input type="text" value={value} onChange={e => onChange(e.target.value)} className={baseClass} />;
  };

  const title = entityType === 'assembly' ? '编辑部件' : '编辑零件';
  const existingChildIds = new Set(editParts.map((p) => p.child_id));

  return (
    <>
    <Modal open={open} title={title} onClose={onClose} width="full">
      {loading ? (
        <div className="text-center py-8 text-sm text-gray-400">加载中...</div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">件号</label>
              <input type="text" value={formData.code} disabled className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-100 text-gray-500" />
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">中文名称 <span className="text-red-500">*</span></label>
              <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" required />
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">版本</label>
              <input type="text" value="-" disabled className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-100 text-gray-500" />
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">状态</label>
              <select value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500">
                {STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div className="col-span-2 md:col-span-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">规格型号</label>
              <textarea ref={specRef} value={formData.spec} onChange={e => setFormData({ ...formData, spec: e.target.value })} onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none" rows={1} />
            </div>
            <div className="col-span-2 md:col-span-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">备注</label>
              <textarea ref={remarkRef} value={formData.remark} onChange={e => setFormData({ ...formData, remark: e.target.value })} onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }} className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none" rows={1} placeholder="可选" />
            </div>
          </div>

          {/* 自定义字段 */}
          {customFieldDefs.length > 0 && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-bold text-gray-700 mb-2">自定义字段</h4>
              {loadingCustomFields ? (
                <div className="text-sm text-gray-500">加载中...</div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {customFieldDefs.map(def => (
                    <div key={def.id} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                      <label className="block text-xs text-gray-500 mb-0.5">
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

          {/* 关联图文档 */}
          <EntityDocumentSection entityType={entityType} entityId={entityId} editable />

          {/* 子项清单（仅部件编辑时显示） */}
          {entityType === 'assembly' && (
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-bold text-gray-700">子项清单</h4>
                <button type="button" onClick={() => setPickerOpen(true)} className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">+ 添加子项</button>
              </div>
              <div className="border rounded-lg overflow-hidden">
                {loadingEditParts ? (
                  <div className="px-4 py-8 text-center text-sm text-gray-400">加载子项中...</div>
                ) : editParts.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-gray-400">暂无子项</div>
                ) : (
                  <div className="max-h-[240px] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">类型</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">件号</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">中文名称</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium">规格型号</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">版本</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">状态</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">用量</th>
                          <th className="px-3 py-2 text-right text-gray-500 font-medium w-24">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {editParts.map((part) => (
                          <tr key={part.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <span className={`px-1.5 py-0.5 text-xs rounded ${part.childType === 'part' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}`}>
                                {part.childType === 'part' ? '零件' : '部件'}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-medium">{part.child_detail?.code || '-'}</td>
                            <td className="px-3 py-2">{part.child_detail?.name || '-'}</td>
                            <td className="px-3 py-2 text-gray-500">{part.child_detail?.spec || '-'}</td>
                            <td className="px-3 py-2 text-gray-500">{part.child_detail?.version || '-'}</td>
                            <td className="px-3 py-2">
                              <span className={`px-1.5 py-0.5 text-xs rounded ${
                                part.child_detail?.status === 'released' ? 'bg-green-100 text-green-800' :
                                part.child_detail?.status === 'draft' ? 'bg-blue-100 text-blue-800' :
                                part.child_detail?.status === 'frozen' ? 'bg-orange-100 text-orange-800' :
                                'bg-red-100 text-red-800'
                              }`}>
                                {part.child_detail?.status === 'released' ? '发布' : part.child_detail?.status === 'draft' ? '草稿' : part.child_detail?.status === 'frozen' ? '冻结' : '作废'}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <input type="number" min={1} defaultValue={part.quantity} onBlur={e => { const v = parseInt(e.target.value); if (v > 0 && v !== part.quantity) handleUpdateQuantity(part.id, v); }} className="w-16 px-1.5 py-0.5 border border-gray-300 rounded text-right text-sm focus:outline-none focus:ring-1 focus:ring-primary-500" />
                            </td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <span className="inline-flex items-center gap-1">
                                <button type="button" onClick={() => setVersionSelectState({ itemId: part.id, childType: part.childType === 'component' ? 'assembly' : part.childType })} className="text-primary-600 hover:text-primary-800 text-xs" title="选择版本">选择</button>
                                <button type="button" onClick={() => handleRemovePart(part.id)} className="text-red-500 hover:text-red-700 text-xs" title="移除子项">移除</button>
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {saveError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">{saveError}</div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      )}
    </Modal>

    {/* 子项选择弹窗 */}
    {entityType === 'assembly' && (
      <AssemblyPartPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={handleAddParts}
        currentAssemblyId={entityId}
        existingChildIds={existingChildIds}
      />
    )}

    {/* 版本选择弹窗 */}
    {versionSelectState && (
      <VersionSelectModal
        open={!!versionSelectState}
        entityType={versionSelectState.childType === 'part' ? 'part' : 'assembly'}
        entityId={editParts.find(p => p.id === versionSelectState.itemId)?.child_id || ''}
        entityName={editParts.find(p => p.id === versionSelectState.itemId)?.child_detail?.code || ''}
        currentVersionId={editParts.find(p => p.id === versionSelectState.itemId)?.child_id || ''}
        onSelect={handleVersionSelectChild}
        onClose={() => setVersionSelectState(null)}
      />
    )}
    </>
  );
}

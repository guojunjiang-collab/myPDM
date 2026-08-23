import { useState, useEffect, useRef, useCallback } from 'react';
import { Modal } from './Modal';
import { customFieldsApi, partsApi } from '../services/api';
import { useDataStore } from '../stores/data';
import { isAdmin } from '../stores/auth';
import EntityDocumentSection from './EntityDocumentSection';
import AssemblyPartPicker from './AssemblyPartPicker';
import VersionSelectModal from './VersionSelectModal';
import type { CustomFieldDefinition, AssemblyPartItem } from '../types';
import CustomFieldInput from './CustomFieldInput';
import Badge from './ui/Badge';
import Button from './ui/Button';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import TreeToggle from './ui/TreeToggle';

interface EntityEditModalProps {
  open: boolean;
  entityType: 'part' | 'assembly' | 'component';
  entityId: string;
  entityCode?: string;
  entityName?: string;
  onClose: () => void;
  onSaved: () => void;
}

const STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'frozen', label: '冻结' },
  { value: 'released', label: '发布' },
  { value: 'obsolete', label: '作废' },
];

export default function EntityEditModal({ open, entityType, entityId, entityCode, entityName, onClose, onSaved }: EntityEditModalProps) {
  const [formData, setFormData] = useState({ code: '', name: '', spec: '', version: '-', status: 'draft' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, any>>({});
  const [loadingCustomFields, setLoadingCustomFields] = useState(false);
  // 审批锁定：加载时若该零部件已冻结/发布且当前用户非管理员，则整个表单只读
  const [locked, setLocked] = useState(false);
  const specRef = useRef<HTMLTextAreaElement>(null);

  // 当前版本的迭代ID（BOM 操作需要迭代级别）
  const [iterationId, setIterationId] = useState<string | undefined>();

  // 子项清单（部件专用）
  const [editParts, setEditParts] = useState<AssemblyPartItem[]>([]);
  const [loadingEditParts, setLoadingEditParts] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [versionSelectState, setVersionSelectState] = useState<{ itemId: string; childType: string } | null>(null);
  // 子项树形展开
  const [expandedParts, setExpandedParts] = useState<Record<string, any[]>>({});
  const [loadingPart, setLoadingPart] = useState<string | null>(null);
  // 选择器目标（null=当前部件, string=子部件 revision_id）
  const [pickerTargetId, setPickerTargetId] = useState<string | null>(null);
  // 当前编辑版本对应的 master_id（保存基本信息用）
  const [masterId, setMasterId] = useState('');

  const cfType = entityType === 'part' ? 'part' : 'component';

  /** 把 partsApi.getBOM 扁平子项映射为编辑用行结构（child_id 用 revision_id） */
  const mapBom = (rows: any[], parentRevId: string): any[] =>
    (rows || []).map((c) => ({
      id: c.id,
      childType: c.child_type === 'assembly' ? 'assembly' : 'part',
      child_id: c.child_revision_id,
      child_master_id: c.child_master_id,
      child_revision_id: c.child_revision_id,
      parent_id: parentRevId,
      quantity: c.quantity,
      child_detail: {
        id: c.child_master_id,
        code: c.child_code,
        name: c.child_name,
        spec: c.child_spec,
        version: c.child_version,
        status: c.child_status,
      },
    }));

  const loadEditParts = useCallback(async (revisionId: string) => {
    setLoadingEditParts(true);
    try {
      const rev = await partsApi.getRevision(revisionId);
      const iterId = rev?.current_iteration?.id;
      const rows = await partsApi.getBOM(revisionId, iterId);
      setEditParts(mapBom(rows as any[], revisionId) as any);
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
    // entityId 为 revision_id：取版本 + 其 master 组合基本信息
    partsApi.getRevision(entityId).then(async (rev: any) => {
      let master: any = {};
      try { master = await partsApi.get(rev.master_id); } catch { /* ignore */ }
      setMasterId(rev.master_id || '');
      setFormData({
        code: master.code || '', name: master.name || '', spec: master.spec || '',
        version: rev.version || '-', status: rev.status || 'draft',
      });
      setIterationId(rev.current_iteration?.id);
      setLocked((rev.status === 'frozen' || rev.status === 'released') && !isAdmin());
    }).catch(() => { setSaveError('加载失败'); }).finally(() => setLoading(false));

    // 加载自定义字段定义
    const allDefs = useDataStore.getState().customFieldDefs;
    const defs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes(cfType));
    setCustomFieldDefs(defs);

    // 加载自定义字段值（按 revision_id）
    setLoadingCustomFields(true);
    customFieldsApi.getValues(cfType, entityId).then(r => {
      const vals: Record<string, any> = {};
      (r.data || []).forEach((v: any) => { vals[v.field_id] = v.value; });
      setCustomFieldValues(vals);
    }).catch(() => {}).finally(() => setLoadingCustomFields(false));

    // 加载子项清单（部件专用）
    if (entityType === 'assembly' || entityType === 'component') {
      loadEditParts(entityId);
    }
  }, [open, entityId, entityType]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      [specRef].forEach(ref => {
        const el = ref.current;
        if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [open, formData.spec]);

  const handleAddParts = async (items: { child_type: string; child_id: string; quantity: number }[]) => {
    try {
      const targetId = pickerTargetId || entityId;
      await Promise.all(items.map((it) => partsApi.addBOMItem(targetId, { child_revision_id: it.child_id, quantity: it.quantity }, iterationId)));
      if (pickerTargetId) {
        refreshParentParts(pickerTargetId);
      } else {
        await loadEditParts(entityId);
      }
      setPickerOpen(false);
      setPickerTargetId(null);
    } catch {
      alert('添加子项失败');
    }
  };

  const handleRemovePart = async (itemId: string) => {
    try {
      await partsApi.deleteBOMItem(entityId, itemId);
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
      await partsApi.deleteBOMItem(entityId, versionSelectState.itemId);
      await partsApi.addBOMItem(entityId, { child_revision_id: selectedVersionId, quantity: item.quantity }, iterationId);
      await loadEditParts(entityId);
    } catch {
      alert('切换版本失败');
    } finally {
      setVersionSelectState(null);
    }
  };

  const handleUpdateQuantity = async (itemId: string, qty: number) => {
    try {
      await partsApi.updateBOMItem(entityId, itemId, { quantity: qty });
    } catch {
      alert('更新用量失败');
    }
  };

  // 展开/折叠子部件的子项（childRevId 为子部件 revision_id）
  const toggleExpand = async (idx: string, childRevId: string) => {
    if (expandedParts[idx]) { setExpandedParts(p => { const n = { ...p }; delete n[idx]; return n; }); return; }
    setLoadingPart(idx);
    try {
      const rows = await partsApi.getBOM(childRevId);
      setExpandedParts(p => ({ ...p, [idx]: mapBom(rows as any[], childRevId) }));
    } catch { } finally { setLoadingPart(null); }
  };

  // 刷新指定父级的展开子项（嵌套操作后使用；parentId 为父 revision_id）
  const refreshParentParts = (parentId: string) => {
    for (const [key, rows] of Object.entries(expandedParts)) {
      if (rows.length > 0 && rows[0]?.parent_id === parentId) {
        partsApi.getBOM(parentId).then(fresh => {
          setExpandedParts(p => ({ ...p, [key]: mapBom(fresh as any[], parentId) }));
        }).catch(() => {});
        return;
      }
    }
  };

  // 嵌套行：移除
  const handleNestedRemove = async (parentId: string, itemId: string) => {
    await partsApi.deleteBOMItem(parentId, itemId);
    refreshParentParts(parentId);
  };

  // 嵌套行：更新用量
  const handleNestedQuantity = async (parentId: string, itemId: string, qty: number) => {
    await partsApi.updateBOMItem(parentId, itemId, { quantity: qty });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (locked) return;  // 审批锁定：冻结/发布件非管理员不可保存（后端亦有校验兜底）
    setSaving(true);
    setSaveError(null);
    try {
      await partsApi.update(masterId, {
        code: formData.code,
        name: formData.name,
        spec: formData.spec || undefined,
      });
      // 保存自定义字段值
      const fieldDefs = customFieldDefs.filter(d => d.applies_to?.includes(cfType));
      const fieldValues = fieldDefs.map(def => ({
        field_id: def.id,
        value: customFieldValues[def.id] ?? null,
      }));
      await customFieldsApi.setValues(cfType, entityId, fieldValues);
      onSaved();
      onClose();
    } catch (error: any) {
      const detail = error.response?.data?.detail;
      setSaveError(Array.isArray(detail) ? detail.map((e: any) => e.msg || JSON.stringify(e)).join('; ') : (typeof detail === 'string' ? detail : '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const renderPartRow = (part: any, level: number, idx: string): React.ReactNode => {
    const isAssembly = part.childType === 'assembly' || part.childType === 'component';
    const childRows = expandedParts[idx];
    const hasChildren = isAssembly;

    return (
      <>
        <tr key={idx} className="hover:bg-[var(--ui-bg-hover)]">
          <td className="px-3 py-2 text-sm text-[var(--ui-text-tertiary)] whitespace-nowrap">
            <span>{'-'.repeat(level)}{level}</span>
            {hasChildren && (
              <span className="ml-1 inline-flex"><TreeToggle expanded={!!childRows} onClick={() => toggleExpand(idx, part.child_id)} size="md" title={childRows ? '折叠' : '展开'} /></span>
            )}
          </td>
          <td className="px-3 py-2">
            <Badge tone={isAssembly ? 'blue' : 'gray'} label={isAssembly ? '部件' : '零件'} />
          </td>
          <td className="px-3 py-2 font-medium">{part.child_detail?.code || '-'}</td>
          <td className="px-3 py-2">{part.child_detail?.name || '-'}</td>
          <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{part.child_detail?.spec || '-'}</td>
          <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{part.child_detail?.version || '-'}</td>
          <td className="px-3 py-2">
            <Badge status={part.child_detail?.status} />
          </td>
          <td className="px-3 py-2">
            {level === 0 ? (
              <Input size="xs" type="number" min={1} defaultValue={part.quantity} disabled={locked} onBlur={e => { const v = parseInt(e.target.value); if (v > 0 && v !== part.quantity) handleUpdateQuantity(part.id, v); }} className="!w-16 text-right" />
            ) : (
              <Input size="xs" type="number" min={1} defaultValue={part.quantity} disabled={locked} onBlur={e => { const v = parseInt(e.target.value); if (v > 0 && v !== part.quantity) handleNestedQuantity(part.parent_id || part.id, part.id, v); }} className="!w-16 text-right" />
            )}
          </td>
          <td className="px-3 py-2 text-right whitespace-nowrap">
            {locked ? <span className="text-gray-300 text-xs">—</span> : (
            <span className="inline-flex items-center gap-1">
              <Button variant="link" size="xs" type="button" onClick={() => setVersionSelectState({ itemId: part.id, childType: part.childType === 'assembly' ? 'assembly' : part.childType })} title="选择版本">选择</Button>
              {isAssembly && (
                <Button variant="link" size="xs" type="button" onClick={() => {
                  setPickerTargetId(part.child_id); setPickerOpen(true);
                }} title="添加子项">+子项</Button>
              )}
              <Button variant="danger" size="xs" type="button" onClick={() => {
                if (level === 0) { handleRemovePart(part.id); }
                else { handleNestedRemove(part.parent_id || entityId, part.id); }
              }} title="移除子项">移除</Button>
            </span>
            )}
          </td>
        </tr>
        {childRows && childRows.map((c: any, j: number) => renderPartRow(c, level + 1, `${idx}-${j}`))}
        {loadingPart === idx && <tr><td colSpan={9} className="px-3 py-2 text-sm text-[var(--ui-text-tertiary)] text-center">加载中...</td></tr>}
      </>
    );
  };



  const title = entityType === 'component' ? '编辑零部件' : entityType === 'assembly' ? '编辑部件' : '编辑零件';

  return (
    <>
    <Modal open={open} title={title} onClose={onClose} width="full">
      {loading ? (
        <div className="text-center py-8 text-sm text-[var(--ui-text-tertiary)]">加载中...</div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {locked && (
            <div className="bg-orange-50 border border-orange-200 text-orange-700 px-4 py-2 rounded-lg text-sm">
              该零部件{formData.status === 'released' ? '已发布' : '已冻结'}，审批/发布期间不可修改（仅管理员可修改）。
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">件号</label>
              <Input size="xs" type="text" value={formData.code} onChange={e => setFormData({ ...formData, code: e.target.value })} disabled={!(isAdmin() && formData.version === 'A')} title={isAdmin() ? (formData.version === 'A' ? '管理员可修改件号' : '仅 A 版允许修改件号，升版后的版本不可改') : undefined} />
            </div>
            <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">中文名称 <span className="text-red-500">*</span></label>
              <Input size="xs" type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} disabled={locked} required />
            </div>
            <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">版本</label>
              <Input size="xs" type="text" value={formData.version} disabled />
            </div>
            <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">状态</label>
              <Select size="xs" value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })} disabled={locked}>
                {STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </Select>
            </div>
            <div className="col-span-2 md:col-span-2 bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">规格型号</label>
              <Textarea size="xs" ref={specRef} value={formData.spec} onChange={e => setFormData({ ...formData, spec: e.target.value })} disabled={locked} onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }} className="resize-none" rows={1} />
            </div>
          </div>

          {/* 自定义字段 */}
          {customFieldDefs.length > 0 && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-bold text-gray-700 mb-2">自定义字段</h4>
              {loadingCustomFields ? (
                <div className="text-sm text-[var(--ui-text-secondary)]">加载中...</div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {customFieldDefs.map(def => (
                    <div key={def.id} className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                      <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">
                        {def.name}
                        {def.is_required && <span className="text-red-500 ml-1">*</span>}
                      </label>
                      <CustomFieldInput
                        def={def}
                        value={customFieldValues[def.id]}
                        onChange={(val) => setCustomFieldValues(prev => ({ ...prev, [def.id]: val }))}
                        disabled={locked}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 关联图文档 */}
          <EntityDocumentSection entityType={entityType} entityId={entityId} entityCode={entityCode} entityName={entityName} editable={!locked} />

          {/* 子项清单（部件编辑时显示） */}
          {(entityType === 'assembly' || entityType === 'component') && (
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-bold text-gray-700">子项清单</h4>
                {!locked && <Button size="sm" type="button" onClick={() => { setPickerTargetId(null); setExpandedParts({}); setPickerOpen(true); }}>+ 添加子项</Button>}
              </div>
              <div className="border rounded-lg overflow-hidden">
                {loadingEditParts ? (
                  <div className="px-4 py-8 text-center text-sm text-[var(--ui-text-tertiary)]">加载子项中...</div>
                ) : editParts.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-[var(--ui-text-tertiary)]">暂无子项</div>
                ) : (
                  <div className="max-h-[400px] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--ui-bg-subtle)] border-b sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">层级</th>
                          <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">类型</th>
                          <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">件号</th>
                          <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">中文名称</th>
                          <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">规格型号</th>
                          <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">版本</th>
                          <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">状态</th>
                          <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-20">用量</th>
                          <th className="px-3 py-2 text-right text-[var(--ui-text-secondary)] font-medium w-32">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {editParts.slice().sort((a, b) => (a.child_detail?.code || '').localeCompare(b.child_detail?.code || '', 'zh-CN')).map((part, i) => renderPartRow(part, 0, String(i)))}
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
            <Button variant="secondary" type="button" onClick={onClose}>{locked ? '关闭' : '取消'}</Button>
            {!locked && (
              <Button type="submit" disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </Button>
            )}
          </div>
        </form>
      )}
    </Modal>

    {/* 子项选择弹窗 */}
    {(entityType === 'assembly' || entityType === 'component') && (
      <AssemblyPartPicker
        open={pickerOpen}
        onClose={() => { setPickerOpen(false); setPickerTargetId(null); }}
        onConfirm={handleAddParts}
        currentAssemblyId={pickerTargetId || entityId}
        existingChildIds={new Set(editParts.map(p => p.child_id))}
      />
    )}

    {/* 版本选择弹窗 */}
    {versionSelectState && (
      <VersionSelectModal
        open={!!versionSelectState}
        entityType={versionSelectState.childType === 'part' ? 'part' : 'assembly'}
        entityId={editParts.find(p => p.id === versionSelectState.itemId)?.child_master_id || ''}
        entityName={editParts.find(p => p.id === versionSelectState.itemId)?.child_detail?.code || ''}
        currentVersionId={editParts.find(p => p.id === versionSelectState.itemId)?.child_revision_id || ''}
        onSelect={handleVersionSelectChild}
        onClose={() => setVersionSelectState(null)}
      />
    )}
    </>
  );
}

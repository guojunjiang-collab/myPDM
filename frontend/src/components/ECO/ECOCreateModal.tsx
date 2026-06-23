import { useState, useEffect, useCallback, useRef } from 'react';
import { Modal } from '../Modal';
import { toast } from '../Toast';
import { ecoApi, usersApi, documentsApi, ecrApi, partsApi, assembliesApi, assemblyPartsApi, customFieldsApi } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { useDataStore } from '../../stores/data';
import type { ECORequest, ECRDocumentLink } from '../../types';
import VersionSelectModal from '../VersionSelectModal';
import PartDetailContent from '../PartDetailContent';
import AssemblyDetailContent from '../AssemblyDetailContent';
import EntityEditModal from '../EntityEditModal';

const statusTag = (s: string) => {
  const labels: Record<string, string> = { draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废' };
  const colors: Record<string, string> = {
    draft: 'bg-blue-100 text-blue-800', frozen: 'bg-orange-100 text-orange-800',
    released: 'bg-green-100 text-green-800', obsolete: 'bg-red-100 text-red-800',
  };
  return { label: labels[s] || s, cls: colors[s] || 'bg-gray-100 text-gray-800' };
};
import { ECOEditView } from './ECOEditView';
import { ECRDocumentPicker } from '../ECR/ECRDocumentPicker';
import AssemblyPartPicker from '../AssemblyPartPicker';

const REASON_OPTIONS = [
  { value: 'quality_defect', label: '质量缺陷' },
  { value: 'design_opt', label: '设计优化' },
  { value: 'cost_reduce', label: '成本降低' },
  { value: 'customer_req', label: '客户要求' },
  { value: 'supplier_change', label: '供应商变更' },
  { value: 'process_improve', label: '工艺改进' },
  { value: 'new_release', label: '首次发布' },
  { value: 'other', label: '其他' },
];

const CATEGORY_OPTIONS = [
  { value: 'design_change', label: '设计变更' },
  { value: 'process_change', label: '工艺变更' },
  { value: 'material_change', label: '物料变更' },
  { value: 'new_release', label: '新发布' },
  { value: 'other', label: '其他' },
];

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: '紧急' },
  { value: 'high', label: '高' },
  { value: 'normal', label: '普通' },
  { value: 'low', label: '低' },
];

interface ReviewerFormItem {
  user_id: string;
  seq: number;
}

interface UserOption {
  id: string;
  real_name: string;
  username: string;
  role: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  ecrId?: string;
  ecrTitle?: string;
  ecrItems?: Array<{ entity_type: string; entity_name: string; entity_id?: string; action: string }>;
  editingEco?: ECORequest | null;
}

export function ECOCreateModal({ open, onClose, onCreated, ecrId, ecrTitle, ecrItems, editingEco }: Props) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [localEco, setLocalEco] = useState<ECORequest | null>(null);
  useEffect(() => {
    if (editingEco) { setLocalEco(editingEco ?? null); }
  }, [editingEco]);

  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('design_opt');
  const [category, setCategory] = useState('design_change');
  const [priority, setPriority] = useState('normal');
  const [description, setDescription] = useState('');
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [reviewers, setReviewers] = useState<ReviewerFormItem[]>([]);
  const [reviewMode, setReviewMode] = useState('all');
  const [users, setUsers] = useState<UserOption[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [bomData, setBomData] = useState<{ up: any[]; down: any[] } | null>(null);
  const [documentLinks, setDocumentLinks] = useState<ECRDocumentLink[]>([]);
  const [showDocPicker, setShowDocPicker] = useState(false);
  const [showEcrPicker, setShowEcrPicker] = useState(false);
  const [showReleasePicker, setShowReleasePicker] = useState(false);
  const [releaseItems, setReleaseItems] = useState<any[]>([]);
  const [docData, setDocData] = useState<Record<string, any>>({});
  const [docAttachments, setDocAttachments] = useState<Record<string, any[]>>({});
  const [docCustomValues, setDocCustomValues] = useState<Record<string, Record<string, any>>>({});
  const [versionSelectState, setVersionSelectState] = useState<{ docId: string; oldDocId: string } | null>(null);
  const [releaseVersionState, setReleaseVersionState] = useState<{ itemIdx: number; entityType: string; entityId: string; entityName: string } | null>(null);
  const [nestedDetail, setNestedDetail] = useState<{ type: string; id: string } | null>(null);
  const [nestedData, setNestedData] = useState<any>(null);
  const [nestedLoading, setNestedLoading] = useState(false);
  const [nestedCustomFields, setNestedCustomFields] = useState<{ defs: any[]; values: Record<string, any> }>({ defs: [], values: {} });
  const [editEntity, setEditEntity] = useState<{ type: string; id: string } | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const docFieldDefs = useDataStore((s) => s.customFieldDefs).filter((d) => d.applies_to?.includes('document'));
  const onCloseRef = useRef(onClose);
  const onCreatedRef = useRef(onCreated);
  onCloseRef.current = onClose;
  onCreatedRef.current = onCreated;

  useEffect(() => {
    if (submitted) {
      onCloseRef.current();
      onCreatedRef.current();
    }
  }, [submitted]);

  // Load document details when links change
  useEffect(() => {
    const ids = documentLinks.map(d => d.document_id);
    ids.forEach(id => {
      if (!docData[id]) {
        documentsApi.get(id).then(r => setDocData(prev => ({...prev, [id]: r.data}))).catch(() => {});
        documentsApi.listAttachments(id).then(r => setDocAttachments(prev => ({...prev, [id]: r.data||[]}))).catch(() => {});
        customFieldsApi.getValues('document', id).then(r => {
          const vals: Record<string, any> = {};
          (r.data || []).forEach((v: any) => { vals[v.field_id] = v.value; });
          setDocCustomValues(prev => ({...prev, [id]: vals}));
        }).catch(() => {});
      }
    });
  }, [documentLinks]);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const resp = await usersApi.list({ page_size: 200 });
      const data = resp.data;
      const list = data.items || data || [];
      setUsers(Array.isArray(list) ? list : []);
    } catch { /* silently fail */ }
    finally { setUsersLoading(false); }
  }, []);

  useEffect(() => {
    if (open) {
      loadUsers();
      setSubmitted(false);
      if (editingEco) {
        setTitle(editingEco.title || '');
        setReason(editingEco.reason || 'design_opt');
        setCategory(editingEco.category || 'design_change');
        setPriority(editingEco.priority || 'normal');
        setDescription(editingEco.description || '');
        setReviewers((editingEco.reviewers || []).map((r: { user_id: string; seq: number }) => ({ user_id: r.user_id, seq: r.seq })));
        setReviewMode(editingEco.review_mode || 'all');
        setDocumentLinks(editingEco.document_links || []);
        setReleaseItems(editingEco.release_items || []);
        // 刷新 release_items 状态（避免显示过期状态）
        (async () => {
          const items = editingEco.release_items || [];
          if (items.length > 0) {
            const refreshed = await Promise.all(items.map(async (ri: any) => {
              try {
                const api = ri.entity_type === 'assembly' ? assembliesApi : partsApi;
                const entity = await api.get(ri.entity_id);
                return { ...ri, status: entity.data.status };
              } catch { return ri; }
            }));
            setReleaseItems(refreshed);
          }
        })();
      } else {
        setTitle('');
        setReason('design_opt');
        setCategory('design_change');
        setPriority('normal');
        setDescription('');
        setReviewers([]);
        setReviewMode('all');
        setReleaseItems([]);
      }
      setErrors({});
    }
  }, [open, editingEco]);

  // Auto-resize description textarea
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const el = descRef.current;
      if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
    }, 0);
    return () => clearTimeout(timer);
  }, [open, description]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = '请输入标题';
    if (!reason) e.reason = '请选择变更原因';
    return Object.keys(e).length === 0;
  };

  const viewItem = async (entityType: string, entityId: string, mode?: 'view' | 'edit') => {
    if (mode === 'edit') {
      setEditEntity({ type: entityType, id: entityId });
      return;
    }
    setNestedDetail({ type: entityType, id: entityId });
    setNestedLoading(true);
    try {
      const api = entityType === 'assembly' ? assembliesApi : partsApi;
      const r = await api.get(entityId);
      setNestedData(r.data);
      // 加载自定义字段
      try {
        const cfType = entityType === 'assembly' ? 'component' : entityType;
        const allDefs = useDataStore.getState().customFieldDefs || [];
        const defs = allDefs.filter((d: any) => d.applies_to?.includes(cfType));
        const valsRes = await customFieldsApi.getValues(cfType, entityId);
        const vals: Record<string, any> = {};
        (valsRes.data || []).forEach((v: any) => { vals[v.field_id] = v.value; });
        setNestedCustomFields({ defs, values: vals });
      } catch { setNestedCustomFields({ defs: [], values: {} }); }
    } catch { toast.error('加载详情失败'); }
    finally { setNestedLoading(false); }
  };

  const handleExecuteAction = async (action: string, itemId: string, newEntityId?: string, entityInfo?: { entity_type: string; entity_id: string; entity_code: string; entity_name: string; action: string }) => {
    if (!localEco) return;
    let actualItemId = itemId;
    try {
      // 尚未创建执行项的，先创建再加入本地状态，确保后续 update 能找到
      let items = [...(localEco.execution_items || [])];
      if (!actualItemId && entityInfo) {
        const created = await ecoApi.addExecutionItem(localEco.id, { ...entityInfo, source: 'manual' });
        actualItemId = created.data?.id;
        if (actualItemId) items.push({ id: actualItemId, ...entityInfo, source: 'manual' as const, status: 'pending' as const, sort_order: 0 } as any);
      }
      let result: any;
      if (action === 'upgrade') result = await ecoApi.upgradeItem(localEco.id, actualItemId);
      else if (action === 'revert') result = await ecoApi.revertItem(localEco.id, actualItemId, newEntityId);
      else if (action === 'freeze') result = await ecoApi.freezeItem(localEco.id, actualItemId, newEntityId);
      toast.success('操作完成');
      const idx = items.findIndex((ei: any) => ei.id === actualItemId);
      if (idx >= 0) {
        const updated = { ...items[idx] };
        if (action === 'upgrade') {
          updated.new_entity_id = result.data?.new_entity_id;
          updated.new_version = result.data?.new_version;
          updated.new_entity_status = 'draft';
        } else if (action === 'revert') {
          updated.new_entity_id = undefined;
          updated.new_version = undefined;
          updated.new_entity_status = undefined;
        } else if (action === 'freeze') {
          updated.new_entity_status = 'frozen';
        }
        items[idx] = updated;
        setLocalEco({ ...localEco, execution_items: items });
      } else {
        // 执行项在子组件中即时创建（如向下子项"添加子项"后直接点冻结/还原），
        // 本地 execution_items 尚无该项，乐观更新无法命中；从后端拉取最新执行项，
        // 确保变更状态 Badge 与操作按钮（冻结↔还原）正确刷新。
        const fresh = await ecoApi.detail(localEco.id);
        setLocalEco(fresh.data);
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : '操作失败');
    }
  };

  const saveReleaseItems = (newItems: any[]) => {
    setReleaseItems(newItems);
    toast.success('工程变更结果已更新');
  };

  const handleReleaseVersionSelect = async (versionId: string) => {
    if (!releaseVersionState) return;
    const api = releaseVersionState.entityType === 'assembly' ? assembliesApi : partsApi;
    try {
      const r = await api.get(versionId);
      const updated = [...releaseItems];
      updated[releaseVersionState.itemIdx] = {
        ...updated[releaseVersionState.itemIdx],
        entity_id: r.data.id,
        entity_code: r.data.code,
        entity_name: r.data.name,
        entity_version: r.data.version,
        status: r.data.status,
      };
      saveReleaseItems(updated);
    } catch { toast.error('获取版本信息失败'); }
    setReleaseVersionState(null);
  };

  const addReviewer = () => {
    const nextSeq = reviewers.length > 0 ? Math.max(...reviewers.map((r) => r.seq)) + 1 : 1;
    setReviewers([...reviewers, { user_id: '', seq: nextSeq }]);
  };
  const removeReviewer = (index: number) => {
    setReviewers(reviewers.filter((_, i) => i !== index));
  };
  const updateReviewer = (index: number, field: 'user_id' | 'seq', value: string | number) => {
    const updated = [...reviewers];
    updated[index] = { ...updated[index], [field]: value };
    setReviewers(updated);
  };

  const handleSubmit = async () => {
    if (!validate()) { toast.error('请填写必填项（标题、变更原因）'); return; }
    setLoading(true);
    try {
      const data: Record<string, unknown> = {
        title: title.trim(),
        reason,
        priority,
        category,
        description: description || undefined,
        reviewers: reviewers.map((r) => ({ user_id: r.user_id, seq: r.seq })),
        review_mode: reviewMode,
        document_links: documentLinks,
      };
      // Build execution_items from bomData (composite key: entity_id|_affectedCode per group)
      const compKey = (it: any) => {
        const base = it.entity_id || it.entity_code || '';
        const aff = it.detail?._affectedCode || it._affectedCode || '';
        return base ? base + '|' + aff : '';
      };
      const oldMap = new Map<string, any>();
      (localEco?.execution_items || ecrItems || []).forEach((it: any) => {
        const ck = compKey(it);
        if (ck) oldMap.set(ck, it);
      });
      if (bomData && (bomData.up?.length || bomData.down?.length)) {
        // Source of truth: bomData nodes → one execution_item per node per group
        const allNodes = [...(bomData.up || []), ...(bomData.down || [])];
        const seen = new Set<string>();
        const items: any[] = [];
        allNodes.forEach((n: any) => {
          const ck = compKey(n);
          if (!ck || seen.has(ck)) return;
          seen.add(ck);
          const old = oldMap.get(ck);
          items.push({
            source: old?.source || 'ecr',
            entity_type: n.entity_type || 'part',
            entity_id: n.entity_id || undefined,
            entity_code: n.entity_code || undefined,
            entity_name: n.entity_name || '',
            action: n.action || 'no_change',
            parent_entity_id: old?.parent_entity_id || n.parent_entity_id || undefined,
            detail: { _targetQty: n._targetQty ?? n.quantity, _desc: n._desc || '', _affectedCode: n._affectedCode || '' },
          });
        });
        data.execution_items = items;
      } else {
        data.execution_items = (localEco?.execution_items || ecrItems || []).map((it: any) => ({
          source: it.source || 'ecr',
          entity_type: it.entity_type,
          entity_id: it.entity_id || undefined,
          entity_code: it.entity_code || undefined,
          entity_name: it.entity_name,
          action: it.action || 'upgrade',
          parent_entity_id: it.parent_entity_id || undefined,
          detail: { ...(it.detail || {}), _desc: it.change_description || it._desc || (it.detail || {})._desc || '' },
        }));
      }
      if (releaseItems.length > 0) {
        data.release_items = releaseItems.map((ri: any) => ({
          entity_type: ri.entity_type, entity_id: ri.entity_id,
          entity_code: ri.entity_code, entity_name: ri.entity_name, entity_version: ri.entity_version,
          spec: ri.spec || '', status: ri.status || 'draft',
        }));
      }
      if (ecrId) data.ecr_id = ecrId;
      if (localEco?.ecr_id) data.ecr_id = localEco.ecr_id;
      if (editingEco) {
        await ecoApi.update(editingEco.id, data);
        toast.success('ECO 更新成功');
      } else {
        await ecoApi.create(data);
        toast.success('ECO 创建成功');
      }
      setSubmitted(true);
    } catch { toast.error('创建失败，请重试'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} title={editingEco ? '编辑 ECO' : '新建 ECO'} onClose={onClose} width="3xl">
      <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
        {ecrTitle && (
          <div className="text-sm text-gray-500 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            来源 ECR: {ecrTitle}
          </div>
        )}

        {/* 基本字段 - 卡片式 */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
            <label className="block text-xs text-gray-500 mb-0.5">ECO 编号</label>
            <input type="text" value={localEco?.eco_number || ''} disabled
              className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-gray-100 text-gray-400" placeholder="新建时自动生成" />
          </div>
          <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
            <label className="block text-xs text-gray-500 mb-0.5">标题 <span className="text-red-500">*</span></label>
            <input type="text" value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={`w-full text-sm px-2 py-1 border rounded focus:outline-none focus:ring-2 focus:ring-primary-500 ${errors.title ? 'border-red-500' : 'border-gray-200'}`}
              placeholder="请输入 ECO 标题" />
            {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
            <label className="block text-xs text-gray-500 mb-0.5">变更原因 <span className="text-red-500">*</span></label>
            <select value={reason} onChange={(e) => setReason(e.target.value)}
              className={`w-full text-sm px-2 py-1 border rounded focus:outline-none focus:ring-2 focus:ring-primary-500 ${errors.reason ? 'border-red-400' : 'border-gray-200'}`}>
              {REASON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {errors.reason && <p className="text-red-500 text-xs mt-1">{errors.reason}</p>}
          </div>
          <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
            <label className="block text-xs text-gray-500 mb-0.5">变更类别</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500">
              {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="col-span-2 md:col-span-1 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
            <label className="block text-xs text-gray-500 mb-0.5">优先级</label>
            <div className="flex gap-2 pt-0.5 flex-wrap">
              {PRIORITY_OPTIONS.map((o) => (
                <label key={o.value} className="inline-flex items-center gap-0.5 cursor-pointer select-none text-xs">
                  <input type="radio" name="priority" value={o.value} checked={priority === o.value}
                    onChange={(e) => setPriority(e.target.value)} className="w-3 h-3 text-primary-600" />
                  <span className="text-gray-600">{o.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
            <label className="block text-xs text-gray-500 mb-0.5">审批模式</label>
            <select value={reviewMode} onChange={(e) => setReviewMode(e.target.value)}
              className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500">
              <option value="all">会签（全部通过）</option>
              <option value="any">或签（任一通过）</option>
            </select>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
          <label className="block text-xs text-gray-500 mb-0.5">变更描述</label>
          <textarea ref={descRef} value={description} onChange={(e) => setDescription(e.target.value)}
            onInput={(e) => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px'; }}
            rows={1} style={{ minHeight: '38px', resize: 'none' }}
            className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 overflow-hidden"
            placeholder="变更详细描述（选填）" />
        </div>

        {editingEco && <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">👤 审批人</label>
            <button type="button" onClick={addReviewer}
              className="text-xs px-3 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">
              + 添加审批人
            </button>
          </div>

          {reviewers.length === 0 && (
            <div className="text-center text-gray-400 py-3 text-sm border border-dashed border-gray-300 rounded-lg">
              暂无审批人，请点击上方按钮添加
            </div>
          )}

          <div className="space-y-2">
            {reviewers.map((reviewer, index) => (
              <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <span className="text-xs text-gray-400 w-6">{reviewer.seq}</span>
                <select value={reviewer.user_id}
                  onChange={(e) => updateReviewer(index, 'user_id', e.target.value)}
                  className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={usersLoading}>
                  <option value="">{usersLoading ? '加载中...' : '请选择审批人'}</option>
                  {users.filter((u) => u.id !== currentUserId && (u.role === 'admin' || u.role === 'engineer')).map((u) => (
                    <option key={u.id} value={u.id}>{u.real_name} ({u.username}) - {u.role}</option>
                  ))}
                </select>
                <input type="number" value={reviewer.seq}
                  onChange={(e) => updateReviewer(index, 'seq', parseInt(e.target.value) || 1)}
                  className="w-16 border border-gray-300 rounded px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  min={1} />
                <button type="button" onClick={() => removeReviewer(index)}
                  className="text-red-400 hover:text-red-600 text-sm px-2" title="移除">✕</button>
              </div>
            ))}
          </div>
        </div>}

        {ecrItems && ecrItems.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">执行项（从 ECR 带入）</label>
            <div className="border border-gray-200 rounded-lg divide-y max-h-40 overflow-auto">
              {ecrItems.map((it, i) => (
                <div key={i} className="px-3 py-2 text-sm flex justify-between items-center">
                  <span>{it.entity_name}</span>
                  <span className="text-gray-400 text-xs">{it.action}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {editingEco && <div>
        {/* 关联图文档 */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-gray-700">关联图文档</h4>
            <button type="button" onClick={() => setShowDocPicker(true)}
              className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">+ 关联图文档</button>
          </div>
          <div className="border rounded-lg overflow-hidden">
            {documentLinks.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-400">暂无关联图文档</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">图文档编号</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">图文档名称</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">版本</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">状态</th>
                    {docFieldDefs.map((def) => (
                      <th key={def.id} className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">{def.name}</th>
                    ))}
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">附件</th>
                    <th className="px-3 py-2 text-center text-gray-500 font-medium whitespace-nowrap w-28">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {documentLinks.map((link) => {
                    const doc = docData[link.document_id];
                    const atts = docAttachments[link.document_id] || [];
                    return (
                      <tr key={link.document_id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-sm font-medium">{doc?.code || link.document_code}</td>
                        <td className="px-3 py-2 text-sm">{doc?.name || link.document_name}</td>
                        <td className="px-3 py-2 text-sm text-gray-500">{doc?.version || link.document_version || '-'}</td>
                        <td className="px-3 py-2">{doc ? <span className={`px-1.5 py-0.5 rounded text-xs ${statusTag(doc.status).cls}`}>{statusTag(doc.status).label}</span> : '-'}</td>
                        {docFieldDefs.map((def) => {
                          const vals = docCustomValues[link.document_id] || {};
                          const val = vals[def.id];
                          return (
                            <td key={def.id} className="px-3 py-2 text-sm text-gray-500">
                              {val !== undefined && val !== null && val !== '' ? String(val) : '-'}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-sm text-gray-500">{doc?.file_name || atts.map((a: any) => a.file_name).join(', ') || '-'}</td>
                        <td className="px-3 py-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button type="button" onClick={() => setVersionSelectState({ docId: link.document_id, oldDocId: link.document_id })}
                              className="px-2 py-0.5 text-xs text-blue-600 hover:text-blue-800">选择</button>
                            <button type="button" onClick={() => setDocumentLinks((prev) => prev.filter((d) => d.document_id !== link.document_id))}
                              className="px-2 py-0.5 text-xs text-red-400 hover:text-red-600">移除</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
        </div>}

        {/* ECR 变更分析（仅编辑模式） */}
        {!!localEco && (
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-gray-700">ECR 变更分析{localEco.ecr_number ? `（${localEco.ecr_number}）` : ''}</h4>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setShowEcrPicker(true)}
                className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">
                {localEco.ecr_id ? '更换' : '+ 关联 ECR'}
              </button>
              {localEco.ecr_id && (
                <>
                  <button type="button" onClick={() => setResetKey(k => k + 1)}
                    className="px-3 py-1 text-sm border border-gray-300 rounded text-gray-600 hover:bg-gray-50">还原</button>
                  <button type="button" onClick={async () => {
                    try {
                      await ecoApi.update(localEco.id, { ecr_id: null } as any);
                      setLocalEco({ ...localEco, ecr_id: undefined, ecr_number: undefined });
                      toast.success('已解除 ECR 关联');
                    } catch { toast.error('操作失败'); }
                  }} className="px-3 py-1 text-sm border border-gray-300 rounded text-gray-500 hover:bg-gray-50">解除关联</button>
                </>
              )}
            </div>
          </div>
          {/* ECR BOM 影响分析 */}
          <ECOEditView ecrId={localEco.ecr_id} onEcrLinked={async (newEcrId) => {
            try {
              await ecoApi.update(localEco.id, { ecr_id: newEcrId } as any);
              setLocalEco({ ...localEco, ecr_id: newEcrId });
              toast.success('ECR 关联成功');
            } catch { toast.error('关联失败'); }
          }} onBomChange={setBomData} executionItems={localEco.execution_items}
          ecoId={localEco.id} ecoStatus={localEco.status}
          canExecute={localEco.status === 'draft'}
          onExecuteUpgrade={(itemId, entityInfo) => handleExecuteAction('upgrade', itemId, undefined, entityInfo)}
onExecuteRelease={(itemId, newEntityId) => handleExecuteAction('revert', itemId, newEntityId)}
onExecuteFreeze={(itemId, newEntityId) => handleExecuteAction('freeze', itemId, newEntityId)}
          onViewItem={(entityType, entityId) => viewItem(entityType, entityId, 'view')}
          onEditItem={(entityType, entityId) => viewItem(entityType, entityId, 'edit')}
          resetKey={resetKey} hideResetButton />
        </div>
        )}

        {/* 工程变更结果（仅编辑模式） */}
        {editingEco && (
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-gray-700">工程变更结果</h4>
            <button type="button" onClick={() => setShowReleasePicker(true)} className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">+ 关联零部件</button>
          </div>
          {releaseItems.length === 0 ? (
            <div className="border rounded-lg px-4 py-6 text-center text-sm text-gray-400">暂无工程变更结果</div>
          ) : (
            <ReleaseItemsTable items={releaseItems} onViewItem={viewItem} onRemove={(idx) => { const newItems = releaseItems.filter((_, i) => i !== idx); saveReleaseItems(newItems); }} onVersionSelect={(idx) => { const item = releaseItems[idx]; setReleaseVersionState({ itemIdx: idx, entityType: item.entity_type, entityId: item.entity_id, entityName: item.entity_name }); }} />
          )}
        </div>
        )}
      </div>

      {/* 按钮 */}
      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
        <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
          取消
        </button>
        <button onClick={handleSubmit} disabled={loading}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? '保存中...' : (localEco ? '保存' : '创建')}
        </button>
      </div>

      {/* 图文档选择器 — 独立弹窗 */}
      <ECRDocumentPicker
        open={showDocPicker}
        onClose={() => setShowDocPicker(false)}
        onSelect={(docs: ECRDocumentLink[]) => {
          setDocumentLinks(prev => {
            const existing = new Set(prev.map(d => d.document_id));
            const newDocs = docs.filter(d => !existing.has(d.document_id));
            return [...prev, ...newDocs];
          });
          setShowDocPicker(false);
        }}
        alreadyLinked={documentLinks.map(d => d.document_id)}
      />

      {/* ECR 选择弹窗 */}
      {showEcrPicker && (
      <div className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center" onClick={() => setShowEcrPicker(false)}>
        <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[70vh] overflow-auto p-4" onClick={e => e.stopPropagation()}>
          <h4 className="text-sm font-semibold mb-3">选择 ECR</h4>
          <EcrPicker onSelect={async (id, number) => {
            try {
              await ecoApi.update(localEco!.id, { ecr_id: id } as any);
              setLocalEco(prev => prev ? { ...prev, ecr_id: id, ecr_number: number } : prev);
              toast.success('ECR 关联成功');
            } catch { toast.error('关联失败'); }
            setShowEcrPicker(false);
          }} />
        </div>
      </div>
      )}

      {/* 版本选择器 */}
      <VersionSelectModal
        open={!!versionSelectState}
        entityType="document"
        entityId={versionSelectState?.docId || ''}
        entityName={docData[versionSelectState?.docId || '']?.code || ''}
        currentVersionId={versionSelectState?.oldDocId || ''}
        onSelect={(newVerId) => {
          if (versionSelectState) {
            setDocumentLinks(prev => prev.map(d =>
              d.document_id === versionSelectState.oldDocId
                ? { document_id: newVerId, document_code: '', document_name: '', document_version: '' }
                : d
            ));
          }
          setVersionSelectState(null);
        }}
        onClose={() => setVersionSelectState(null)}
      />

      {/* 零部件版本选择器（工程变更结果） */}
      <VersionSelectModal
        open={!!releaseVersionState}
        entityType={releaseVersionState?.entityType as 'part' | 'assembly' || 'part'}
        entityId={releaseVersionState?.entityId || ''}
        entityName={releaseVersionState?.entityName || ''}
        currentVersionId={releaseItems[releaseVersionState?.itemIdx ?? -1]?.entity_id}
        onSelect={handleReleaseVersionSelect}
        onClose={() => setReleaseVersionState(null)}
      />

      {/* 零部件选择器（工程变更结果） */}
      <AssemblyPartPicker open={showReleasePicker} onClose={() => setShowReleasePicker(false)}
        onConfirm={(items) => {
          setShowReleasePicker(false);
          Promise.allSettled(items.map(async (item) => { const api = item.child_type === 'assembly' ? assembliesApi : partsApi; const r = await api.get(item.child_id); return { ...r.data, child_type: item.child_type, quantity: item.quantity }; })).then(results => {
            const loaded = results.filter(r => r.status === 'fulfilled').map((r: any) => r.value);
            const existingIds = new Set(releaseItems.map((r: any) => r.entity_id));
            const merged = [...releaseItems, ...loaded.filter((r: any) => !existingIds.has(r.id)).map((r: any) => ({ entity_type: r.child_type === 'assembly' ? 'assembly' : 'part', entity_id: r.id, entity_code: r.code || '', entity_name: r.name || '', entity_version: r.version || '', spec: r.spec || '', status: r.status || '', quantity: r.quantity || 1 }))];
            saveReleaseItems(merged);
          });
        }} />

      {/* 嵌套详情弹窗 */}
      {nestedDetail && (
        <Modal open={true} title={nestedDetail.type === 'assembly' ? '部件详情' : '零件详情'} onClose={() => { setNestedDetail(null); setNestedData(null); }} width="full">
          {nestedLoading ? <div className="text-center py-8 text-sm text-gray-400">加载中...</div>
          : nestedData ? (
            nestedDetail.type === 'assembly' ? (
              <AssemblyDetailContent assembly={nestedData} customFieldDefs={nestedCustomFields.defs} customFieldValues={nestedCustomFields.values} />
            ) : (
              <PartDetailContent part={nestedData} customFieldDefs={nestedCustomFields.defs} customFieldValues={nestedCustomFields.values} />
            )
          ) : <div className="text-center py-8 text-sm text-gray-400">未找到数据</div>}
        </Modal>
      )}

      {/* 编辑弹窗 */}
      {editEntity && (
        <EntityEditModal
          open={!!editEntity}
          entityType={editEntity.type as 'part' | 'assembly'}
          entityId={editEntity.id}
          onClose={() => setEditEntity(null)}
          onSaved={() => { setEditEntity(null); if (localEco) ecoApi.detail(localEco.id).then(r => setLocalEco(r.data)); toast.success('保存成功'); }}
        />
      )}
    </Modal>
  );
}

function EcrPicker({ onSelect }: { onSelect: (id: string, number: string) => void }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded) {
      setSearching(true);
      ecrApi.list({ page_size: 100 }).then(r => setResults(r.data?.items || r.data || [])).catch(() => {}).finally(() => { setSearching(false); setLoaded(true); });
    }
  }, [loaded]);
  const handleSearch = async () => {
    if (!search.trim()) {
      setSearching(true);
      ecrApi.list({ page_size: 100 }).then(r => setResults(r.data?.items || r.data || [])).catch(() => {}).finally(() => setSearching(false));
      return;
    }
    setSearching(true);
    try {
      const r = await ecrApi.list({ search: search.trim(), page_size: 10 });
      setResults(r.data?.items || r.data || []);
    } catch {}
    finally { setSearching(false); }
  };
  const stl = (s: string) => {
    const map: Record<string, string> = { draft: '草稿', reviewing: '审核中', approved: '已批准', rejected: '已驳回', executing: '执行中', completed: '已完成', closed: '已关闭' };
    return map[s] || s;
  };
  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="搜索 ECR 编号或标题..." className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm" />
        <button onClick={handleSearch} disabled={searching}
          className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm disabled:opacity-50">搜索</button>
      </div>
      {searching ? <p className="text-xs text-gray-400 text-center py-4">加载中...</p> : (
        <table className="w-full text-sm border-collapse">
          <thead><tr className="bg-gray-50 border-b">
            <th className="px-3 py-2 text-left text-gray-500 font-medium text-xs">ECR 编号</th>
            <th className="px-3 py-2 text-left text-gray-500 font-medium text-xs">标题</th>
            <th className="px-3 py-2 text-left text-gray-500 font-medium text-xs w-20">状态</th>
          </tr></thead>
          <tbody className="divide-y">
            {results.map(e => (
              <tr key={e.id || e.ecr_number} className="hover:bg-blue-50 cursor-pointer" onClick={() => onSelect(e.id || e.ecr_number, e.ecr_number)}>
                <td className="px-3 py-2 font-mono text-xs text-blue-600">{e.ecr_number || '-'}</td>
                <td className="px-3 py-2 text-xs truncate max-w-0">{e.title || '无标题'}</td>
                <td className="px-3 py-2 text-xs">{stl(e.status)}</td>
              </tr>
            ))}
            {results.length === 0 && <tr><td colSpan={3} className="text-xs text-gray-400 text-center py-4">无数据</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ReleaseItemsTable({ items, onViewItem, onRemove, onVersionSelect }: { items: any[]; onViewItem: (type: string, id: string, mode?: 'view' | 'edit') => void; onRemove?: (idx: number) => void; onVersionSelect?: (idx: number) => void }) {
  const [expanded, setExpanded] = useState<Record<string, any[]>>({});
  const [loadingIdx, setLoadingIdx] = useState<string | null>(null);

  const toggleExpand = async (idx: string, entityId: string, entityType: string) => {
    if (expanded[idx]) { setExpanded(prev => { const n = {...prev}; delete n[idx]; return n; }); return; }
    if (entityType !== 'assembly') return;
    setLoadingIdx(idx);
    try {
      const r = await assemblyPartsApi.list(entityId);
      const children = (r.data || []).map((c: any) => ({ entity_type: c.childType === 'component' || c.childType === 'assembly' ? 'assembly' : 'part', entity_id: c.child_id, entity_code: c.child_detail?.code || '', entity_name: c.child_detail?.name || '', entity_version: c.child_detail?.version || '', spec: c.child_detail?.spec || '', status: c.child_detail?.status || '', quantity: c.quantity || 1 }));
      setExpanded(prev => ({ ...prev, [idx]: children }));
    } catch { toast.error('加载子项失败'); }
    finally { setLoadingIdx(null); }
  };

  const renderRow = (ri: any, level: number, idx: string): React.ReactNode => {
    const isAssembly = ri.entity_type === 'assembly';
    const childRows = expanded[idx];
    const rowNum = parseInt(idx.split('-')[0], 10);
    return (
      <>
        <tr key={idx} className="hover:bg-gray-50 cursor-pointer" onClick={() => onViewItem(isAssembly ? 'assembly' : 'part', ri.entity_id, 'view')}>
          <td className="px-3 py-1.5 text-xs text-gray-400 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
            <span>{'-'.repeat(level)}{level}</span>
            {isAssembly && <button onClick={(e) => { e.stopPropagation(); toggleExpand(idx, ri.entity_id, ri.entity_type); }} className="inline-flex items-center w-5 h-5 text-gray-400 hover:text-gray-600 ml-1">{childRows ? '▼' : '▶'}</button>}
          </td>
          <td className="px-3 py-1.5 text-xs"><span className={`px-1.5 py-0.5 rounded text-xs ${isAssembly ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{isAssembly ? '部件' : '零件'}</span></td>
          <td className="px-3 py-1.5 text-xs font-mono">{ri.entity_code}</td>
          <td className="px-3 py-1.5 text-xs">{ri.entity_name}</td>
          <td className="px-3 py-1.5 text-xs text-gray-500">{ri.spec || '-'}</td>
          <td className="px-3 py-1.5 text-xs">{ri.entity_version || 'A'}</td>
          <td className="px-3 py-1.5 text-xs whitespace-nowrap">{ri.status ? <span className={`px-1.5 py-0.5 rounded text-xs ${statusTag(ri.status).cls}`}>{statusTag(ri.status).label}</span> : '-'}</td>
          <td className="px-3 py-1.5 text-xs text-center">{ri.quantity || 1}</td>
          {(onRemove || onVersionSelect) && level === 0 && <td className="px-3 py-1.5 text-xs text-center" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1 justify-center">
              {onVersionSelect && <button onClick={() => onVersionSelect(rowNum)} className="px-2 py-0.5 text-xs text-blue-500 hover:text-blue-700 rounded whitespace-nowrap">选择</button>}
              {onRemove && <button onClick={() => onRemove(rowNum)} className="px-2 py-0.5 text-xs text-red-400 hover:text-red-600 whitespace-nowrap">移除</button>}
            </div>
          </td>}
          {(onRemove || onVersionSelect) && level > 0 && <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}></td>}
        </tr>
        {childRows && childRows.map((child: any, j: number) => renderRow(child, level + 1, `${idx}-${j}`))}
        {loadingIdx === idx && <tr><td colSpan={(onRemove || onVersionSelect) ? 9 : 8} className="px-3 py-1.5 text-xs text-gray-400 text-center">加载中...</td></tr>}
      </>
    );
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b"><tr>
          <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-20">层级</th>
          <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-16">类型</th>
          <th className="px-3 py-1.5 text-left text-xs text-gray-500">件号</th>
          <th className="px-3 py-1.5 text-left text-xs text-gray-500">中文名称</th>
          <th className="px-3 py-1.5 text-left text-xs text-gray-500">规格型号</th>
          <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-14">版本</th>
          <th className="px-3 py-1.5 text-left text-xs text-gray-500 w-20">状态</th>
          <th className="px-3 py-1.5 text-center text-xs text-gray-500 w-12">用量</th>
          {(onRemove || onVersionSelect) && <th className="px-3 py-1.5 text-center text-xs text-gray-500 w-28">操作</th>}
        </tr></thead>
        <tbody className="divide-y">{items.map((ri, i) => renderRow(ri, 0, String(i)))}</tbody>
      </table>
    </div>
  );
}

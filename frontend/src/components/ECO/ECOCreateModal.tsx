import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Modal, MODAL_Z } from '../Modal';
import { toast } from '../Toast';
import { ecoApi, usersApi, documentsApi, ecrApi, partsApi, customFieldsApi } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { useDataStore } from '../../stores/data';
import type { ECORequest, ECRDocumentLink } from '../../types';
import VersionSelectModal from '../VersionSelectModal';
import PartDetailModal from '../PartDetailModal';
import EntityEditModal from '../EntityEditModal';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import SortableTh from '../ui/SortableTh';
import Textarea from '../ui/Textarea';
import TreeToggle from '../ui/TreeToggle';
import { useTableSort } from '../../hooks/useTableSort';
import { compareVersions } from '../../constants';
import { ECOEditView } from './ECOEditView';
import DocumentPicker from '../DocumentPicker';
import AssemblyPartPicker from '../AssemblyPartPicker';
import Tabs from '../ui/Tabs';

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
  // Tab 分页（与详情页一致：基本信息/ECR变更分析/关联图文档/审批/工程变更结果）
  const [activeTab, setActiveTab] = useState<'info' | 'ecr' | 'docs' | 'reviewers' | 'items'>('info');
  const [showEcrPicker, setShowEcrPicker] = useState(false);
  const [showReleasePicker, setShowReleasePicker] = useState(false);
  const [releaseItems, setReleaseItems] = useState<any[]>([]);
  const [docData, setDocData] = useState<Record<string, any>>({});
  const [docAttachments, setDocAttachments] = useState<Record<string, any[]>>({});
  const [docCustomValues, setDocCustomValues] = useState<Record<string, Record<string, any>>>({});

  // 关联图文档表排序（值混合 link 顶层与 docData，包装扁平排序键）
  const sortableDocLinks = useMemo(() => documentLinks.map((link: any) => {
    const doc = docData[link.document_id];
    return {
      ...link,
      _code: doc?.code || link.document_code || '',
      _name: doc?.name || link.document_name || '',
      _version: doc?.version || link.document_version || '',
      _status: doc?.status || '',
    };
  }), [documentLinks, docData]);
  const { sortedData: sortedDocLinks, sortField: docSortField, sortDirection: docSortDirection, handleSort: handleDocSort } = useTableSort<any>(sortableDocLinks, { fieldComparators: { _version: (a, b) => compareVersions(String(a), String(b)) } });
  const [versionSelectState, setVersionSelectState] = useState<{ docId: string; oldDocId: string } | null>(null);
  const [releaseVersionState, setReleaseVersionState] = useState<{ itemIdx: number; entityType: string; entityId: string; entityName: string } | null>(null);
  const [viewPartMasterId, setViewPartMasterId] = useState<string | null>(null);
  const [viewPartRevisionId, setViewPartRevisionId] = useState<string | null>(null);
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
        // 刷新 release_items 状态（避免显示过期状态），并用 master.type 权威修正类型（历史数据可能错标）
        (async () => {
          const items = editingEco.release_items || [];
          if (items.length > 0) {
            const refreshed = await Promise.all(items.map(async (ri: any) => {
              try {
                const rev = await partsApi.getRevision(ri.entity_id);
                const master = await partsApi.get(rev.master_id);
                return { ...ri, status: rev.status, entity_version: rev.version, entity_code: master.code, entity_name: master.name, entity_type: master.type === 'assembly' ? 'assembly' : 'part' };
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
      setActiveTab('info');
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
  }, [open, description, activeTab]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = '请输入标题';
    if (!reason) e.reason = '请选择变更原因';
    return Object.keys(e).length === 0;
  };

  const viewItem = async (entityType: string, entityId: string, mode?: 'view' | 'edit') => {
    // 统一使用最新的 PartDetailModal，不再区分为内联 EntityEditModal
    try {
      const rev = await partsApi.getRevision(entityId);
      setViewPartMasterId(rev.master_id);
      setViewPartRevisionId(entityId);
    } catch {
      const releaseItem = (releaseItems || []).find((ri: any) =>
        ri.entity_id === entityId
      );
      const fallbackId = releaseItem?.entity_id || entityId;
      try {
        const rev = await partsApi.getRevision(fallbackId);
        setViewPartMasterId(rev.master_id);
        setViewPartRevisionId(fallbackId);
      } catch {
        setViewPartMasterId(fallbackId);
        setViewPartRevisionId(null);
      }
    }
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
          const newStatus = result.data?.new_entity_status;
          updated.new_entity_id = newStatus ? (result.data?.new_entity_id || updated.new_entity_id) : undefined;
          updated.new_version = newStatus ? (result.data?.new_version || updated.new_version) : undefined;
          updated.new_entity_status = newStatus || undefined;
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
    try {
      const rev = await partsApi.getRevision(versionId);
      const master = await partsApi.get(rev.master_id);
      const updated = [...releaseItems];
      updated[releaseVersionState.itemIdx] = {
        ...updated[releaseVersionState.itemIdx],
        entity_id: master.id,
        entity_code: master.code,
        entity_name: master.name,
        entity_version: rev.version,
        status: rev.status,
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
    <Modal open={open} title={editingEco ? '编辑 ECO' : '新建 ECO'} onClose={onClose} width="3xl" height="75vh"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? '保存中...' : (localEco ? '保存' : '创建')}
          </Button>
        </>
      }
    >
      <div className="h-full flex flex-col min-h-0">
        {/* 常驻摘要条：ECO 编号（只读）+ 标题（必填） */}
        <div className="grid grid-cols-2 gap-4 shrink-0 mb-3">
          <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
            <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">ECO 编号</label>
            <Input size="xs" type="text" value={localEco?.eco_number || ''} disabled
              placeholder="新建时自动生成" />
          </div>
          <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
            <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">标题 <span className="text-red-500">*</span></label>
            <Input size="xs" type="text" value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={errors.title ? '!border-red-500' : ''}
              placeholder="请输入 ECO 标题" />
            {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title}</p>}
          </div>
        </div>

        {/* Tab 栏（必填缺失红点提示） */}
        <div className="shrink-0 mb-3">
          <Tabs
            items={[
              { key: 'info', label: <span>基本信息{!title.trim() && <span className="ml-1 text-red-500">●</span>}</span> },
              { key: 'ecr', label: 'ECR变更分析' },
              { key: 'docs', label: '关联图文档' },
              { key: 'reviewers', label: <span>审批{reviewers.some(r => !r.user_id) && <span className="ml-1 text-red-500">●</span>}</span> },
              { key: 'items', label: '工程变更结果' },
            ]}
            activeKey={activeTab}
            onChange={(k) => setActiveTab(k as any)}
          />
        </div>

        {/* Tab 内容区 */}
        <div className="flex-1 min-h-0 overflow-auto pr-1 space-y-4">
          {activeTab === 'info' && (
            <>
        {ecrTitle && (
          <div className="text-sm text-[var(--ui-text-secondary)] bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            来源 ECR: {ecrTitle}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
            <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">变更原因 <span className="text-red-500">*</span></label>
            <Select size="xs" value={reason} onChange={(e) => setReason(e.target.value)}
              className={errors.reason ? '!border-red-400' : ''}>
              {REASON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            {errors.reason && <p className="text-red-500 text-xs mt-1">{errors.reason}</p>}
          </div>
          <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
            <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">变更类别</label>
            <Select size="xs" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
          <div className="col-span-2 md:col-span-1 bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
            <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">优先级</label>
            <div className="flex gap-2 pt-0.5 flex-wrap">
              {PRIORITY_OPTIONS.map((o) => (
                <label key={o.value} className="inline-flex items-center gap-0.5 cursor-pointer select-none text-xs">
                  <input type="radio" name="priority" value={o.value} checked={priority === o.value}
                    onChange={(e) => setPriority(e.target.value)} className="w-3 h-3 text-primary-600" />
                  <span className="text-[var(--ui-text-secondary)]">{o.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
            <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">审批模式</label>
            <Select size="xs" value={reviewMode} onChange={(e) => setReviewMode(e.target.value)}>
              <option value="all">会签（全部通过）</option>
              <option value="any">或签（任一通过）</option>
            </Select>
          </div>
        </div>

        <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
          <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">变更描述</label>
          <Textarea size="xs" ref={descRef} value={description} onChange={(e) => setDescription(e.target.value)}
            onInput={(e) => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px'; }}
            rows={1} style={{ minHeight: '38px', resize: 'none' }}
            className="overflow-hidden"
            placeholder="变更详细描述（选填）" />
        </div>
            </>
          )}
          {activeTab === 'reviewers' && (
            <>
        {editingEco && <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">👤 审批人</label>
            <Button size="xs" type="button" onClick={addReviewer}>
              + 添加审批人
            </Button>
          </div>

          {reviewers.length === 0 && (
            <div className="text-center text-[var(--ui-text-tertiary)] py-3 text-sm border border-dashed border-gray-300 rounded-lg">
              暂无审批人，请点击上方按钮添加
            </div>
          )}

          <div className="space-y-2">
            {reviewers.map((reviewer, index) => (
              <div key={index} className="flex items-center gap-3 p-3 bg-[var(--ui-bg-subtle)] rounded-lg border border-[var(--ui-border)]">
                <span className="text-xs text-[var(--ui-text-tertiary)] w-6">{reviewer.seq}</span>
                <Select value={reviewer.user_id}
                  onChange={(e) => updateReviewer(index, 'user_id', e.target.value)}
                  className="flex-1"
                  disabled={usersLoading}>
                  <option value="">{usersLoading ? '加载中...' : '请选择审批人'}</option>
                  {users.filter((u) => u.id !== currentUserId && (u.role === 'admin' || u.role === 'engineer')).map((u) => (
                    <option key={u.id} value={u.id}>{u.real_name} ({u.username}) - {u.role}</option>
                  ))}
                </Select>
                <Input size="xs" type="number" value={reviewer.seq}
                  onChange={(e) => updateReviewer(index, 'seq', parseInt(e.target.value) || 1)}
                  className="!w-16 text-center"
                  min={1} />
                <Button variant="danger" size="xs" type="button" onClick={() => removeReviewer(index)} title="移除">✕</Button>
              </div>
            ))}
          </div>
        </div>}
            </>
          )}
          {activeTab === 'info' && (
            <>
        {ecrItems && ecrItems.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">执行项（从 ECR 带入）</label>
            <div className="border border-[var(--ui-border)] rounded-lg divide-y max-h-40 overflow-auto">
              {ecrItems.map((it, i) => (
                <div key={i} className="px-3 py-2 text-sm flex justify-between items-center">
                  <span>{it.entity_name}</span>
                  <span className="text-[var(--ui-text-tertiary)] text-xs">{it.action}</span>
                </div>
              ))}
            </div>
          </div>
        )}
            </>
          )}
          {activeTab === 'docs' && (
            <>
        {editingEco && <div>
        {/* 关联图文档 */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[var(--ui-text-secondary)] font-semibold text-sm">关联图文档</h4>
            <Button size="sm" type="button" onClick={() => setShowDocPicker(true)}>+ 关联图文档</Button>
          </div>
          <div className="border rounded-lg overflow-hidden">
            {documentLinks.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-[var(--ui-text-tertiary)]">暂无关联图文档</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[var(--ui-bg-subtle)] border-b">
                  <tr>
                    <SortableTh sortKey="_code" active={docSortField === '_code'} direction={docSortDirection} onSort={(k) => handleDocSort(k)} className="text-left">图文档编号</SortableTh>
                    <SortableTh sortKey="_name" active={docSortField === '_name'} direction={docSortDirection} onSort={(k) => handleDocSort(k)} className="text-left">图文档名称</SortableTh>
                    <SortableTh sortKey="_version" active={docSortField === '_version'} direction={docSortDirection} onSort={(k) => handleDocSort(k)} className="text-left w-16">版本</SortableTh>
                    <SortableTh sortKey="_status" active={docSortField === '_status'} direction={docSortDirection} onSort={(k) => handleDocSort(k)} className="text-left w-16">状态</SortableTh>
                    {docFieldDefs.map((def) => (
                      <th key={def.id} className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium whitespace-nowrap">{def.name}</th>
                    ))}
                    <SortableTh className="text-left">附件</SortableTh>
                    <SortableTh className="text-center whitespace-nowrap w-28">操作</SortableTh>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sortedDocLinks.map((link) => {
                    const doc = docData[link.document_id];
                    const atts = docAttachments[link.document_id] || [];
                    return (
                      <tr key={link.document_id} className="hover:bg-[var(--ui-bg-hover)]">
                        <td className="px-3 py-2 text-sm font-medium">{doc?.code || link.document_code}</td>
                        <td className="px-3 py-2 text-sm">{doc?.name || link.document_name}</td>
                        <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{doc?.version || link.document_version || '-'}</td>
                        <td className="px-3 py-2">{doc ? <Badge status={doc.status} /> : '-'}</td>
                        {docFieldDefs.map((def) => {
                          const vals = docCustomValues[link.document_id] || {};
                          const val = vals[def.id];
                          return (
                            <td key={def.id} className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">
                              {val !== undefined && val !== null && val !== '' ? String(val) : '-'}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-sm text-[var(--ui-text-secondary)]">{doc?.file_name || atts.map((a: any) => a.file_name).join(', ') || '-'}</td>
                        <td className="px-3 py-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button variant="link" size="xs" type="button" onClick={() => setVersionSelectState({ docId: link.document_id, oldDocId: link.document_id })}>选择</Button>
                            <Button variant="danger" size="xs" type="button" onClick={() => setDocumentLinks((prev) => prev.filter((d) => d.document_id !== link.document_id))}>移除</Button>
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
            </>
          )}
          {activeTab === 'ecr' && (
            <>
        {/* ECR 变更分析（仅编辑模式） */}
        {!!localEco && (
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[var(--ui-text-secondary)] font-semibold text-sm">ECR 变更分析{localEco.ecr_number ? `（${localEco.ecr_number}）` : ''}</h4>
            <div className="flex items-center gap-2">
              <Button size="sm" type="button" onClick={() => setShowEcrPicker(true)}>
                {localEco.ecr_id ? '更换' : '+ 关联 ECR'}
              </Button>
              {localEco.ecr_id && (
                <>
                  <Button variant="secondary" size="sm" type="button" onClick={() => setResetKey(k => k + 1)}>还原</Button>
                  <Button variant="secondary" size="sm" type="button" onClick={async () => {
                    try {
                      await ecoApi.update(localEco.id, { ecr_id: null } as any);
                      setLocalEco({ ...localEco, ecr_id: undefined, ecr_number: undefined });
                      toast.success('已解除 ECR 关联');
                    } catch { toast.error('操作失败'); }
                  }}>解除关联</Button>
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
            </>
          )}
          {activeTab === 'items' && (
            <>
        {/* 工程变更结果（仅编辑模式） */}
        {editingEco && (
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[var(--ui-text-secondary)] font-semibold text-sm">工程变更结果</h4>
            <Button size="sm" type="button" onClick={() => setShowReleasePicker(true)}>+ 关联零部件</Button>
          </div>
          {releaseItems.length === 0 ? (
            <div className="border rounded-lg px-4 py-6 text-center text-sm text-[var(--ui-text-tertiary)]">暂无工程变更结果</div>
          ) : (
            <ReleaseItemsTable items={releaseItems} onViewItem={viewItem}
              onRemove={(item) => { saveReleaseItems(releaseItems.filter((r) => r !== item)); }}
              onVersionSelect={(item) => { const idx = releaseItems.indexOf(item); setReleaseVersionState({ itemIdx: idx, entityType: item.entity_type, entityId: item.entity_id, entityName: item.entity_name }); }} />
          )}
        </div>
        )}
            </>
          )}
        </div>
      </div>

      {/* 图文档选择器 — 独立弹窗（共享 DocumentPicker） */}
      <DocumentPicker
        open={showDocPicker}
        onClose={() => setShowDocPicker(false)}
        onConfirm={(items) => {
          setDocumentLinks(prev => {
            const existing = new Set(prev.map(d => d.document_id));
            const newDocs = items
              .filter(v => !existing.has(v.document_id))
              .map(v => ({ document_id: v.document_id, document_code: '', document_name: '', document_version: '' }));
            return [...prev, ...newDocs];
          });
        }}
        existingDocIds={new Set(documentLinks.map(d => d.document_id))}
      />

      {/* ECR 选择弹窗（共享 Modal，zIndex 走 MODAL_Z.picker；height 限定防 ECR 长列表超高） */}
      <Modal open={showEcrPicker} title="选择 ECR" onClose={() => setShowEcrPicker(false)} width="lg" height="70vh" zIndex={MODAL_Z.picker}>
        <EcrPicker onSelect={async (id, number) => {
          try {
            await ecoApi.update(localEco!.id, { ecr_id: id } as any);
            setLocalEco(prev => prev ? { ...prev, ecr_id: id, ecr_number: number } : prev);
            toast.success('ECR 关联成功');
          } catch { toast.error('关联失败'); }
          setShowEcrPicker(false);
        }} />
      </Modal>

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
          Promise.allSettled(items.map(async (item) => { const rev = await partsApi.getRevision(item.child_id); const m = await partsApi.get(rev.master_id); return { ...m, ...rev, child_type: item.child_type, quantity: item.quantity }; })).then(results => {
            const loaded = results.filter(r => r.status === 'fulfilled').map((r: any) => r.value);
            const existingIds = new Set(releaseItems.map((r: any) => r.entity_id));
            const merged = [...releaseItems, ...loaded.filter((r: any) => !existingIds.has(r.master_id || r.id)).map((r: any) => ({ entity_type: r.type === 'assembly' ? 'assembly' : 'part', entity_id: r.master_id || r.id, entity_code: r.code || '', entity_name: r.name || '', entity_version: r.version || '', spec: r.spec || '', status: r.status || '', quantity: r.quantity || 1 }))];
            saveReleaseItems(merged);
          });
        }} />

      {/* 零件/部件详情弹窗 */}
      {viewPartMasterId && (
        <PartDetailModal
          masterId={viewPartMasterId}
          revisionId={viewPartRevisionId || undefined}
          open={!!viewPartMasterId}
          onClose={() => { setViewPartMasterId(null); setViewPartRevisionId(null); }}
        />
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
  const { sortedData: sortedResults, sortField, sortDirection, handleSort } = useTableSort<any>(results);
  return (
    <div>
      <div className="flex gap-2 mb-3">
        <Input value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="搜索 ECR 编号或标题..." className="flex-1" />
        <Button size="sm" onClick={handleSearch} disabled={searching}>搜索</Button>
      </div>
      {searching ? <p className="text-xs text-[var(--ui-text-tertiary)] text-center py-4">加载中...</p> : (
        <table className="w-full text-sm border-collapse">
          <thead><tr className="bg-[var(--ui-bg-subtle)] border-b">
            <SortableTh sortKey="ecr_number" active={sortField === 'ecr_number'} direction={sortDirection} onSort={(k) => handleSort(k)} className="text-left font-medium text-xs">ECR 编号</SortableTh>
            <SortableTh sortKey="title" active={sortField === 'title'} direction={sortDirection} onSort={(k) => handleSort(k)} className="text-left font-medium text-xs">标题</SortableTh>
            <SortableTh sortKey="status" active={sortField === 'status'} direction={sortDirection} onSort={(k) => handleSort(k)} className="text-left font-medium text-xs w-20">状态</SortableTh>
          </tr></thead>
          <tbody className="divide-y">
            {sortedResults.map(e => (
              <tr key={e.id || e.ecr_number} className="hover:bg-blue-50 cursor-pointer" onClick={() => onSelect(e.id || e.ecr_number, e.ecr_number)}>
                <td className="px-3 py-2 font-mono text-xs text-blue-600">{e.ecr_number || '-'}</td>
                <td className="px-3 py-2 text-xs truncate max-w-0">{e.title || '无标题'}</td>
                <td className="px-3 py-2 text-xs">{stl(e.status)}</td>
              </tr>
            ))}
            {results.length === 0 && <tr><td colSpan={3} className="text-xs text-[var(--ui-text-tertiary)] text-center py-4">无数据</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

// 部件类型判定：'component' 为历史遗留值，语义等同 'assembly'（部件）
const isAssemblyType = (t: string) => t === 'assembly' || t === 'component';

function ReleaseItemsTable({ items, onViewItem, onRemove, onVersionSelect }: { items: any[]; onViewItem: (type: string, id: string, mode?: 'view' | 'edit') => void; onRemove?: (item: any) => void; onVersionSelect?: (item: any) => void }) {
  const [expanded, setExpanded] = useState<Record<string, any[]>>({});
  const [loadingIdx, setLoadingIdx] = useState<string | null>(null);
  // 表头点击排序（件号/名称/版本/状态/用量）：顶层与各层子项统一排序（渲染时派生，切换排序即时生效于整棵树）
  const { sortField, sortDirection, handleSort } = useTableSort<any>(items, { fieldComparators: { version: (a, b) => compareVersions(String(a), String(b)) } });
  // 排序 key → release item 实际字段映射
  const fieldOf = (ri: any, f: string) => f === 'code' ? ri.entity_code : f === 'name' ? ri.entity_name : f === 'version' ? ri.entity_version : f === 'status' ? ri.status : ri.quantity;
  const sortRows = useCallback((list: any[]) => {
    if (!sortField || !sortDirection) return list;
    return [...list].sort((a: any, b: any) => {
      const aVal = fieldOf(a, String(sortField));
      const bVal = fieldOf(b, String(sortField));
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      let cmp: number;
      if (sortField === 'version') cmp = compareVersions(String(aVal), String(bVal));
      else if (typeof aVal === 'number' && typeof bVal === 'number') cmp = aVal - bVal;
      else cmp = String(aVal).localeCompare(String(bVal), 'zh-CN');
      return sortDirection === 'desc' ? -cmp : cmp;
    });
  }, [sortField, sortDirection]);
  const sortedItems = sortRows(items);
  // 展开状态用稳定标识（entity_id/code），排序后展开不错位
  const keyOf = (ri: any, fallback: string) => ri.entity_id || ri.entity_code || fallback;

  const toggleExpand = async (key: string, entityId: string, entityType: string) => {
    if (expanded[key]) { setExpanded(prev => { const n = {...prev}; delete n[key]; return n; }); return; }
    if (!isAssemblyType(entityType)) return;
    setLoadingIdx(key);
    try {
      const master = await partsApi.get(entityId);
      const revId = master.latest_revision?.id;
      if (!revId) { toast.error('无法获取最新版本'); return; }
      const rows = await partsApi.getBOM(revId);
      const children = rows.map((c: any) => ({ entity_type: isAssemblyType(c.child_type) ? 'assembly' : 'part', entity_id: c.child_master_id, entity_code: c.child_code || '', entity_name: c.child_name || '', entity_version: c.child_version || '', spec: c.child_spec || '', status: c.child_status || '', quantity: c.quantity || 1 }));
      setExpanded(prev => ({ ...prev, [key]: children }));
    } catch { toast.error('加载子项失败'); }
    finally { setLoadingIdx(null); }
  };

  const renderRow = (ri: any, level: number, key: string): React.ReactNode => {
    const isAssembly = isAssemblyType(ri.entity_type);
    const childRows = expanded[key];
    return (
      <>
        <tr key={key} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer" onClick={() => onViewItem(isAssembly ? 'assembly' : 'part', ri.entity_id, 'view')}>
          <td className="relative px-3 py-2 font-medium whitespace-nowrap" style={{ paddingLeft: `calc(8px + ${level} * var(--ui-tree-indent))` }} onClick={(e) => e.stopPropagation()}>
            {level > 0 && Array.from({ length: level }, (_, k) => (
              <span key={k} className="absolute -top-px bottom-0 w-px bg-[var(--ui-border)] pointer-events-none" style={{ left: `calc(16px + ${k} * var(--ui-tree-indent))` }} />
            ))}
            <span className="inline-flex items-center gap-1">
              {isAssembly ? (
                <TreeToggle expanded={!!childRows} onClick={() => toggleExpand(key, ri.entity_id, ri.entity_type)} size="sm" title={childRows ? '折叠' : '展开'} />
              ) : (
                <TreeToggle leaf size="sm" />
              )}
              <span className="text-sm">{ri.entity_code}</span>
            </span>
          </td>
          <td className="px-3 py-2">{ri.entity_name}</td>
          <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{ri.entity_version || 'A'}</td>
          <td className="px-3 py-2 whitespace-nowrap">{ri.status ? <Badge status={ri.status} /> : '-'}</td>
          <td className="px-3 py-2 text-center">{ri.quantity || 1}</td>
          {(onRemove || onVersionSelect) && level === 0 && <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1 justify-center">
              {onVersionSelect && <Button variant="link" size="xs" onClick={() => onVersionSelect(ri)} className="whitespace-nowrap">选择</Button>}
              {onRemove && <Button variant="danger" size="xs" onClick={() => onRemove(ri)} className="whitespace-nowrap">移除</Button>}
            </div>
          </td>}
          {(onRemove || onVersionSelect) && level > 0 && <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}></td>}
        </tr>
        {childRows && sortRows(childRows).map((child: any, j: number) => renderRow(child, level + 1, keyOf(child, `${key}-${j}`)))}
        {loadingIdx === key && <tr><td colSpan={(onRemove || onVersionSelect) ? 6 : 5} className="px-3 py-2 text-sm text-[var(--ui-text-tertiary)] text-center">加载中...</td></tr>}
      </>
    );
  };

  return (
    <div className="border border-[var(--ui-border)] rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[var(--ui-bg-subtle)] border-b"><tr className="sticky top-0 z-10">
          <SortableTh sortKey="code" active={sortField === 'code'} direction={sortDirection} onSort={(k) => handleSort(k)} className="!px-3 !py-2">件号</SortableTh>
          <SortableTh sortKey="name" active={sortField === 'name'} direction={sortDirection} onSort={(k) => handleSort(k)} className="!px-3 !py-2">中文名称</SortableTh>
          <SortableTh sortKey="version" active={sortField === 'version'} direction={sortDirection} onSort={(k) => handleSort(k)} className="!px-3 !py-2 w-14">版本</SortableTh>
          <SortableTh sortKey="status" active={sortField === 'status'} direction={sortDirection} onSort={(k) => handleSort(k)} className="!px-3 !py-2 w-20">状态</SortableTh>
          <SortableTh sortKey="quantity" active={sortField === 'quantity'} direction={sortDirection} onSort={(k) => handleSort(k)} align="center" className="!px-3 !py-2 w-12">用量</SortableTh>
          {(onRemove || onVersionSelect) && <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-28 select-none whitespace-nowrap">操作</th>}
        </tr></thead>
        <tbody className="divide-y">{sortedItems.map((ri, i) => renderRow(ri, 0, keyOf(ri, String(i))))}</tbody>
      </table>
    </div>
  );
}

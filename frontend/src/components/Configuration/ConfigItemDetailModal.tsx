import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { configurationApi, customFieldsApi, partsApi, mediaApi } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { useDataStore } from '../../stores/data';
import type { ConfigurationItemDetail, ConfigurationItemRevision } from '../../types';
import { Loading } from '../Loading';
import { toast } from '../Toast';
import { Modal, ConfirmModal } from '../Modal';
import EntityDocumentSection from '../EntityDocumentSection';
import CustomFieldInput from '../CustomFieldInput';
import ConfigItemPicker from './ConfigItemPicker';
import PartDetailModal from '../PartDetailModal';
import AssemblyPartPicker from '../AssemblyPartPicker';
import VersionSelectModal from '../VersionSelectModal';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import CheckinNoteModal from '../CheckinNoteModal';

function BomChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`w-3.5 h-3.5 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
      fill="none"
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface Props {
  revisionId: string;
  open: boolean;
  onClose: (savedPatch?: Record<string, string>) => void;
}

function InfoCard({ label, value, readonly, onChange }: {
  label: string; value: string; readonly: boolean; onChange?: (v: string) => void;
}) {
  return (
    <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
      <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">{label}</div>
      {readonly ? (
        <div className="text-sm text-[var(--ui-text-primary)] font-medium">{value || '—'}</div>
      ) : (
        <Input value={value} onChange={(e) => onChange?.(e.target.value)}
          size="xs"
          className="font-mono" />
      )}
    </div>
  );
}

export default function ConfigItemDetailModal({ revisionId, open, onClose }: Props) {
  const { user } = useAuthStore();
  const isAdminUser = user?.role === 'admin';

  const [internalRevId, setInternalRevId] = useState(revisionId);
  const [detail, setDetail] = useState<ConfigurationItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const tabsKeys = ['info', 'children', 'parts', 'docs', 'versions', 'iterations'] as const;
  const [activeTab, setActiveTab] = useState<typeof tabsKeys[number]>('info');
  const [checkinNote, setCheckinNote] = useState('');
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [editCode, setEditCode] = useState('');
  const [editName, setEditName] = useState('');
  const [parts, setParts] = useState<any[]>([]);
  const [children, setChildren] = useState<any[]>([]);
  const [versions, setVersions] = useState<ConfigurationItemRevision[]>([]);
  const [iterations, setIterations] = useState<any[]>([]);
  const [cfDefs, setCfDefs] = useState<any[]>([]);
  const [cfValues, setCfValues] = useState<Record<string, any>>({});
  const [selectedPartMasterId, setSelectedPartMasterId] = useState<string | null>(null);
  const [nestedConfigRevId, setNestedConfigRevId] = useState<string | null>(null);
  const [cfgPickerOpen, setCfgPickerOpen] = useState(false);
  const [pickerParentId, setPickerParentId] = useState<string | null>(null);
  const [viewingIterationData, setViewingIterationData] = useState<any>(null);
  const [activeIterationId, setActiveIterationId] = useState<string | null>(null);
  const [expandedChildren, setExpandedChildren] = useState<Set<string>>(new Set());
  const [subChildren, setSubChildren] = useState<Record<string, any[]>>({});
  const childrenScrollRef = useRef<HTMLDivElement>(null);
  const masterTimer = useRef<ReturnType<typeof setTimeout>>();
  const savedPatchRef = useRef<Record<string, string>>({});
  const cfTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [partPickerOpen, setPartPickerOpen] = useState(false);
  const [versionSelectIdx, setVersionSelectIdx] = useState<number | null>(null);

  const loadDetail = useCallback(async () => {
    if (!internalRevId) return;
    setDetailLoading(true);
    try {
      const params = activeIterationId ? { iteration_id: activeIterationId } : undefined;
      const d = await configurationApi.detail(internalRevId, params);
      setDetail(d);
      setEditCode(d.master.code || '');
      setEditName(d.revision.name || d.master.name || '');
      setParts(d.parts || []);
      setChildren(d.children || []);
      setVersions(d.versions || []);
      const allDefs = useDataStore.getState().customFieldDefs || [];
      setCfDefs(allDefs.filter((def: any) => def.applies_to?.includes('configuration_item')));
      try {
        const cfRes = await customFieldsApi.getValues('configuration_item', internalRevId);
        const vals: Record<string, any> = {};
        (cfRes.data || []).forEach((v: any) => { vals[v.field_id] = v.value; });
        setCfValues(vals);
      } catch {}
    } catch (e) {
      console.error(e); setDetail(null);
    } finally { setDetailLoading(false); }
  }, [internalRevId, activeIterationId]);

  useEffect(() => { setInternalRevId(revisionId); }, [revisionId]);
  useEffect(() => { if (open) { setDetail(null); setActiveTab('info'); setViewingIterationData(null); setActiveIterationId(null); setExpandedChildren(new Set()); setSubChildren({}); } }, [open]);
  useEffect(() => { if (open) loadDetail(); }, [open, loadDetail]);

  const loadTabs = useCallback(async () => {
    if (!internalRevId) return;
    try {
      const params = activeIterationId ? { iteration_id: activeIterationId } : undefined;
      if (activeTab === 'parts' || activeTab === 'children') { const d = await configurationApi.detail(internalRevId, params); setParts(d.parts || []); setChildren(d.children || []); }
      if (activeTab === 'versions') setVersions(await configurationApi.versions(internalRevId));
      if (activeTab === 'iterations') setIterations(await configurationApi.iterations(internalRevId));
    } catch (e) { console.error(e); }
  }, [internalRevId, activeTab, activeIterationId]);
  useEffect(() => { loadTabs(); }, [loadTabs]);

  const master = detail?.master;
  const revision = detail?.revision;
  const iterationId = revision?.iteration_id;
  const isCheckedOut = !!revision?.check_out_user_id;
  const isCheckedOutByMe = isCheckedOut && revision?.check_out_user_id === user?.id;
  const isDraft = revision?.status === 'draft';
  const canEdit = isCheckedOutByMe && isDraft;
  const canCheckout = isDraft && !isCheckedOut;
  const canCheckin = isDraft && isCheckedOutByMe;
  const canUndo = isDraft && isCheckedOutByMe && (revision?.latest_iteration || 0) > 1;
  const canFreeze = revision?.status === 'draft' && !isCheckedOut;
  const canUnfreeze = revision?.status === 'frozen' && isAdminUser;
  const canRelease = (revision?.status === 'draft' || revision?.status === 'frozen') && !isCheckedOut;
  const canUpgrade = revision?.status === 'released' || revision?.status === 'obsolete';
  const canObsolete = revision?.status === 'released';
  const canForceCheckin = isCheckedOut && isAdminUser;

  const autoSaveMaster = useCallback((data: Record<string, any>) => {
    if (!internalRevId) return;
    if (masterTimer.current) clearTimeout(masterTimer.current);
    masterTimer.current = setTimeout(() => { configurationApi.updateMaster(internalRevId, data).then(() => {
      Object.assign(savedPatchRef.current, data);
    }).catch(() => {}); }, 500);
  }, [internalRevId]);

  const autoSaveCf = useCallback((fieldId: string, value: any) => {
    if (!internalRevId) return;
    if (cfTimerRef.current) clearTimeout(cfTimerRef.current);
    cfTimerRef.current = setTimeout(() => {
      const fieldValues = cfDefs.map((def: any) => ({ field_id: def.id, value: fieldId === def.id ? value : cfValues[def.id] ?? null }));
      customFieldsApi.setValues('configuration_item', internalRevId, fieldValues).catch(() => {});
    }, 500);
  }, [internalRevId, cfDefs, cfValues]);

  const doAction = async (action: () => Promise<any>, msg: string) => {
    try { await action(); toast.success(msg); setActiveIterationId(null); setViewingIterationData(null); loadDetail(); } catch (e: any) { toast.error(e?.response?.data?.detail || '操作失败'); }
  };

  const handleClose = () => { 
    setActiveTab('info'); 
    setViewingIterationData(null); 
    setActiveIterationId(null); 
    const hasChanges = Object.keys(savedPatchRef.current).length > 0;
    onClose(hasChanges ? { ...savedPatchRef.current } : undefined);
    savedPatchRef.current = {};
  };

  const handleViewIteration = async (it: any) => {
    const target = iterations.find((i: any) => i.id === it.id);
    if (!target) return;
    setViewingIterationData(target);
    setActiveIterationId(target.id);
    setActiveTab('info');
    // 直接按目标迭代重新加载子构型项和零部件数据
    try {
      const d = await configurationApi.detail(internalRevId, { iteration_id: target.id });
      setChildren(d.children || []);
      setParts(d.parts || []);
    } catch {}
  };

  // 删除迭代确认（状态驱动 ConfirmModal）
  const [confirmDelIter, setConfirmDelIter] = useState<any | null>(null);
  const handleDeleteIteration = (it: any) => { if (!internalRevId) return; setConfirmDelIter(it); };
  // 移除子构型项确认
  const [confirmRemoveChild, setConfirmRemoveChild] = useState<{ parentRevId: string; childId: string } | null>(null);
  // 移除关联零部件确认
  const [confirmRemovePart, setConfirmRemovePart] = useState<any | null>(null);

  const loadSubChildren = async (revId: string) => {
    if (subChildren[revId]) return;
    try { const d = await configurationApi.detail(revId); setSubChildren(prev => ({ ...prev, [revId]: d.children || [] })); } catch {}
  };

  const refreshChildren = useCallback(async (parentRevId: string) => {
    const scrollTop = childrenScrollRef.current?.scrollTop;
    try {
      const params = activeIterationId ? { iteration_id: activeIterationId } : undefined;
      if (parentRevId === internalRevId) {
        const d = await configurationApi.detail(internalRevId, params);
        setChildren(d.children || []);
      } else {
        const d = await configurationApi.detail(parentRevId);
        setSubChildren(prev => ({ ...prev, [parentRevId]: d.children || [] }));
      }
    } catch (e) { console.error(e); }
    requestAnimationFrame(() => {
      if (childrenScrollRef.current && scrollTop !== undefined) {
        childrenScrollRef.current.scrollTop = scrollTop;
      }
    });
  }, [internalRevId, activeIterationId]);

  const handlePart3DPreview = useCallback(async (p: any) => {
    const pd = p.part_detail || {};
    const revId = pd.revision_id || p.part_id;
    if (!revId) return;
    if (p.part_type === 'assembly') {
      window.open(`/stp-viewer?assembly=${revId}&code=${encodeURIComponent(pd.code || '')}&name=${encodeURIComponent(pd.name || '')}`, '_blank');
      return;
    }
    try {
      const atts = await partsApi.listAttachments(revId, 'production');
      const stp = (Array.isArray(atts) ? atts : []).find((a: any) => {
        const n = (a.file_name || '').toLowerCase();
        return n.endsWith('.stp') || n.endsWith('.step');
      });
      if (stp) {
        const mt = await mediaApi.token(stp.id, 'gltf');
        window.open(`/stp-viewer?id=${stp.id}&token=${encodeURIComponent(mt)}&code=${encodeURIComponent(pd.code || '')}&version=${encodeURIComponent(pd.version || '')}&name=${encodeURIComponent(pd.name || '')}`, '_blank');
      } else {
        toast.info('该零件没有 STP/STEP 附件');
      }
    } catch { toast.error('打开预览失败'); }
  }, []);

  const renderChildRow = (c: any, level: number, parentRevisionId: string): React.ReactNode => {
    const revId = c.child_detail?.id || c.child_revision_id;
    const isExpanded = expandedChildren.has(revId);
    const nested = subChildren[revId] || [];
    const rows: React.ReactNode[] = [];
    rows.push(
      <tr key={c.id} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer" onClick={() => { if (revId) setNestedConfigRevId(revId); }}>
        <td
          className="relative px-3 py-2 font-medium whitespace-nowrap"
          style={{ paddingLeft: `calc(8px + (${level} - 1) * var(--ui-tree-indent))` }}
          onClick={(e) => e.stopPropagation()}
        >
          {level > 1 && Array.from({ length: level - 1 }, (_, k) => (
            <span
              key={k}
              className="absolute -top-px bottom-0 w-px bg-gray-200 pointer-events-none"
              style={{ left: `calc(16px + ${k} * var(--ui-tree-indent))` }}
            />
          ))}
          <span className="inline-flex items-center gap-1">
            {c.has_children ? (
              <button onClick={(e) => { e.stopPropagation();
                if (isExpanded) {
                  setExpandedChildren(prev => { const s = new Set(prev); s.delete(revId); return s; });
                } else {
                  setExpandedChildren(prev => new Set(prev).add(revId));
                  loadSubChildren(revId);
                }
              }}
                className="w-4 h-4 inline-flex items-center justify-center shrink-0 rounded text-[var(--ui-text-tertiary)] hover:text-[var(--ui-text-secondary)] hover:bg-gray-200/60"
                title={isExpanded ? '折叠' : '展开'}>
                <BomChevron expanded={isExpanded} />
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <span className="text-sm">{c.child_detail?.code || '—'}</span>
          </span>
        </td>
        <td className="px-3 py-2">{c.child_detail?.name || '—'}</td>
        <td className="px-3 py-2 text-center text-[var(--ui-text-secondary)] text-xs">{c.child_detail?.version || '—'}</td>
        <td className="px-3 py-2 text-center"><Badge status={c.child_detail?.status || 'draft'} /></td>
        <td className="px-3 py-2 text-center">{c.child_detail?.check_out_user_name ? (<span className="text-xs text-orange-600">{c.child_detail.check_out_user_name}</span>) : (<span className="text-xs text-[var(--ui-text-tertiary)]">—</span>)}</td>
        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
          {canEdit ? (
            <button onClick={async () => { try { await configurationApi.updateChild(parentRevisionId, c.id, { is_required: !c.is_required }); if (parentRevisionId === internalRevId) { setChildren(prev => prev.map(x => x.id === c.id ? { ...x, is_required: !x.is_required } : x)); } else { setSubChildren(prev => { const s = { ...prev }; s[parentRevisionId] = (s[parentRevisionId] || []).map((x: any) => x.id === c.id ? { ...x, is_required: !x.is_required } : x); return s; }); } } catch {} }} className={`text-xs px-2 py-0.5 rounded ${c.is_required ? 'bg-[var(--ui-blue-bg)] text-[var(--ui-blue-text)] hover:opacity-80' : 'bg-[var(--ui-gray-bg)] text-[var(--ui-gray-text)] hover:opacity-80'}`}>{c.is_required ? '必选' : '可选'}</button>
          ) : (<span className={`text-xs ${c.is_required ? 'text-[var(--ui-blue-text)]' : 'text-[var(--ui-gray-text)]'}`}>{c.is_required ? '必选' : '可选'}</span>)}
        </td>
        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
          {canEdit ? (<Input type="number" min={1} defaultValue={c.quantity || 1} size="xs" className="!w-14 text-center" onBlur={async (e) => { const val = parseInt(e.target.value) || 1; if (val === c.quantity) return; try { await configurationApi.updateChild(parentRevisionId, c.id, { quantity: val }); if (parentRevisionId === internalRevId) { setChildren(prev => prev.map(x => x.id === c.id ? { ...x, quantity: val } : x)); } else { setSubChildren(prev => { const s = { ...prev }; s[parentRevisionId] = (s[parentRevisionId] || []).map((x: any) => x.id === c.id ? { ...x, quantity: val } : x); return s; }); } } catch {} }} />) : (c.quantity || 1)}
        </td>
        {canEdit && (
          <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <Button variant="link" size="xs" onClick={() => { setPickerParentId(revId); setCfgPickerOpen(true); }}>+子项</Button>
              <Button variant="danger" size="xs" onClick={() => setConfirmRemoveChild({ parentRevId: parentRevisionId, childId: c.id })}>移除</Button>
            </div>
          </td>
        )}
      </tr>
    );
    if (isExpanded && nested.length > 0) nested.forEach(nc => rows.push(renderChildRow(nc, level + 1, revId)));
    return <>{rows}</>;
  };

  const tabs = useMemo(() => [
    { key: 'info' as const, label: '基本信息' },
    { key: 'children' as const, label: '子构型项' },
    { key: 'parts' as const, label: '关联零部件' },
    { key: 'docs' as const, label: '关联图文档' },
    { key: 'versions' as const, label: '版本历史' },
    { key: 'iterations' as const, label: '迭代历史' },
  ], []);

  if (!open) return null;

  const rows = [];
  for (const c of children) rows.push(renderChildRow(c, 1, internalRevId));

  return (
    <Modal open={open} title="构型项详情" onClose={handleClose} width="3xl" height="75vh"
      headerAction={viewingIterationData ? (
        <span className="flex items-center gap-2 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded">
          正在查看 Iteration #{viewingIterationData.iteration} 的历史数据（只读）
          <Button variant="link" size="xs" onClick={() => { setViewingIterationData(null); setActiveIterationId(null); }}>返回当前迭代</Button>
        </span>
      ) : (internalRevId && internalRevId !== revisionId) ? (
        <span className="flex items-center gap-2 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded">
          正在查看版本 {versions.find((v: any) => v.id === internalRevId)?.version || '?'}（只读）
          <Button variant="link" size="xs" onClick={() => setInternalRevId(revisionId)}>返回当前版本</Button>
        </span>
      ) : undefined}
    >
      <div className="h-full flex flex-col min-h-0">
        {detailLoading && !master ? (<Loading />) : !master ? (<div className="text-[var(--ui-text-tertiary)] text-sm py-8 text-center">加载失败</div>) : (<>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 shrink-0 mb-3">
            {canEdit ? (<>
              <InfoCard label="构型号" value={editCode} readonly={false} onChange={(v) => { setEditCode(v); autoSaveMaster({ code: v }); }} />
              <InfoCard label="中文名称" value={editName} readonly={false} onChange={(v) => { setEditName(v); autoSaveMaster({ name: v }); }} />
              <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]"><div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">类型</div><div className="text-sm text-[var(--ui-text-primary)] font-medium">构型项</div></div>
            </>) : (<>
              <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]"><div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">构型号</div><div className="text-sm text-[var(--ui-text-primary)] font-medium font-mono">{master?.code}</div></div>
              <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]"><div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">中文名称</div><div className="text-sm text-[var(--ui-text-primary)] font-medium">{master?.name}</div></div>
              <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]"><div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">类型</div><div className="text-sm text-[var(--ui-text-primary)] font-medium">构型项</div></div>
            </>)}
          </div>

          <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] p-3 shrink-0 mb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-sm">版本：{revision?.version}</span>
                <Badge status={revision?.status || 'draft'} />
                {isCheckedOut && <span className="text-xs text-orange-600">已签出：{revision?.check_out_user_name || revision?.check_out_user_id}</span>}
              </div>
              <div className="flex gap-1 flex-wrap items-center">
                {(canCheckout || canCheckin || canUndo || canFreeze || canUnfreeze || canRelease || canUpgrade || canObsolete || canForceCheckin) && (<span className="mx-1 text-gray-300 self-center select-none">|</span>)}
                {canCheckout && <Button size="sm" onClick={() => doAction(() => configurationApi.checkout(internalRevId), '签出成功')}>签出/编辑</Button>}
                {canCheckin && <Button size="sm" onClick={() => setShowCheckinModal(true)}>签入/解锁</Button>}
                {canUndo && <Button variant="dark" size="sm" onClick={() => doAction(() => configurationApi.undocheckout(internalRevId), '已撤销签出')}>撤销签出</Button>}
                {canFreeze && <Button size="sm" onClick={() => doAction(() => configurationApi.freeze(internalRevId), '已冻结')}>冻结</Button>}
                {canUnfreeze && <Button variant="dark" size="sm" onClick={() => doAction(() => configurationApi.unfreeze(internalRevId), '已解冻')}>解冻</Button>}
                {canRelease && <Button size="sm" onClick={() => doAction(() => configurationApi.release(internalRevId), '已发布')}>发布</Button>}
                {canUpgrade && <Button size="sm" onClick={() => doAction(() => configurationApi.upgrade(internalRevId), '已升版')}>升版</Button>}
                {canObsolete && <Button variant="danger" size="sm" onClick={() => doAction(() => configurationApi.obsolete(internalRevId), '已作废')}>作废</Button>}
                {canForceCheckin && <Button variant="danger" size="sm" onClick={() => doAction(() => configurationApi.forceCheckin(internalRevId), '已强制签入')}>强制签入</Button>}
              </div>
            </div>
          </div>

          <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-hidden flex-1 min-h-0 flex flex-col">
            <div className="flex border-b border-[var(--ui-border)] shrink-0">
              {tabs.map((t) => (
                <button key={t.key} onClick={() => setActiveTab(t.key)} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === t.key ? 'border-primary-600 text-primary-600' : 'border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'}`}>{t.label}</button>
              ))}
            </div>
            <div className="p-4 overflow-y-auto flex-1 min-h-0">
              {activeTab === 'info' && (
                <div className="space-y-4">
                  <div className="text-xs text-[var(--ui-text-secondary)]">
                    Iteration #{viewingIterationData ? viewingIterationData.iteration : revision?.latest_iteration}
                    {viewingIterationData ? (
                      <span className="ml-2">签入说明：{viewingIterationData.check_in_note || '—'}</span>
                    ) : (
                      revision?.check_out_date && <span className="ml-2">签出时间：{new Date(revision.check_out_date).toLocaleString('zh-CN')}</span>
                    )}
                  </div>
                  {cfDefs.length > 0 ? (
                    <div><h4 className="text-[var(--ui-text-secondary)] font-semibold text-sm mb-2">自定义字段</h4><div className="grid grid-cols-3 gap-3">{cfDefs.map((def: any) => (<div key={def.id} className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]"><div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">{def.name}</div><div><CustomFieldInput def={def} value={cfValues[def.id]} onChange={(val) => { setCfValues(prev => ({ ...prev, [def.id]: val })); autoSaveCf(def.id, val); }} readOnly={!canEdit} /></div></div>))}</div></div>
                  ) : (<div className="text-[var(--ui-text-tertiary)] text-sm">无</div>)}
                </div>
              )}
              {activeTab === 'parts' && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-[var(--ui-text-secondary)] font-semibold text-sm">关联零部件 ({parts.length})</h4>
                    {canEdit && (
                      <Button size="sm" onClick={() => setPartPickerOpen(true)}>关联零部件</Button>
                    )}
                  </div>
                  {parts.length === 0 ? (<div className="text-[var(--ui-text-tertiary)] text-sm py-4 text-center">暂无关联零部件</div>) : (
                    <div className="border rounded-lg overflow-hidden"><table className="w-full text-sm">
                      <thead><tr className="bg-[var(--ui-bg-subtle)] border-b">
                        <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">件号</th>
                        <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">中文名称</th>
                        <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-14">版本</th>
                        <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-16">状态</th>
                        <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-20">签出状态</th>
                        <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-20 whitespace-nowrap">可选/必选</th>
                        <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-14">数量</th>
                        <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-14">预览</th>
                        <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-24">操作</th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-200">
                        {parts.map((p: any, i: number) => {
                          const pd = p.part_detail || {};
                          const isAssembly = p.part_type === 'assembly';
                          const canPreview = isAssembly || pd.has_3d;
                          return (
                            <tr key={p.id} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer" onClick={() => { if (p.part_id) setSelectedPartMasterId(p.part_id); }}>
                              <td className="px-3 py-2 font-mono text-xs">{pd.code || '—'}</td>
                              <td className="px-3 py-2">{pd.name || '—'}</td>
                              <td className="px-3 py-2 text-center text-[var(--ui-text-secondary)]">{pd.version || '—'}</td>
                              <td className="px-3 py-2 text-center">
                                <Badge status={pd.status || 'draft'} />
                              </td>
                              <td className="px-3 py-2 text-center">
                                {pd.check_out_user_name ? (<span className="text-xs text-orange-600">{pd.check_out_user_name}</span>) : (<span className="text-xs text-[var(--ui-text-tertiary)]">—</span>)}
                              </td>
                              <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                                {canEdit ? (
                                  <button onClick={async () => { try { await configurationApi.updatePart(internalRevId, p.id, { is_required: !p.is_required }); setParts(prev => prev.map(x => x.id === p.id ? { ...x, is_required: !x.is_required } : x)); } catch {} }}
                                    className={`text-xs px-2 py-0.5 rounded ${p.is_required ? 'bg-[var(--ui-blue-bg)] text-[var(--ui-blue-text)] hover:opacity-80' : 'bg-[var(--ui-gray-bg)] text-[var(--ui-gray-text)] hover:opacity-80'}`}>
                                    {p.is_required ? '必选' : '可选'}
                                  </button>
                                ) : (<span className={`text-xs ${p.is_required ? 'text-[var(--ui-blue-text)]' : 'text-[var(--ui-gray-text)]'}`}>{p.is_required ? '必选' : '可选'}</span>)}
                              </td>
                              <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                                {canEdit ? (
                                  <Input type="number" min={1} defaultValue={p.quantity || 1} size="xs" className="!w-14 text-center"
                                    onBlur={async (e) => { const val = parseInt(e.target.value) || 1; if (val === p.quantity) return; try { await configurationApi.updatePart(internalRevId, p.id, { quantity: val }); setParts(prev => prev.map(x => x.id === p.id ? { ...x, quantity: val } : x)); } catch {} }} />
                                ) : (p.quantity || 1)}
                              </td>
                              <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                                <Button variant="link" size="xs" onClick={() => handlePart3DPreview(p)}
                                  disabled={!canPreview}>
                                  3D
                                </Button>
                              </td>
                              <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                                  {canEdit && (
                                    <>
                                      <Button variant="link" size="xs" onClick={() => setVersionSelectIdx(i)}>选择</Button>
                                      <Button variant="danger" size="xs" onClick={() => setConfirmRemovePart(p)}>移除</Button>
                                    </>
                                  )}
                                  {!canEdit && <span className="text-xs text-[var(--ui-text-tertiary)]">—</span>}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody></table></div>
                  )}
                </div>
              )}
              {activeTab === 'children' && (
                <div className="flex flex-col h-full min-h-0">
                  <div className="flex items-center justify-between mb-3 shrink-0"><h4 className="text-[var(--ui-text-secondary)] font-semibold text-sm">子构型项</h4>{canEdit && (<Button size="sm" onClick={() => { setPickerParentId(internalRevId); setCfgPickerOpen(true); }}>+ 添加子项</Button>)}</div>
                  {children.length === 0 ? (<div className="text-[var(--ui-text-tertiary)] text-sm py-4 text-center">暂无子构型项</div>) : (
                     <div className="border rounded-lg overflow-hidden flex-1 min-h-0"><div className="overflow-y-auto h-full" ref={childrenScrollRef}><table className="w-full text-sm"><thead><tr className="bg-[var(--ui-bg-subtle)] border-b sticky top-0 z-10"><th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium" style={{ paddingLeft: 28 }}>构型号</th><th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">名称</th><th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-16">版本</th><th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-20">状态</th><th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-20">签出状态</th><th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-20 whitespace-nowrap">必选/可选</th><th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-16 whitespace-nowrap">数量</th>{canEdit && <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-28 whitespace-nowrap">操作</th>}</tr></thead><tbody className="divide-y divide-gray-200">{rows}</tbody></table></div></div>
                  )}
                </div>
              )}
              {activeTab === 'docs' && internalRevId && (<EntityDocumentSection entityType="configuration" entityId={internalRevId} editable={isCheckedOutByMe && isDraft} entityCode={master?.code} entityName={master?.name} />)}
              {activeTab === 'versions' && (
                <table className="w-full text-sm"><thead><tr className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)]"><th className="text-left px-4 py-3 text-sm font-medium text-[var(--ui-text-secondary)]">版本</th><th className="text-left px-4 py-3 text-sm font-medium text-[var(--ui-text-secondary)]">状态</th><th className="text-left px-4 py-3 text-sm font-medium text-[var(--ui-text-secondary)]">创建时间</th><th className="text-left px-4 py-3 text-sm font-medium text-[var(--ui-text-secondary)]">操作</th></tr></thead><tbody className="divide-y divide-gray-200">
                  {versions.map((v: any) => (
                    <tr key={v.id} className={`hover:bg-[var(--ui-bg-hover)] ${v.id === revision?.id ? 'bg-blue-50' : ''}`}><td className="px-4 py-3">{v.version}</td><td className="px-4 py-3"><Badge status={v.status} /></td><td className="px-4 py-3 text-[var(--ui-text-secondary)]">{v.created_at ? new Date(v.created_at).toLocaleDateString('zh-CN') : ''}</td><td className="px-4 py-3">{v.id === revision?.id ? (<span className="text-primary-600 text-xs">当前</span>) : (<Button variant="link" size="xs" onClick={() => setInternalRevId(v.id)}>切换</Button>)}</td></tr>
                  ))}
                </tbody></table>
              )}
              {activeTab === 'iterations' && (
                <table className="w-full text-sm"><thead><tr className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)]"><th className="text-left px-4 py-3 text-sm font-medium text-[var(--ui-text-secondary)]">迭代</th><th className="text-left px-4 py-3 text-sm font-medium text-[var(--ui-text-secondary)]">签入时间</th><th className="text-left px-4 py-3 text-sm font-medium text-[var(--ui-text-secondary)]">签入说明</th><th className="text-left px-4 py-3 text-sm font-medium text-[var(--ui-text-secondary)]">创建人</th><th className="text-left px-4 py-3 text-sm font-medium text-[var(--ui-text-secondary)]">操作</th></tr></thead><tbody className="divide-y divide-gray-200">
                  {iterations.map((it: any) => (
                    <tr key={it.id} className={`hover:bg-[var(--ui-bg-hover)] ${it.iteration === revision?.latest_iteration ? 'bg-blue-50' : ''}`}><td className="px-4 py-3">#{it.iteration}</td><td className="px-4 py-3 text-[var(--ui-text-secondary)]">{it.created_at ? new Date(it.created_at).toLocaleString('zh-CN') : '未签入'}</td><td className="px-4 py-3">{it.check_in_note || '—'}</td><td className="px-4 py-3 text-[var(--ui-text-secondary)]">{it.creator_name || '—'}</td><td className="px-4 py-3"><div className="flex items-center gap-2">{it.iteration === revision?.latest_iteration ? (<span className="text-primary-600 text-xs">当前</span>) : (<Button variant="link" size="xs" onClick={() => handleViewIteration(it)}>查看数据</Button>)}{it.iteration > 1 && isAdminUser && (<Button variant="danger" size="xs" onClick={() => handleDeleteIteration(it)}>删除</Button>)}</div></td></tr>
                  ))}
                </tbody></table>
              )}
            </div>
          </div>
        </>)}
      </div>

      <CheckinNoteModal
        open={showCheckinModal}
        note={checkinNote}
        onChange={setCheckinNote}
        saving={saving}
        onCancel={() => setShowCheckinModal(false)}
        onConfirm={async () => {
          setSaving(true);
          await doAction(() => configurationApi.checkin(internalRevId, checkinNote || ''), '签入成功');
          setSaving(false);
          setShowCheckinModal(false);
          setCheckinNote('');
        }}
      />
      {cfgPickerOpen && (
        <ConfigItemPicker open={cfgPickerOpen} onClose={() => { setCfgPickerOpen(false); setPickerParentId(null); }} excludeId={internalRevId}
          onConfirm={async (items) => { if (!pickerParentId) return; try { await configurationApi.addChildren(pickerParentId, items); toast.success(`已添加 ${items.length} 个子构型项`); if (pickerParentId !== internalRevId) { setSubChildren(prev => { const s = { ...prev }; delete s[pickerParentId]; return s; }); } setCfgPickerOpen(false); setPickerParentId(null); refreshChildren(pickerParentId); } catch {} }} />
      )}

      {/* 零部件选择器 */}
      <AssemblyPartPicker open={partPickerOpen} onClose={() => setPartPickerOpen(false)}
        existingChildIds={new Set(parts.map(p => p.part_detail?.revision_id).filter(Boolean) as string[])}
        onConfirm={async (items) => {
          const existingRevs = new Set(parts.map(p => p.part_detail?.revision_id).filter(Boolean));
          const toAdd: { part_type: string; part_id: string; revision_id: string; is_required: boolean; quantity: number }[] = [];
          for (const it of items) {
            if (existingRevs.has(it.child_id)) continue;
            let masterId = ''; let pType = 'part';
            try {
              const rev = await partsApi.getRevision(it.child_id);
              masterId = rev.master_id;
              if (!masterId) continue;
              const master = await partsApi.get(masterId);
              pType = master.type || 'part';
            } catch { continue; }
            toAdd.push({ part_type: pType, part_id: masterId, revision_id: it.child_id, is_required: true, quantity: it.quantity ?? 1 });
          }
          if (toAdd.length === 0) { setPartPickerOpen(false); return; }
          try {
            await configurationApi.addParts(internalRevId, toAdd);
            toast.success(`已关联 ${toAdd.length} 个零部件版本`);
            setPartPickerOpen(false);
            loadDetail();
          } catch (e: any) {
            const detail = e?.response?.data?.detail;
            const msg = Array.isArray(detail) ? detail.map((d: any) => d.msg).join('; ') : (typeof detail === 'string' ? detail : '操作失败');
            toast.error(msg);
          }
        }}
      />

      {/* 版本选择器 */}
      {versionSelectIdx !== null && parts[versionSelectIdx] && (
        <VersionSelectModal
          open={versionSelectIdx !== null}
          entityType="part"
          entityId={parts[versionSelectIdx].part_id}
          entityName={parts[versionSelectIdx].part_detail?.name || ''}
          currentVersionId={parts[versionSelectIdx].part_detail?.revision_id || parts[versionSelectIdx].part_id}
          onSelect={async (versionId: string) => {
            const target = parts[versionSelectIdx];
            setVersionSelectIdx(null);
            try {
              await configurationApi.updatePart(internalRevId, target.id, { revision_id: versionId });
              toast.success('已更新绑定版本');
              loadDetail();
            } catch (e: any) {
              toast.error(e?.response?.data?.detail || '更新版本失败');
            }
          }}
          onClose={() => setVersionSelectIdx(null)}
        />
      )}

      {nestedConfigRevId && (<ConfigItemDetailModal revisionId={nestedConfigRevId} open={!!nestedConfigRevId} onClose={() => setNestedConfigRevId(null)} />)}
      {selectedPartMasterId && (<PartDetailModal masterId={selectedPartMasterId} open={!!selectedPartMasterId} onClose={() => setSelectedPartMasterId(null)} />)}

      {/* 删除迭代确认 */}
      <ConfirmModal
        open={!!confirmDelIter}
        title="确认删除"
        content={confirmDelIter ? `确定删除迭代 #${confirmDelIter.iteration}？` : ''}
        confirmText="删除"
        cancelText="取消"
        type="danger"
        onConfirm={async () => {
          if (!confirmDelIter || !internalRevId) return;
          try { await configurationApi.deleteIteration(internalRevId, confirmDelIter.id); toast.success('迭代已删除'); setIterations(await configurationApi.iterations(internalRevId)); } catch (e: any) { toast.error(e?.response?.data?.detail || '删除失败'); }
          setConfirmDelIter(null);
        }}
        onCancel={() => setConfirmDelIter(null)}
      />

      {/* 移除子构型项确认 */}
      <ConfirmModal
        open={!!confirmRemoveChild}
        title="确认移除"
        content="确定移除此子构型项？"
        confirmText="移除"
        cancelText="取消"
        type="danger"
        onConfirm={async () => {
          if (!confirmRemoveChild) return;
          const { parentRevId, childId } = confirmRemoveChild;
          try { await configurationApi.removeChild(parentRevId, childId); setSubChildren(prev => { const s = { ...prev }; delete s[parentRevId]; return s; }); refreshChildren(parentRevId); } catch {}
          setConfirmRemoveChild(null);
        }}
        onCancel={() => setConfirmRemoveChild(null)}
      />

      {/* 移除关联零部件确认 */}
      <ConfirmModal
        open={!!confirmRemovePart}
        title="确认移除"
        content="确定移除此关联零部件？"
        confirmText="移除"
        cancelText="取消"
        type="danger"
        onConfirm={async () => {
          if (!confirmRemovePart || !internalRevId) return;
          try { await configurationApi.removePart(internalRevId, confirmRemovePart.id); setParts(prev => prev.filter(x => x.id !== confirmRemovePart.id)); } catch {}
          setConfirmRemovePart(null);
        }}
        onCancel={() => setConfirmRemovePart(null)}
      />
    </Modal>
  );
}

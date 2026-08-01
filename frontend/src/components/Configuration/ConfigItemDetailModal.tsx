import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { configurationApi, customFieldsApi, partsApi, mediaApi } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { useDataStore } from '../../stores/data';
import type { ConfigurationItemDetail, ConfigurationItemRevision } from '../../types';
import { Loading } from '../Loading';
import { toast } from '../Toast';
import { Modal } from '../Modal';
import EntityDocumentSection from '../EntityDocumentSection';
import CustomFieldInput from '../CustomFieldInput';
import ConfigItemPicker from './ConfigItemPicker';
import PartDetailModal from '../PartDetailModal';
import AssemblyPartPicker from '../AssemblyPartPicker';
import VersionSelectModal from '../VersionSelectModal';

const statusTag = (s: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
    frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
    released: { label: '发布', cls: 'bg-green-100 text-green-800' },
    obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
  };
  return map[s] || { label: s, cls: 'bg-gray-100 text-gray-800' };
};

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
    <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      {readonly ? (
        <div className="text-sm text-gray-900 font-medium">{value || '—'}</div>
      ) : (
        <input value={value} onChange={(e) => onChange?.(e.target.value)}
          className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono" />
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
      const fieldValues = cfDefs.map((def: any) => ({ field_id: def.id, value: fieldId === def.id ? value : cfValues[def.id] ?? null })).filter((fv: any) => fv.value !== null && fv.value !== '');
      if (fieldValues.length > 0) customFieldsApi.setValues('configuration_item', internalRevId, fieldValues).catch(() => {});
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

  const handleDeleteIteration = async (it: any) => {
    if (!internalRevId || !confirm(`确定删除迭代 #${it.iteration}？`)) return;
    try { await configurationApi.deleteIteration(internalRevId, it.id); toast.success('迭代已删除'); setIterations(await configurationApi.iterations(internalRevId)); } catch (e: any) { toast.error(e?.response?.data?.detail || '删除失败'); }
  };

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
        alert('该零件没有 STP/STEP 附件');
      }
    } catch { alert('打开预览失败'); }
  }, []);

  const renderChildRow = (c: any, level: number, parentRevisionId: string): React.ReactNode => {
    const revId = c.child_detail?.id || c.child_revision_id;
    const isExpanded = expandedChildren.has(revId);
    const nested = subChildren[revId] || [];
    const rows: React.ReactNode[] = [];
    rows.push(
      <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => { if (revId) setNestedConfigRevId(revId); }}>
        <td
          className="relative px-3 py-2 font-mono text-xs whitespace-nowrap"
          style={{ paddingLeft: 20 + (level - 1) * 12 }}
          onClick={(e) => e.stopPropagation()}
        >
          {level > 1 && Array.from({ length: level - 1 }, (_, k) => (
            <span
              key={k}
              className="absolute -top-px bottom-0 w-px bg-gray-200 pointer-events-none"
              style={{ left: 20 + k * 12 }}
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
                className="w-4 h-4 inline-flex items-center justify-center shrink-0 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200/60"
                title={isExpanded ? '折叠' : '展开'}>
                <BomChevron expanded={isExpanded} />
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <span className="text-xs">{c.child_detail?.code || '—'}</span>
          </span>
        </td>
        <td className="px-3 py-2">{c.child_detail?.name || '—'}</td>
        <td className="px-3 py-2 text-center text-gray-500 text-xs">{c.child_detail?.version || '—'}</td>
        <td className="px-3 py-2 text-center"><span className={`px-1.5 py-0.5 text-xs rounded-full ${statusTag(c.child_detail?.status || 'draft').cls}`}>{statusTag(c.child_detail?.status || 'draft').label}</span></td>
        <td className="px-3 py-2 text-center">{c.child_detail?.check_out_user_name ? (<span className="text-xs text-orange-600">{c.child_detail.check_out_user_name}</span>) : (<span className="text-xs text-gray-400">—</span>)}</td>
        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
          {canEdit ? (
            <button onClick={async () => { try { await configurationApi.updateChild(parentRevisionId, c.id, { is_required: !c.is_required }); if (parentRevisionId === internalRevId) { setChildren(prev => prev.map(x => x.id === c.id ? { ...x, is_required: !x.is_required } : x)); } else { setSubChildren(prev => { const s = { ...prev }; s[parentRevisionId] = (s[parentRevisionId] || []).map((x: any) => x.id === c.id ? { ...x, is_required: !x.is_required } : x); return s; }); } } catch {} }} className={`text-xs px-2 py-0.5 rounded ${c.is_required ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}>{c.is_required ? '必选' : '可选'}</button>
          ) : (<span className={`text-xs ${c.is_required ? 'text-green-600' : 'text-orange-600'}`}>{c.is_required ? '必选' : '可选'}</span>)}
        </td>
        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
          {canEdit ? (<input type="number" min={1} defaultValue={c.quantity || 1} className="w-14 text-xs px-1 py-0.5 border border-gray-200 rounded text-center" onBlur={async (e) => { const val = parseInt(e.target.value) || 1; if (val === c.quantity) return; try { await configurationApi.updateChild(parentRevisionId, c.id, { quantity: val }); if (parentRevisionId === internalRevId) { setChildren(prev => prev.map(x => x.id === c.id ? { ...x, quantity: val } : x)); } else { setSubChildren(prev => { const s = { ...prev }; s[parentRevisionId] = (s[parentRevisionId] || []).map((x: any) => x.id === c.id ? { ...x, quantity: val } : x); return s; }); } } catch {} }} />) : (c.quantity || 1)}
        </td>
        {canEdit && (
          <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <button onClick={() => { setPickerParentId(revId); setCfgPickerOpen(true); }} className="text-primary-600 hover:text-primary-800 text-xs">+子项</button>
              <button onClick={async () => { if (!confirm('确定移除此子构型项？')) return; try { await configurationApi.removeChild(parentRevisionId, c.id); setSubChildren(prev => { const s = { ...prev }; delete s[parentRevisionId]; return s; }); refreshChildren(parentRevisionId); } catch {} }} className="text-red-500 hover:text-red-700 text-xs">移除</button>
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
    <Modal open={open} title="构型项详情" onClose={handleClose} width="3xl"
      headerAction={viewingIterationData ? (
        <span className="flex items-center gap-2 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded">
          正在查看 Iteration #{viewingIterationData.iteration} 的历史数据（只读）
          <button onClick={() => { setViewingIterationData(null); setActiveIterationId(null); }}
            className="text-primary-600 hover:text-primary-800 hover:underline">返回当前迭代</button>
        </span>
      ) : undefined}
    >
      <div className="h-[50vh] flex flex-col">
        {detailLoading && !master ? (<Loading />) : !master ? (<div className="text-gray-400 text-sm py-8 text-center">加载失败</div>) : (<>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 shrink-0 mb-3">
            {canEdit ? (<>
              <InfoCard label="构型号" value={editCode} readonly={false} onChange={(v) => { setEditCode(v); autoSaveMaster({ code: v }); }} />
              <InfoCard label="中文名称" value={editName} readonly={false} onChange={(v) => { setEditName(v); autoSaveMaster({ name: v }); }} />
              <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100"><div className="text-xs text-gray-500 mb-0.5">类型</div><div className="text-sm text-gray-900 font-medium">构型项</div></div>
            </>) : (<>
              <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100"><div className="text-xs text-gray-500 mb-0.5">构型号</div><div className="text-sm text-gray-900 font-medium font-mono">{master?.code}</div></div>
              <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100"><div className="text-xs text-gray-500 mb-0.5">中文名称</div><div className="text-sm text-gray-900 font-medium">{master?.name}</div></div>
              <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100"><div className="text-xs text-gray-500 mb-0.5">类型</div><div className="text-sm text-gray-900 font-medium">构型项</div></div>
            </>)}
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-3 shrink-0 mb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-sm">版本：{revision?.version}</span>
                <span className={`px-2 py-1 text-xs rounded-full ${statusTag(revision?.status || 'draft').cls}`}>{statusTag(revision?.status || 'draft').label}</span>
                {isCheckedOut && <span className="text-xs text-orange-600">已签出：{revision?.check_out_user_name || revision?.check_out_user_id}</span>}
              </div>
              <div className="flex gap-1 flex-wrap items-center">
                {(canCheckout || canCheckin || canUndo || canFreeze || canRelease || canUpgrade || canObsolete || canForceCheckin) && (<span className="mx-1 text-gray-300 self-center select-none">|</span>)}
                {canCheckout && <button onClick={() => doAction(() => configurationApi.checkout(internalRevId), '签出成功')} className="px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">签出</button>}
                {canCheckin && <button onClick={() => setShowCheckinModal(true)} className="px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">签入</button>}
                {canUndo && <button onClick={() => doAction(() => configurationApi.undocheckout(internalRevId), '已撤销签出')} className="px-3 py-1 bg-gray-500 text-white rounded text-xs hover:bg-gray-600">撤销签出</button>}
                {canFreeze && <button onClick={() => doAction(() => configurationApi.freeze(internalRevId), '已冻结')} className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">冻结</button>}
                {canRelease && <button onClick={() => doAction(() => configurationApi.release(internalRevId), '已发布')} className="px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">发布</button>}
                {canUpgrade && <button onClick={() => doAction(() => configurationApi.upgrade(internalRevId), '已升版')} className="px-3 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700">升版</button>}
                {canObsolete && <button onClick={() => doAction(() => configurationApi.obsolete(internalRevId), '已作废')} className="px-3 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">作废</button>}
                {canForceCheckin && <button onClick={() => doAction(() => configurationApi.forceCheckin(internalRevId), '已强制签入')} className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700">强制签入</button>}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex-1 min-h-0 flex flex-col">
            <div className="flex border-b border-gray-200 shrink-0">
              {tabs.map((t) => (
                <button key={t.key} onClick={() => setActiveTab(t.key)} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === t.key ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{t.label}</button>
              ))}
            </div>
            <div className="p-4 overflow-y-auto flex-1 min-h-0">
              {activeTab === 'info' && (
                <div className="space-y-4">
                  <div className="text-xs text-gray-500">
                    Iteration #{viewingIterationData ? viewingIterationData.iteration : revision?.latest_iteration}
                    {viewingIterationData ? (
                      <span className="ml-2">签入说明：{viewingIterationData.check_in_note || '—'}</span>
                    ) : (
                      revision?.check_out_date && <span className="ml-2">签出时间：{new Date(revision.check_out_date).toLocaleString('zh-CN')}</span>
                    )}
                  </div>
                  {cfDefs.length > 0 ? (
                    <div><h4 className="text-sm font-semibold mb-2">自定义字段</h4><div className="grid grid-cols-3 gap-3">{cfDefs.map((def: any) => (<div key={def.id}><label className="text-xs text-gray-500">{def.name}</label><div className="mt-0.5"><CustomFieldInput def={def} value={cfValues[def.id]} onChange={(val) => { setCfValues(prev => ({ ...prev, [def.id]: val })); autoSaveCf(def.id, val); }} readOnly={!canEdit} /></div></div>))}</div></div>
                  ) : (<div className="text-gray-400 text-sm">无</div>)}
                  <div className="text-xs text-gray-400">创建时间：{master?.created_at ? new Date(master.created_at).toLocaleString('zh-CN') : '—'}</div>
                </div>
              )}
              {activeTab === 'parts' && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-gray-700">关联零部件 ({parts.length})</h4>
                    {canEdit && (
                      <button onClick={() => setPartPickerOpen(true)}
                        className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">关联零部件</button>
                    )}
                  </div>
                  {parts.length === 0 ? (<div className="text-gray-400 text-sm py-4 text-center">暂无关联零部件</div>) : (
                    <div className="border rounded-lg overflow-hidden"><table className="w-full text-sm">
                      <thead><tr className="bg-gray-50 border-b">
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">件号</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">中文名称</th>
                        <th className="px-3 py-2 text-center text-gray-500 font-medium w-14">版本</th>
                        <th className="px-3 py-2 text-center text-gray-500 font-medium w-16">状态</th>
                        <th className="px-3 py-2 text-center text-gray-500 font-medium w-20">签出状态</th>
                        <th className="px-3 py-2 text-center text-gray-500 font-medium w-20 whitespace-nowrap">可选/必选</th>
                        <th className="px-3 py-2 text-center text-gray-500 font-medium w-14">数量</th>
                        <th className="px-3 py-2 text-center text-gray-500 font-medium w-14">预览</th>
                        <th className="px-3 py-2 text-center text-gray-500 font-medium w-24">操作</th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-200">
                        {parts.map((p: any, i: number) => {
                          const pd = p.part_detail || {};
                          const isAssembly = p.part_type === 'assembly';
                          const canPreview = isAssembly || pd.has_3d;
                          return (
                            <tr key={p.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => { if (p.part_id) setSelectedPartMasterId(p.part_id); }}>
                              <td className="px-3 py-2 font-mono text-xs">{pd.code || '—'}</td>
                              <td className="px-3 py-2">{pd.name || '—'}</td>
                              <td className="px-3 py-2 text-center text-gray-500">{pd.version || '—'}</td>
                              <td className="px-3 py-2 text-center">
                                <span className={`px-1.5 py-0.5 text-xs rounded-full ${statusTag(pd.status || 'draft').cls}`}>{statusTag(pd.status || 'draft').label}</span>
                              </td>
                              <td className="px-3 py-2 text-center">
                                {pd.check_out_user_name ? (<span className="text-xs text-orange-600">{pd.check_out_user_name}</span>) : (<span className="text-xs text-gray-400">—</span>)}
                              </td>
                              <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                                {canEdit ? (
                                  <button onClick={async () => { try { await configurationApi.updatePart(internalRevId, p.id, { is_required: !p.is_required }); setParts(prev => prev.map(x => x.id === p.id ? { ...x, is_required: !x.is_required } : x)); } catch {} }}
                                    className={`text-xs px-2 py-0.5 rounded ${p.is_required ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}>
                                    {p.is_required ? '必选' : '可选'}
                                  </button>
                                ) : (<span className={`text-xs ${p.is_required ? 'text-green-600' : 'text-orange-600'}`}>{p.is_required ? '必选' : '可选'}</span>)}
                              </td>
                              <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                                {canEdit ? (
                                  <input type="number" min={1} defaultValue={p.quantity || 1} className="w-14 text-xs px-1 py-0.5 border border-gray-200 rounded text-center"
                                    onBlur={async (e) => { const val = parseInt(e.target.value) || 1; if (val === p.quantity) return; try { await configurationApi.updatePart(internalRevId, p.id, { quantity: val }); setParts(prev => prev.map(x => x.id === p.id ? { ...x, quantity: val } : x)); } catch {} }} />
                                ) : (p.quantity || 1)}
                              </td>
                              <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                                <button onClick={() => handlePart3DPreview(p)}
                                  disabled={!canPreview}
                                  className={`text-xs px-2 py-0.5 rounded ${canPreview ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                                  3D
                                </button>
                              </td>
                              <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                                  {canEdit && (
                                    <>
                                      <button onClick={() => setVersionSelectIdx(i)} className="text-xs text-blue-600 hover:text-blue-800">选择</button>
                                      <button onClick={async () => { if (!confirm('确定移除此关联零部件？')) return; try { await configurationApi.removePart(internalRevId, p.id); setParts(prev => prev.filter(x => x.id !== p.id)); } catch {} }}
                                        className="text-xs text-red-500 hover:text-red-700">移除</button>
                                    </>
                                  )}
                                  {!canEdit && <span className="text-xs text-gray-400">—</span>}
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
                  <div className="flex items-center justify-between mb-3 shrink-0"><h4 className="text-sm font-bold text-gray-700">子构型项</h4>{canEdit && (<button onClick={() => { setPickerParentId(internalRevId); setCfgPickerOpen(true); }} className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700">+ 添加子项</button>)}</div>
                  {children.length === 0 ? (<div className="text-gray-400 text-sm py-4 text-center">暂无子构型项</div>) : (
                     <div className="border rounded-lg overflow-hidden flex-1 min-h-0"><div className="overflow-y-auto h-full" ref={childrenScrollRef}><table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b sticky top-0 z-10"><th className="px-3 py-2 text-left text-gray-500 font-medium">构型号</th><th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th><th className="px-3 py-2 text-center text-gray-500 font-medium w-16">版本</th><th className="px-3 py-2 text-center text-gray-500 font-medium w-20">状态</th><th className="px-3 py-2 text-center text-gray-500 font-medium w-20">签出状态</th><th className="px-3 py-2 text-center text-gray-500 font-medium w-20 whitespace-nowrap">必选/可选</th><th className="px-3 py-2 text-center text-gray-500 font-medium w-16 whitespace-nowrap">数量</th>{canEdit && <th className="px-3 py-2 text-center text-gray-500 font-medium w-28 whitespace-nowrap">操作</th>}</tr></thead><tbody className="divide-y divide-gray-200">{rows}</tbody></table></div></div>
                  )}
                </div>
              )}
              {activeTab === 'docs' && internalRevId && (<EntityDocumentSection entityType="configuration" entityId={internalRevId} editable={isCheckedOutByMe && isDraft} entityCode={master?.code} entityName={master?.name} />)}
              {activeTab === 'versions' && (
                <table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b border-gray-200"><th className="text-left px-4 py-3 text-sm font-medium text-gray-500">版本</th><th className="text-left px-4 py-3 text-sm font-medium text-gray-500">状态</th><th className="text-left px-4 py-3 text-sm font-medium text-gray-500">创建时间</th><th className="text-left px-4 py-3 text-sm font-medium text-gray-500">操作</th></tr></thead><tbody className="divide-y divide-gray-200">
                  {versions.map((v: any) => (
                    <tr key={v.id} className={`hover:bg-gray-50 ${v.id === revision?.id ? 'bg-blue-50' : ''}`}><td className="px-4 py-3">{v.version}</td><td className="px-4 py-3"><span className={`px-2 py-1 text-xs rounded-full ${statusTag(v.status).cls}`}>{statusTag(v.status).label}</span></td><td className="px-4 py-3 text-gray-500">{v.created_at ? new Date(v.created_at).toLocaleDateString('zh-CN') : ''}</td><td className="px-4 py-3">{v.id === revision?.id ? (<span className="text-primary-600 text-xs">当前</span>) : (<button onClick={() => setInternalRevId(v.id)} className="text-primary-600 hover:text-primary-800 hover:underline text-xs">切换</button>)}</td></tr>
                  ))}
                </tbody></table>
              )}
              {activeTab === 'iterations' && (
                <table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b border-gray-200"><th className="text-left px-4 py-3 text-sm font-medium text-gray-500">迭代</th><th className="text-left px-4 py-3 text-sm font-medium text-gray-500">签入时间</th><th className="text-left px-4 py-3 text-sm font-medium text-gray-500">签入说明</th><th className="text-left px-4 py-3 text-sm font-medium text-gray-500">创建人</th><th className="text-left px-4 py-3 text-sm font-medium text-gray-500">操作</th></tr></thead><tbody className="divide-y divide-gray-200">
                  {iterations.map((it: any) => (
                    <tr key={it.id} className={`hover:bg-gray-50 ${it.iteration === revision?.latest_iteration ? 'bg-blue-50' : ''}`}><td className="px-4 py-3">#{it.iteration}</td><td className="px-4 py-3 text-gray-500">{it.created_at ? new Date(it.created_at).toLocaleString('zh-CN') : '未签入'}</td><td className="px-4 py-3">{it.check_in_note || '—'}</td><td className="px-4 py-3 text-gray-500">{it.creator_name || '—'}</td><td className="px-4 py-3"><div className="flex items-center gap-2">{it.iteration === revision?.latest_iteration ? (<span className="text-primary-600 text-xs">当前</span>) : (<button onClick={() => handleViewIteration(it)} className="text-primary-600 hover:text-primary-800 hover:underline text-xs">查看数据</button>)}{it.iteration > 1 && isAdminUser && (<button onClick={() => handleDeleteIteration(it)} className="text-xs text-red-600 hover:text-red-800 hover:underline">删除</button>)}</div></td></tr>
                  ))}
                </tbody></table>
              )}
            </div>
          </div>
        </>)}
      </div>

      {showCheckinModal && (
        <Modal open={showCheckinModal} onClose={() => setShowCheckinModal(false)} title="签入说明" width="md">
          <div className="p-4"><textarea className="w-full border rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" rows={3} placeholder="请输入签入说明（选填）..." value={checkinNote} onChange={(e) => setCheckinNote(e.target.value)} />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCheckinModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">取消</button>
              <button onClick={async () => { setSaving(true); await doAction(() => configurationApi.checkin(internalRevId, checkinNote || ''), '签入成功'); setSaving(false); setShowCheckinModal(false); setCheckinNote(''); }} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50" disabled={saving}>{saving ? '保存中...' : '确认签入'}</button>
            </div>
          </div>
        </Modal>
      )}
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
    </Modal>
  );
}

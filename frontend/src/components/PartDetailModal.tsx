import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { partsApi, customFieldsApi, mediaApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import type { PartMaster, PartRevision, PartIteration, PartStatus, CascadeResult, PartListItem } from '../types';
import { Loading } from './Loading';
import { toast } from './Toast';
import { Modal } from './Modal';
import EntityDocumentSection from './EntityDocumentSection';
import PartAttachmentBucket from './PartAttachmentBucket';
import AssemblyPartPicker from './AssemblyPartPicker';
import PartCompareModal from './PartCompareModal';
import PartWhereUsedTab from './PartDetailModal/PartWhereUsedTab';
import ConfigItemDetailModal from './Configuration/ConfigItemDetailModal';
import TaskEditModal from '../pages/Project/TaskEditModal';
import ProfileEditModal from './Configuration/ProfileEditModal';
import { useTableSort } from '../hooks/useTableSort';

/** BOM 结构树的展开箭头，与 STPViewer 模型树(ModelTreePanel)保持同一风格 */
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

const statusTag = (s: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
    frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
    released: { label: '发布', cls: 'bg-green-100 text-green-800' },
    obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
  };
  return map[s] || { label: s, cls: 'bg-gray-100 text-gray-800' };
};

interface PartDetailModalProps {
  masterId: string;
  revisionId?: string;
  open: boolean;
  onClose: (savedPatch?: Record<string, string>) => void;
}

export default function PartDetailModal({ masterId, revisionId: propRevisionId, open, onClose }: PartDetailModalProps) {
  const { user } = useAuthStore();

  const [master, setMaster] = useState<PartMaster | null>(null);
  const [revision, setRevision] = useState<PartRevision | null>(null);
  const [iteration, setIteration] = useState<PartIteration | null>(null);
  const [internalRevisionId, setInternalRevisionId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'bom' | 'whereused' | 'docs' | 'attachments' | 'versions' | 'iterations'>('info');
  const [checkinNote, setCheckinNote] = useState('');
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [viewingIteration, setViewingIteration] = useState<PartIteration | null>(null);
  const [viewingIterationId, setViewingIterationId] = useState<string | null>(null);
  const [bomItems, setBomItems] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);
  const [iterationsList, setIterationsList] = useState<any[]>([]);

  const [cfDefs, setCfDefs] = useState<any[]>([]);
  const [cfEditValues, setCfEditValues] = useState<Record<string, any>>({});
  const [editMaster, setEditMaster] = useState({ code: '', name: '' });
  const [hasBomChildren, setHasBomChildren] = useState(false);
  const [bomPickerOpen, setBomPickerOpen] = useState(false);
  const [nestedPickerRevId, setNestedPickerRevId] = useState<string | null>(null);
  const [expandedBom, setExpandedBom] = useState<Record<string, any[]>>({});
  const [loadingBom, setLoadingBom] = useState<Record<string, boolean>>({});
  const [versionSelectItem, setVersionSelectItem] = useState<any>(null);
  const [versionSelectRevisions, setVersionSelectRevisions] = useState<any[]>([]);
  const [versionSelectLoading, setVersionSelectLoading] = useState(false);
  const [matrixPopup, setMatrixPopup] = useState<any>(null);
  const [nestedMasterId, setNestedMasterId] = useState<string | null>(null);
  const [nestedRevisionId, setNestedRevisionId] = useState<string | null>(null);
  const [wuConfigRevId, setWuConfigRevId] = useState<string | null>(null);
  const [wuTask, setWuTask] = useState<{ projectId: string; task: any } | null>(null);
  const [wuProfileId, setWuProfileId] = useState<string | null>(null);
  // 版本 Tab BOM 对比：勾选两个版本（当前版本默认选中）→ 打开预选对比弹窗
  const [cmpSel, setCmpSel] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);

  const bomScrollRef = useRef<HTMLDivElement>(null);

  // BOM 子项清单排序
  type BomSortableItem = Record<string, any>;
  const bomFlatForSort = useMemo(() => bomItems.map((item: any) => ({
    ...item,
  }) as BomSortableItem), [bomItems]);
  const { sortedData: sortedBomItems, sortField, sortDirection, handleSort, getSortIcon } = useTableSort<BomSortableItem>(bomFlatForSort);

  // 对展开的子项应用与顶层相同的排序
  const sortBomChildren = useCallback((list: any[]): any[] => {
    if (!sortField || !sortDirection) return list;
    return [...list].sort((a: any, b: any) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = String(aVal).localeCompare(String(bVal), 'zh-CN');
      return sortDirection === 'desc' ? -cmp : cmp;
    });
  }, [sortField, sortDirection]);

  useEffect(() => {
    if (open) {
      setMaster(null);
      setRevision(null);
      setIteration(null);
      setInternalRevisionId(propRevisionId || null);
      setActiveTab('info');
      setViewingIterationId(null);
      setViewingIteration(null);
      customFieldsApi.listDefinitions().then((res: any) => {
        const defs = (res.data || res || []).filter((d: any) => {
          const applies: string[] = d.applies_to || [];
          return applies.includes('component');
        });
        setCfDefs(defs);
        if (propRevisionId) {
          customFieldsApi.getValues('component', propRevisionId).then(r => {
            const vals: Record<string, any> = {};
            (r.data || []).forEach((v: any) => { vals[v.field_id] = v.value; });
            setCfEditValues(vals);
          }).catch(() => {});
        }
      }).catch((e: any) => {
        console.error('Failed to load custom field definitions', e);
        setCfDefs([]);
      });
    }
  }, [open, masterId, propRevisionId]);

  const revisionId = internalRevisionId || revision?.id;

  const cfSaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const debouncedCfSave = useCallback((values: Record<string, any>) => {
    if (!revisionId) return;
    if (cfSaveTimer.current) clearTimeout(cfSaveTimer.current);
    cfSaveTimer.current = setTimeout(() => {
      const fieldValues = cfDefs.map((def: any) => ({
        field_id: def.id,
        value: values[def.id] ?? null,
      }));
      customFieldsApi.setValues('component', revisionId!, fieldValues).catch(console.error);
    }, 500);
  }, [revisionId, cfDefs]);

  useEffect(() => {
    if (cfDefs.length > 0 && revisionId) {
      customFieldsApi.getValues('component', revisionId).then(r => {
        const vals: Record<string, any> = {};
        (r.data || []).forEach((v: any) => { vals[v.field_id] = v.value; });
        setCfEditValues(vals);
      }).catch(() => {});
    }
  }, [cfDefs, revisionId]);

  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const autoSave = useCallback((data: Record<string, any>) => {
    if (!revisionId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      partsApi.updateIteration(revisionId, data).catch(console.error);
    }, 500);
  }, [revisionId]);

  const masterTimer = useRef<ReturnType<typeof setTimeout>>();
  const savedPatchRef = useRef<Record<string, string>>({});
  const autoSaveMaster = useCallback((data: Record<string, any>) => {
    if (!masterId) return;
    if (masterTimer.current) clearTimeout(masterTimer.current);
    masterTimer.current = setTimeout(() => {
      partsApi.update(masterId, data).then(() => {
        Object.assign(savedPatchRef.current, data);
      }).catch(console.error);
    }, 500);
  }, [masterId]);

  const loadDetail = useCallback(async () => {
    if (!masterId) return;
    setDetailLoading(true);
    try {
      const m = await partsApi.get(masterId);
      setMaster(m);
      setEditMaster({ code: m.code || '', name: m.name || '' });
      const revId = internalRevisionId || propRevisionId || (m.latest_revision?.id);
      if (revId) {
        if (!internalRevisionId) setInternalRevisionId(revId);
        const rev = await partsApi.getRevision(revId);
        setRevision(rev);
        if (rev.current_iteration) {
          setIteration(rev.current_iteration);
        }
        try {
          const iterId = viewingIterationId || iteration?.id;
          const bomData = await partsApi.getBOM(revId, iterId);
          setHasBomChildren(bomData.length > 0);
        } catch { setHasBomChildren(false); }
      }
    } catch (e) { console.error(e); } finally { setDetailLoading(false); }
  }, [masterId, internalRevisionId]);

  useEffect(() => { if (open) { loadDetail(); } }, [loadDetail, open]);

  useEffect(() => {
    setViewingIterationId(null);
    setViewingIteration(null);
  }, [internalRevisionId]);

  const loadTabs = useCallback(async () => {
    if (!revisionId || !masterId) return;
    try {
      if (activeTab === 'bom') {
        const iterId = viewingIterationId || iteration?.id;
        const bomData = await partsApi.getBOM(revisionId, iterId);
        setBomItems(bomData);
        setHasBomChildren(bomData.length > 0);
      }
      if (activeTab === 'versions') {
        setVersions(await partsApi.revisions(masterId));
      }
      if (activeTab === 'iterations') {
        setIterationsList(await partsApi.iterations(revisionId));
      }
    } catch (e) { console.error(e); }
  }, [revisionId, activeTab, masterId]);

  useEffect(() => { loadTabs(); }, [loadTabs]);

  // 版本 Tab BOM 对比：版本列表首次加载完成且未做过选择时，默认勾选当前查看版本
  useEffect(() => {
    if (versions.length > 0 && cmpSel.length === 0 && revision?.id) {
      setCmpSel([revision.id]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions.length]);

  /** 勾选切换：最多 2 个，已满 2 个时新勾选替换第二个 */
  const toggleCmpSel = (vid: string) => {
    setCmpSel((prev) => {
      if (prev.includes(vid)) return prev.filter((x) => x !== vid);
      if (prev.length < 2) return [...prev, vid];
      return [prev[0], vid];
    });
  };

  /** 版本 id → PartListItem（PartCompareModal 预选展示用） */
  const toPartListItem = (vid: string): PartListItem | undefined => {
    const v = versions.find((x) => x.id === vid);
    if (!v || !master) return undefined;
    return {
      master_id: master.id,
      code: master.code,
      name: master.name,
      type: (master.type as 'part' | 'assembly') || 'part',
      revision_id: vid,
      version: v.version,
      status: v.status as PartStatus,
      latest_iteration: v.latest_iteration ?? 0,
    };
  };

  const openCompare = () => {
    if (cmpSel.length !== 2) return;
    setShowCompare(true);
  };

  const isCheckedOut = !!revision?.check_out_user_id;
  const isAssembly = master?.type === 'assembly' || hasBomChildren;

  const isCheckedOutByMe = isCheckedOut && revision?.check_out_user_id === user?.id;
  const isDraft = revision?.status === 'draft';
  const isAdminUser = user?.role === 'admin';
  const canEdit = isCheckedOutByMe && isDraft;
  const canCheckout = isDraft && !isCheckedOut;
  const canCheckin = isDraft && isCheckedOutByMe;
  const canUndo = isDraft && isCheckedOutByMe && (revision?.latest_iteration || 0) > 1;
  const canRelease = (revision?.status === 'draft' || revision?.status === 'frozen') && !isCheckedOut;
  const canFreeze = revision?.status === 'draft' && !isCheckedOut;
  const canUnfreeze = revision?.status === 'frozen' && isAdminUser;
  const canUpgrade = revision?.status === 'released' || revision?.status === 'obsolete';
  const canObsolete = revision?.status === 'released';
  const canForceCheckin = isCheckedOut && isAdminUser;

  const toggleBomExpand = useCallback(async (revId: string) => {
    if (expandedBom[revId]) {
      setExpandedBom(prev => { const n = {...prev}; delete n[revId]; return n; });
      return;
    }
    setLoadingBom(prev => ({...prev, [revId]: true}));
    try {
      const children = await partsApi.getBOM(revId);
      setExpandedBom(prev => ({...prev, [revId]: sortBomChildren(children || [])}));
    } catch { setExpandedBom(prev => ({...prev, [revId]: []})); }
    finally { setLoadingBom(prev => { const n = {...prev}; delete n[revId]; return n; }); }
  }, [expandedBom, sortBomChildren]);

  /** 局部刷新指定父节点的子项清单，保持滚动位置不变 */
  const refreshChildren = useCallback(async (parentRevId: string) => {
    const scrollTop = bomScrollRef.current?.scrollTop;
    try {
      const iterId = viewingIterationId || iteration?.id;
      if (parentRevId === revisionId) {
        const data = await partsApi.getBOM(revisionId!, iterId);
        setBomItems(data);
        setHasBomChildren(data.length > 0);
      } else {
        const data = await partsApi.getBOM(parentRevId);
        setExpandedBom(prev => ({ ...prev, [parentRevId]: sortBomChildren(data || []) }));
      }
    } catch (e) { console.error(e); }
    requestAnimationFrame(() => {
      if (bomScrollRef.current && scrollTop !== undefined) {
        bomScrollRef.current.scrollTop = scrollTop;
      }
    });
  }, [revisionId, iteration?.id, viewingIterationId, sortBomChildren]);

  const preview3D = useCallback(async (item: any) => {
    const revId = item.child_revision_id;
    if (!revId) return;
    if (item.has_children) {
      window.open(`/stp-viewer?assembly=${revId}`, '_blank');
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
        window.open(`/stp-viewer?id=${stp.id}&token=${encodeURIComponent(mt)}&code=${encodeURIComponent(item.child_code || '')}&version=${item.child_version || ''}&name=${encodeURIComponent(item.child_name || '')}`, '_blank');
      } else {
        alert('该零件没有 STP/STEP 附件');
      }
    } catch { alert('打开预览失败'); }
  }, []);

  const renderBomRow = useCallback((item: any, level: number, parentRevId?: string): React.ReactNode => {
    const hasChildren = item.has_children;
    const children = expandedBom[item.child_revision_id];
    const isLoading = loadingBom[item.child_revision_id];
    const rowClick = () => {
      if (item.child_master_id) {
        setNestedMasterId(item.child_master_id);
        setNestedRevisionId(item.child_revision_id);
      }
    };
    const checkoutName = item.child_check_out_user_name;
    return (
      <React.Fragment key={item.child_revision_id}>
        <tr className="hover:bg-gray-50 cursor-pointer" onClick={rowClick}>
          <td
            className="relative px-3 py-2 font-medium whitespace-nowrap"
            style={{ paddingLeft: 8 + level * 12 }}
            onClick={(e) => e.stopPropagation()}
          >
            {level > 0 && Array.from({ length: level }, (_, k) => (
              <span
                key={k}
                className="absolute -top-px bottom-0 w-px bg-gray-200 pointer-events-none"
                style={{ left: 16 + k * 12 }}
              />
            ))}
            <span className="inline-flex items-center gap-1">
              {hasChildren ? (
                <button type="button" onClick={(e) => { e.stopPropagation(); toggleBomExpand(item.child_revision_id); }}
                  className="w-4 h-4 inline-flex items-center justify-center shrink-0 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200/60"
                  title={children ? '\u6298\u53E0' : '\u5C55\u5F00'}>
                  <BomChevron expanded={!!children} />
                </button>
              ) : (
                <span className="w-4 shrink-0" />
              )}
              <span className="text-sm">{item.child_code}</span>
            </span>
          </td>
          <td className="px-3 py-2">{item.child_name}</td>
          <td className="px-3 py-2 text-gray-500">{item.child_version}</td>
          <td className="px-3 py-2">
            <span className={`px-1.5 py-0.5 text-xs rounded ${statusTag(item.child_status || 'draft').cls}`}>
              {statusTag(item.child_status || 'draft').label}
            </span>
          </td>
          <td className="px-3 py-2 text-xs">
            {checkoutName ? (
              <span className="text-orange-600">{checkoutName}</span>
            ) : <span className="text-gray-400">—</span>}
          </td>
          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
            {canEdit && !viewingIterationId ? (
              <input type="number" min={1} defaultValue={item.quantity}
                onBlur={async (e) => {
                  const v = parseInt(e.target.value);
                    if (v > 0 && v !== item.quantity && revisionId) {
                        try { await partsApi.updateBOMItem(revisionId, item.id, { quantity: v }); refreshChildren(parentRevId || revisionId); } catch {}
                      }
                }}
                className="w-16 px-1.5 py-0.5 border border-gray-300 rounded text-right text-sm focus:outline-none focus:ring-1 focus:ring-primary-500" />
            ) : item.quantity}
          </td>
          <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
            {item.cad_instances?.length > 0 ? (
              <button type="button" onClick={(e) => { e.stopPropagation(); setMatrixPopup(item); }}
                className="text-indigo-500 hover:text-indigo-700 text-lg leading-none cursor-pointer" title="查看变换矩阵">📐</button>
            ) : <span className="text-gray-300">—</span>}
          </td>
          <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={(e) => { e.stopPropagation(); preview3D(item); }}
              className="text-primary-600 hover:text-primary-800 text-xs whitespace-nowrap">3D预览</button>
          </td>
          {canEdit && !viewingIterationId && (
            <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
              <span className="inline-flex items-center gap-1">
                <button type="button" onClick={(e) => {
                  e.stopPropagation();
                  setVersionSelectItem(item);
                  setVersionSelectLoading(true);
                  partsApi.revisions(item.child_master_id)
                    .then((revs: any[]) => setVersionSelectRevisions(revs || []))
                    .catch(() => setVersionSelectRevisions([]))
                    .finally(() => setVersionSelectLoading(false));
                }}
                  className="text-primary-600 hover:text-primary-800 text-xs">选择</button>
                {hasChildren && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); setNestedPickerRevId(item.child_revision_id); }}
                    className="text-primary-600 hover:text-primary-800 text-xs">+子项</button>
                )}
                <button type="button" onClick={async (e) => {
                  e.stopPropagation();
                  if (!revisionId) return;
                  if (!confirm('确定移除此子项？')) return;
                  const targetRevId = parentRevId || revisionId;
                  try {
                    await partsApi.deleteBOMItem(targetRevId, item.id);
                    toast.success('已删除');
                    refreshChildren(targetRevId);
                  } catch (e2: any) { toast.error(e2?.response?.data?.detail || '删除失败'); }
                }}
                  className="text-red-500 hover:text-red-700 text-xs">移除</button>
              </span>
            </td>
          )}
        </tr>
        {isLoading && <tr><td colSpan={canEdit ? 9 : 8} className="px-3 py-2 text-sm text-gray-400 text-center">加载中...</td></tr>}
        {children && children.map((child: any) => renderBomRow(child, level + 1, item.child_revision_id))}
      </React.Fragment>
    );
  }, [canEdit, expandedBom, loadingBom, toggleBomExpand, revisionId, refreshChildren, toast, preview3D]);

  const updateBomItemVersion = useCallback((items: any[], itemId: string, newRevisionId: string, newVersion: string) => {
    const update = (list: any[]): boolean => {
      for (let i = 0; i < list.length; i++) {
        if (list[i].id === itemId) {
          list[i] = { ...list[i], child_revision_id: newRevisionId, child_version: newVersion };
          return true;
        }
        const children = expandedBom[list[i].child_revision_id];
        if (children && update(children)) return true;
      }
      return false;
    };
    const newItems = [...items];
    update(newItems);
    return newItems;
  }, [expandedBom]);

  const doAction = async (action: () => Promise<any>, msg: string) => {
    try {
      await action();
      toast.success(msg);
      loadDetail();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '操作失败');
    }
  };

  const handleCascade = async (action: 'checkout' | 'checkin' | 'undo') => {
    if (!revisionId) return;
    try {
      let result: CascadeResult;
      if (action === 'checkout') result = await partsApi.cascadeCheckout(revisionId);
      else if (action === 'checkin') result = await partsApi.cascadeCheckin(revisionId);
      else result = await partsApi.cascadeUndocheckout(revisionId);
      toast.success(`成功: ${result.succeed_count}, 跳过: ${result.failed_count}`);
      // 即时刷新签出状态：保留已展开的 BOM 节点，重新拉取其子件最新状态
      const expandedIds = Object.keys(expandedBom);
      if (expandedIds.length) {
        const refreshed: Record<string, any[]> = {};
        await Promise.all(expandedIds.map(async (rid) => {
          try { refreshed[rid] = (await partsApi.getBOM(rid)) || []; }
          catch { refreshed[rid] = []; }
        }));
        setExpandedBom(refreshed);
      }
      loadDetail();
      loadTabs();  // 刷新 BOM 顶层子件签出状态
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '级联操作失败');
    }
  };

  const handleViewIteration = async (iterationId: string) => {
    if (!revisionId) return;
    try {
      const iter = await partsApi.getIteration(revisionId, iterationId);
      setViewingIterationId(iterationId);
      setViewingIteration(iter);
    } catch (e) { console.error(e); }
  };

  const handleClose = () => {
    setActiveTab('info');
    setViewingIterationId(null);
    setViewingIteration(null);
    const hasChanges = Object.keys(savedPatchRef.current).length > 0;
    onClose(hasChanges ? { ...savedPatchRef.current } : undefined);
    savedPatchRef.current = {};
  };

  const currentDisplay = viewingIteration || iteration;

  const tabs = useMemo(() => [
    { key: 'info' as const, label: '基本信息', show: !!currentDisplay },
    { key: 'bom' as const, label: 'BOM结构', show: hasBomChildren || canEdit },
    { key: 'docs' as const, label: '关联图文档', show: !!currentDisplay },
    { key: 'attachments' as const, label: '附件', show: true },
    { key: 'versions' as const, label: '版本历史', show: true },
    { key: 'iterations' as const, label: '迭代历史', show: true },
    { key: 'whereused' as const, label: '反查', show: true },
  ].filter(t => t.show), [currentDisplay, hasBomChildren, canEdit]);

  if (!open) return null;

  return (
    <Modal open={open} title="零部件详情" onClose={handleClose} width="3xl"
      headerAction={viewingIterationId ? (
        <span className="flex items-center gap-2 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded">
          正在查看 Iteration #{viewingIteration?.iteration} 的历史数据（只读）
          <button onClick={() => { setViewingIterationId(null); setViewingIteration(null); }}
            className="text-primary-600 hover:text-primary-800 hover:underline">返回当前迭代</button>
        </span>
      ) : (internalRevisionId && propRevisionId && internalRevisionId !== propRevisionId) ? (
        <span className="flex items-center gap-2 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 px-2 py-0.5 rounded">
          正在查看版本 {versions.find((v: any) => v.id === internalRevisionId)?.version || '?'}（只读）
          <button onClick={() => setInternalRevisionId(null)}
            className="text-primary-600 hover:text-primary-800 hover:underline">返回当前版本</button>
        </span>
      ) : undefined}
    >
      <div className="h-[60vh] flex flex-col">
        {detailLoading && !master ? (
          <Loading />
        ) : !master ? (
          <div className="text-gray-400 text-sm py-8 text-center">加载失败</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 shrink-0 mb-3">
              {canEdit ? (
                <>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-0.5">件号</div>
                    <input type="text" value={editMaster.code}
                      onChange={(e) => { setEditMaster(p => ({...p, code: e.target.value})); autoSaveMaster({code: e.target.value}); }}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono" />
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-0.5">名称</div>
                    <input type="text" value={editMaster.name}
                      onChange={(e) => { setEditMaster(p => ({...p, name: e.target.value})); autoSaveMaster({name: e.target.value}); }}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-0.5">类型</div>
                    <div className="text-sm text-gray-900 font-medium">{master?.type === 'assembly' ? '部件' : '零件'}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-0.5">件号</div>
                    <div className="text-sm text-gray-900 font-medium font-mono">{master?.code}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-0.5">名称</div>
                    <div className="text-sm text-gray-900 font-medium">{master?.name}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <div className="text-xs text-gray-500 mb-0.5">类型</div>
                    <div className="text-sm text-gray-900 font-medium">{master?.type === 'assembly' ? '部件' : '零件'}</div>
                  </div>
                </>
              )}
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-3 shrink-0 mb-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-sm">版本：{revision?.version}</span>
                  <span className={`px-2 py-1 text-xs rounded-full ${statusTag(revision?.status || 'draft').cls}`}>
                    {statusTag(revision?.status || 'draft').label}
                  </span>
                  {isCheckedOut && (
                    <span className="text-xs text-orange-600">已签出：{revision?.check_out_user_name}</span>
                  )}
                </div>
                <div className="flex gap-1 flex-wrap items-center">
                  {/* 3D 预览入口（操作按钮群左侧，"|" 分隔） */}
                  {isAssembly ? (
                    <>
                      <button onClick={() => window.open(`/stp-viewer?assembly=${revisionId}`, '_blank')}
                        className="px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">3D预览</button>
                    </>
                  ) : (
                    <button onClick={async () => {
                      if (!revisionId) return;
                      try {
                        const atts = await partsApi.listAttachments(revisionId, 'production');
                        const stp = (Array.isArray(atts) ? atts : []).find((a: any) => {
                          const n = (a.file_name || '').toLowerCase();
                          return n.endsWith('.stp') || n.endsWith('.step');
                        });
          if (stp) {
            const mt = await mediaApi.token(stp.id, 'gltf');
            window.open(`/stp-viewer?id=${stp.id}&token=${encodeURIComponent(mt)}&code=${encodeURIComponent(editMaster.code)}&version=${revision?.version || ''}&name=${encodeURIComponent(editMaster.name)}`, '_blank');
          } else {
            alert('该零件没有 STP/STEP 附件，请先上传');
          }
        } catch { alert('预览失败'); }
      }}
        className="px-3 py-1 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700">3D预览</button>
                  )}
                  {(canCheckout || canCheckin || canUndo || canFreeze || canUnfreeze || canRelease || canUpgrade || canObsolete || canForceCheckin) && (
                    <span className="mx-1 text-gray-300 self-center select-none">|</span>
                  )}
                  {canCheckout && (
                    <button onClick={() => doAction(() => partsApi.checkout(revisionId!), '签出成功')}
                      className="px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">签出/编辑</button>
                  )}
                  {canCheckin && (
                    <button onClick={() => setShowCheckinModal(true)}
                      className="px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">签入/解锁</button>
                  )}
                  {canUndo && (
                    <button onClick={() => doAction(() => partsApi.undocheckout(revisionId!), '已撤销')}
                      className="px-3 py-1 bg-gray-500 text-white rounded text-xs hover:bg-gray-600">撤销签出</button>
                  )}
                  {canFreeze && (
                    <button onClick={() => doAction(() => partsApi.freeze(revisionId!), '已冻结')}
                      className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">冻结</button>
                  )}
                  {canUnfreeze && (
                    <button onClick={() => doAction(() => partsApi.unfreeze(revisionId!), '已解冻')}
                      className="px-3 py-1 bg-orange-500 text-white rounded text-xs hover:bg-orange-600">解冻</button>
                  )}
                  {canRelease && (
                    <button onClick={() => doAction(() => partsApi.release(revisionId!), '已发布')}
                      className="px-3 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">发布</button>
                  )}
                  {canUpgrade && (
                    <button onClick={() => doAction(() => partsApi.upgrade(revisionId!), '已升版')}
                      className="px-3 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700">升版</button>
                  )}
                  {canObsolete && (
                    <button onClick={() => doAction(() => partsApi.obsolete(revisionId!), '已作废')}
                      className="px-3 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">作废</button>
                  )}
                  {canForceCheckin && (
                    <button onClick={() => doAction(() => partsApi.forceCheckin(revisionId!), '已强制签入')}
                      className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700">强制签入</button>
                  )}
                </div>
              </div>
            </div>


            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex-1 min-h-0 flex flex-col">
              <div className="flex border-b border-gray-200 shrink-0">
                {tabs.map((t: { key: string; label: string }) => (
                  <button key={t.key} onClick={() => setActiveTab(t.key as any)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === t.key
                        ? 'border-primary-600 text-primary-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="p-4 flex-1 min-h-0">
                {activeTab === 'info' && currentDisplay && (
                  <div className="space-y-4">
                    <div className="text-xs text-gray-500">
                      Iteration #{currentDisplay.iteration}
                      {currentDisplay.check_in_note && <span className="ml-2">签入说明：{currentDisplay.check_in_note}</span>}
                    </div>
                    {!viewingIterationId && canEdit ? (
                      <>
                        <div>
                          <h4 className="text-sm font-semibold mb-2">自定义字段</h4>
                          <div className="grid grid-cols-3 gap-3">
                            {cfDefs.length === 0 ? (
                              <div className="text-gray-400 text-sm col-span-3">无</div>
                            ) : (
                              cfDefs.map((def: any) => {
                                const val = cfEditValues[def.id] ?? '';
                                const handleChange = (newVal: string) => {
                                  const newVals = { ...cfEditValues, [def.id]: newVal };
                                  setCfEditValues(newVals);
                                  debouncedCfSave(newVals);
                                };
                                return (
                                  <div key={def.id} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                                    <div className="text-xs text-gray-500 mb-0.5">{def.name}</div>
                                    {def.field_type === 'select' ? (
                                      <select
                                        className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 mt-0.5 bg-white"
                                        value={val}
                                        onChange={(e) => handleChange(e.target.value)}
                                      >
                                        <option value="">—</option>
                                        {(def.options || []).map((opt: any) => {
                                          const label = typeof opt === 'string' ? opt : (opt.label || opt.value || opt);
                                          const value = typeof opt === 'string' ? opt : (opt.value || opt.label || opt);
                                          return <option key={value} value={value}>{label}</option>;
                                        })}
                                      </select>
                                    ) : def.field_type === 'number' ? (
                                      <input
                                        type="number"
                                        className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 mt-0.5"
                                        value={val}
                                        onChange={(e) => handleChange(e.target.value)}
                                      />
                                    ) : (
                                      <input
                                        type="text"
                                        className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 mt-0.5"
                                        value={val}
                                        onChange={(e) => handleChange(e.target.value)}
                                      />
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <h4 className="text-sm font-semibold mb-2">自定义字段</h4>
                          <div className="grid grid-cols-3 gap-3">
                            {cfDefs.length === 0 ? (
                              <div className="text-gray-400 text-sm col-span-3">无</div>
                            ) : (
                              cfDefs.map((def: any) => {
                                const val = cfEditValues[def.id];
                                return (
                                  <div key={def.id} className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                                    <div className="text-xs text-gray-500 mb-0.5">{def.name}</div>
                                    <div className="text-sm">{val !== undefined && val !== null ? String(val) : '—'}</div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {activeTab === 'bom' && (
                  <div className="flex flex-col min-h-0 h-full">
                    <div className="flex items-center justify-between mb-3 shrink-0">
                      <h4 className="text-sm font-bold text-gray-700">子项清单</h4>
                      <div className="flex gap-2">
                        {canEdit && !viewingIterationId && (
                          <button onClick={() => setBomPickerOpen(true)}
                            className="px-3 py-1.5 bg-green-600 text-white rounded text-xs hover:bg-green-700">
                            + 添加子项
                          </button>
                        )}
                        {!viewingIterationId && (<>
                        <button onClick={() => handleCascade('checkout')}
                          className="px-3 py-1.5 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">级联签出/编辑</button>
                        <button onClick={() => handleCascade('checkin')}
                          className="px-3 py-1.5 bg-primary-600 text-white rounded text-xs hover:bg-primary-700">级联签入/解锁</button>
                        <button onClick={() => handleCascade('undo')}
                          className="px-3 py-1.5 bg-gray-500 text-white rounded text-xs hover:bg-gray-600">级联撤销</button>
                        </>)}
                      </div>
                    </div>
                    {bomItems.length === 0 ? (
                      <div className="text-gray-400 text-sm py-4 text-center">暂无子项</div>
                    ) : (
                      <div className="border rounded-lg overflow-hidden flex-1 min-h-0">
                        <div className="overflow-y-auto h-full" ref={bomScrollRef}>
                        <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b sticky top-0 z-10">
                            <th onClick={() => handleSort('child_code')} className="px-3 py-2 text-left text-gray-500 font-medium cursor-pointer select-none whitespace-nowrap hover:text-gray-700" style={{ paddingLeft: 28 }}>件号 {getSortIcon('child_code')}</th>
                            <th onClick={() => handleSort('child_name')} className="px-3 py-2 text-left text-gray-500 font-medium cursor-pointer select-none whitespace-nowrap hover:text-gray-700">中文名称 {getSortIcon('child_name')}</th>
                            <th onClick={() => handleSort('child_version')} className="px-3 py-2 text-left text-gray-500 font-medium w-16 cursor-pointer select-none whitespace-nowrap hover:text-gray-700">版本 {getSortIcon('child_version')}</th>
                            <th onClick={() => handleSort('child_status')} className="px-3 py-2 text-left text-gray-500 font-medium w-20 cursor-pointer select-none whitespace-nowrap hover:text-gray-700">状态 {getSortIcon('child_status')}</th>
                            <th onClick={() => handleSort('child_check_out_user_name')} className="px-3 py-2 text-left text-gray-500 font-medium w-20 cursor-pointer select-none whitespace-nowrap hover:text-gray-700">签出状态 {getSortIcon('child_check_out_user_name')}</th>
                             <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">用量</th>
                             <th className="px-3 py-2 text-center text-gray-500 font-medium w-12 whitespace-nowrap">矩阵</th>
                             <th className="px-3 py-2 text-center text-gray-500 font-medium w-20">预览</th>
                             {canEdit && (
                              <th className="px-3 py-2 text-right text-gray-500 font-medium w-36">操作</th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {sortedBomItems.map((item: any) => renderBomRow(item, 0, revisionId))}
                        </tbody>
                      </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'whereused' && revisionId && (
                  <PartWhereUsedTab
                    revisionId={revisionId}
                    masterId={masterId}
                    code={master?.code || ''}
                    name={master?.name || ''}
                    version={revision?.version}
                    status={revision?.status}
                    onOpenPart={(mid, rid) => { setNestedMasterId(mid); setNestedRevisionId(rid || null); }}
                    onOpenConfig={(cirId) => setWuConfigRevId(cirId)}
                    onOpenTask={(projectId, task) => setWuTask({ projectId, task })}
                    onOpenProfile={(pid) => setWuProfileId(pid)}
                  />
                )}

                {activeTab === 'docs' && revisionId && (
                    <EntityDocumentSection
                      entityType="part"
                      entityId={revisionId}
                      editable={isCheckedOutByMe && isDraft && !viewingIterationId}
                      entityCode={master?.code}
                      entityName={master?.name}
                    />
                )}

                {activeTab === 'attachments' && revisionId && (
                  <div className="space-y-4">
                    <PartAttachmentBucket key="cad" revisionId={revisionId} iterationId={viewingIterationId || iteration?.id} category="cad" label="CAD 附件" editable={isCheckedOutByMe && isDraft && !viewingIterationId} showDownloadAll={hasBomChildren} />
                    <PartAttachmentBucket key="prod" revisionId={revisionId} iterationId={viewingIterationId || iteration?.id} category="production" label="生产附件" editable={isCheckedOutByMe && isDraft && !viewingIterationId} showDownloadAll={hasBomChildren} />
                  </div>
                )}

                {activeTab === 'versions' && (
                  <>
                    <p className="text-sm text-gray-500 px-4 py-2 border-b border-gray-100">
                      勾选两个版本进行 BOM 对比（当前版本默认已选）
                    </p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="px-4 py-3 w-10"></th>
                          <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">版本</th>
                          <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">状态</th>
                          <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">创建时间</th>
                          <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {versions.map((v: any) => (
                          <tr key={v.id} className={`hover:bg-gray-50 ${v.id === revision?.id ? 'bg-blue-50' : ''}`}>
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                checked={cmpSel.includes(v.id)}
                                onChange={() => toggleCmpSel(v.id)}
                                className="w-4 h-4 accent-primary-600"
                                title="勾选参与 BOM 对比"
                              />
                            </td>
                            <td className="px-4 py-3">{v.version}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-1 text-xs rounded-full ${statusTag(v.status as PartStatus).cls}`}>
                                {statusTag(v.status as PartStatus).label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-500">{v.created_at ? new Date(v.created_at).toLocaleDateString('zh-CN') : ''}</td>
                            <td className="px-4 py-3">
                              {v.id === revision?.id ? (
                                <span className="text-primary-600 text-xs">当前</span>
                              ) : (
                                <button onClick={() => setInternalRevisionId(v.id)} className="text-primary-600 hover:text-primary-800 hover:underline text-xs">切换</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {cmpSel.length > 0 && (
                      <div className="mt-3 px-4 py-2.5 bg-gray-50 border-t border-gray-200 flex items-center gap-3">
                        <span className="text-sm text-gray-600 flex-1">
                          {cmpSel.length === 2
                            ? `已选：版本 ${versions.find((x) => x.id === cmpSel[0])?.version ?? '?'} vs 版本 ${versions.find((x) => x.id === cmpSel[1])?.version ?? '?'}`
                            : '请再选择一个版本'}
                        </span>
                        <button
                          onClick={openCompare}
                          disabled={cmpSel.length !== 2}
                          className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm disabled:opacity-40 hover:bg-primary-700"
                        >
                          BOM 对比
                        </button>
                      </div>
                    )}
                  </>
                )}

                {activeTab === 'iterations' && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">迭代</th>
                        <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">签入时间</th>
                        <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">签入说明</th>
                        <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">创建人</th>
                        <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {iterationsList.map((it: any) => (
                        <tr key={it.id} className={`hover:bg-gray-50 ${it.id === iteration?.id ? 'bg-blue-50' : ''}`}>
                          <td className="px-4 py-3">#{it.iteration}</td>
                          <td className="px-4 py-3 text-gray-500">{it.check_in_date ? new Date(it.check_in_date).toLocaleString('zh-CN') : '未签入'}</td>
                          <td className="px-4 py-3">{it.check_in_note || '—'}</td>
                          <td className="px-4 py-3 text-gray-500">{it.creator_name || '—'}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {it.id === iteration?.id ? (
                                <span className="text-primary-600 text-xs">当前</span>
                              ) : (
                                <button onClick={() => handleViewIteration(it.id)} className="text-primary-600 hover:text-primary-800 hover:underline text-xs">查看数据</button>
                              )}
                              {it.iteration > 1 && isAdminUser && (
                                <button
                                  onClick={async () => {
                                    if (!revisionId || !confirm(`确定删除迭代 #${it.iteration}？该迭代的附件也将被删除。`)) return;
                                    try {
                                      await partsApi.deleteIteration(revisionId, it.id);
                                      toast.success('迭代已删除');
                                      setIterationsList(await partsApi.iterations(revisionId));
                                    } catch (e: any) {
                                      toast.error(e?.response?.data?.detail || '删除失败');
                                    }
                                  }}
                                  className="text-xs text-red-600 hover:text-red-800 hover:underline"
                                >
                                  删除
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {showCheckinModal && (
        <Modal open={showCheckinModal} onClose={() => setShowCheckinModal(false)} title="签入说明" width="md">
          <div className="p-4">
            <textarea className="w-full border rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" rows={3} placeholder="请输入签入说明（选填）..."
              value={checkinNote} onChange={(e) => setCheckinNote(e.target.value)} />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCheckinModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">取消</button>
              <button onClick={async () => {
                setSaving(true);
                await doAction(() => partsApi.checkin(revisionId!, checkinNote || undefined), '签入成功');
                setSaving(false);
                setShowCheckinModal(false);
                setCheckinNote('');
              }} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50" disabled={saving}>
                {saving ? '保存中...' : '确认签入'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      <AssemblyPartPicker
        open={bomPickerOpen}
        onClose={() => setBomPickerOpen(false)}
        onConfirm={async (items) => {
          if (!revisionId) return;
          let failed = 0;
          for (const item of items) {
            try {
              await partsApi.addBOMItem(revisionId, { child_revision_id: item.child_id, quantity: item.quantity || 1 }, iteration?.id);
            } catch (e: any) {
              failed++;
              console.error(e);
              toast.error(e?.response?.data?.detail || '添加子项失败');
            }
          }
          setBomPickerOpen(false);
          refreshChildren(revisionId);
          if (failed === 0) toast.success(`已添加 ${items.length} 个子项`);
        }}
        currentAssemblyId={revisionId}
      />
      {versionSelectItem && (
        <Modal open={!!versionSelectItem} onClose={() => setVersionSelectItem(null)} title={`选择版本 - ${versionSelectItem.child_code}`} width="md">
          <div className="p-4 max-h-60 overflow-y-auto">
            {versionSelectLoading ? (
              <div className="text-gray-400 text-sm py-4 text-center">加载中...</div>
            ) : versionSelectRevisions.length === 0 ? (
              <div className="text-gray-400 text-sm py-4 text-center">无可用版本</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">版本</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">状态</th>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">创建时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {versionSelectRevisions.map((v: any) => (
                    <tr key={v.id} className={`hover:bg-gray-50 cursor-pointer ${v.id === versionSelectItem.child_revision_id ? 'bg-blue-50' : ''}`}
                      onClick={async () => {
                        if (v.id === versionSelectItem.child_revision_id) { setVersionSelectItem(null); return; }
                        if (!revisionId) return;
                        try {
                          await partsApi.updateBOMItem(revisionId, versionSelectItem.id, { child_revision_id: v.id });
                          toast.success('版本已更新');
                          setBomItems(updateBomItemVersion(bomItems, versionSelectItem.id, v.id, v.version));
                        } catch (e: any) { toast.error(e?.response?.data?.detail || '更新失败'); }
                        setVersionSelectItem(null);
                      }}>
                      <td className="px-3 py-2 font-medium">{v.version}</td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 text-xs rounded ${statusTag(v.status || 'draft').cls}`}>
                          {statusTag(v.status || 'draft').label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-500">{v.created_at ? new Date(v.created_at).toLocaleDateString('zh-CN') : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Modal>
      )}
      {nestedPickerRevId && (
        <AssemblyPartPicker
          open={!!nestedPickerRevId}
          onClose={() => setNestedPickerRevId(null)}
          onConfirm={async (items) => {
            if (!nestedPickerRevId) return;
            for (const item of items) {
              try {
                await partsApi.addBOMItem(nestedPickerRevId, { child_revision_id: item.child_id, quantity: item.quantity || 1 });
              } catch (e: any) { console.error(e); }
            }
            setNestedPickerRevId(null);
            refreshChildren(nestedPickerRevId);
          }}
          currentAssemblyId={nestedPickerRevId}
        />
      )}
      {nestedMasterId && (
        <PartDetailModal
          masterId={nestedMasterId}
          revisionId={nestedRevisionId || undefined}
          open={!!nestedMasterId}
          onClose={() => { setNestedMasterId(null); setNestedRevisionId(null); }}
        />
      )}
      {/* ===== 变换矩阵详情弹窗 ===== */}
      {matrixPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setMatrixPopup(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[70vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 bg-white">
              <span className="font-semibold text-sm">{matrixPopup.child_code} 变换矩阵</span>
              <button onClick={() => setMatrixPopup(null)} className="text-gray-500 hover:text-gray-700 text-lg">&times;</button>
            </div>
            <div className="p-4 space-y-3">
              {(matrixPopup.cad_instances || []).map((inst: any, idx: number) => (
                <div key={idx} className="border rounded-lg p-3 bg-gray-50">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="px-1.5 py-0.5 text-xs rounded bg-indigo-100 text-indigo-700">
                      {inst.source === 'step' ? 'STEP' : inst.source || '—'}
                    </span>
                    <span className="text-xs text-gray-500">实例 {idx + 1}</span>
                    {inst.label && <span className="text-xs text-gray-600">"{inst.label}"</span>}
                  </div>
                  <div className="grid grid-cols-4 gap-x-3 gap-y-1 font-mono text-xs">
                    {(inst.matrix || []).map((v: number, i: number) => (
                      <div key={i} className="text-right">
                        <span className={i % 4 === 3 ? 'text-indigo-600' : 'text-gray-600'}>
                          {Number(v).toFixed(3).replace(/\.?0+$/, '')}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    平移 (x,y,z): {[3,7,11].map(i => Number((inst.matrix || [])[i] || 0).toFixed(3).replace(/\.?0+$/, '')).join(', ')}m
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {wuConfigRevId && (
        <ConfigItemDetailModal open={!!wuConfigRevId} revisionId={wuConfigRevId}
          onClose={() => setWuConfigRevId(null)} />
      )}
      {wuTask && (
        <TaskEditModal open={!!wuTask} projectId={wuTask.projectId} task={wuTask.task} parentId={null}
          onClose={() => setWuTask(null)} onSaved={() => {}} onRefresh={() => {}} />
      )}
      {wuProfileId && (
        <ProfileEditModal open={!!wuProfileId} profileId={wuProfileId} readOnly
          onClose={() => setWuProfileId(null)} onSaved={() => {}} />
      )}
      {showCompare && (
        <PartCompareModal
          open={showCompare}
          onClose={() => setShowCompare(false)}
          initialLeftId={cmpSel[0]}
          initialRightId={cmpSel[1]}
          initialLeftItem={toPartListItem(cmpSel[0])}
          initialRightItem={toPartListItem(cmpSel[1])}
        />
      )}
    </Modal>
  );
}

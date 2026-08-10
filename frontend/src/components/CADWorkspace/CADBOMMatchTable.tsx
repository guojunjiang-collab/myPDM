import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from '../Toast';
import { partsApi, customFieldsApi } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { useCADBridge } from '../../hooks/useCADBridge';
import { syncRowsByPartNumber } from './syncRows';
import { flattenTree } from './flattenTree';
import { maxLevelOf, buildCollapsedForLevel } from './expandLevel';
import PartDetailModal from '../PartDetailModal';

/** BOM 结构树的展开箭头，与零部件详情子项清单保持同一风格 */
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

export interface NamingPrefixes {
  pdfPartPrefix: string;
  pdfAssemblyPrefix: string;
  stpPrefix: string;
}

export interface BOMRow {
  instance_name: string;
  part_number: string;
  path: string;
  level: number;
  is_assembly: boolean;
  quantity: number;
  /** 该行合并的全部 CATIA 实例（变换矩阵相对父装配，平移单位 mm） */
  instances: { matrix: number[] | null; label: string }[];
  /** CATIA 源文档完整路径（.CATPart/.CATProduct，未保存时为空） */
  doc_path: string;
  builtin: Record<string, string>;
  user_properties: Record<string, string>;
  pdm_match: {
    master_id?: string;
    revision_id?: string;
    code?: string;
    version?: string;
    name?: string;
    latest_version?: string;
  } | null;
  match_status: 'matched' | 'new' | 'conflict' | 'unknown';
  checkout_status: 'not_checked_out' | 'checked_out' | 'other_checked_out' | null;
}

interface Props {
  bridge: ReturnType<typeof useCADBridge>;
  rows: BOMRow[];
  onComplete: (count: number) => void;
  namingPrefixes: NamingPrefixes;
}

// CATIA 内置属性不作为用户属性列显示（内置属性有独立列，避免双重显示）
const BUILTIN_KEYS = new Set(['PartNumber', 'Revision', 'Definition', 'Nomenclature', 'DescriptionRef']);

function getPropertyColumns(userProps: Record<string, string>): string[] {
  return Object.keys(userProps).filter(k => !BUILTIN_KEYS.has(k));
}

// 内置属性列：按 PDM 目标字段(target)定义，实际 CAD 属性名由当前生效的字段映射
// (fieldMapping.builtin)反查——CATIA 为 Nomenclature/Revision，SolidWorks 为 中文名称/Revision。
// 不能硬编码 CAD 属性名：SW 下拉取写回写入映射属性(中文名称)，若显示列读硬编码属性
// (Nomenclature)会与写回目标不一致，导致拉取后左侧列不刷新。
// 件号（PartNumber）只读不在此列表；属性存于零件文档，编辑后按同 PartNumber 实例同步。
const BUILTIN_COLUMNS: { label: string; target: 'name' | 'version'; fallbackAttr: string }[] = [
  { label: '版本', target: 'version', fallbackAttr: 'Revision' },
  { label: '术语/中文名称', target: 'name', fallbackAttr: 'Nomenclature' },
];

// CATIA-PDM 字段映射（单一事实源为桥接端 cad_bridge/catia/field_mapping.json，
// 通过 mapping.get 获取；桥接服务为旧版本无该方法时回退此默认映射）
interface FieldMapping {
  builtin: Record<string, string>;
  properties: Record<string, string>;
}
const DEFAULT_FIELD_MAPPING: FieldMapping = {
  builtin: { PartNumber: 'code', Revision: 'version', Nomenclature: 'name' },
  properties: { 规格型号: 'spec' },
};

export function CADBOMMatchTable({ bridge, rows: initialRows, onComplete, namingPrefixes }: Props) {
  const [rows, setRows] = useState<BOMRow[]>(initialRows);
  const user = useAuthStore((s) => s.user);
  const mappingRef = useRef<FieldMapping | null>(null);
  const fieldDefsRef = useRef<any[] | null>(null);
  const [fieldDefs, setFieldDefs] = useState<any[]>([]);
  const [fieldMapping, setFieldMapping] = useState<FieldMapping>(DEFAULT_FIELD_MAPPING);
  const leftBodyRef = useRef<HTMLTableSectionElement>(null);
  const pushingKeys = useRef<Set<string>>(new Set());
  const rightBodyRef = useRef<HTMLTableSectionElement>(null);
  const rightHeadRef = useRef<HTMLDivElement>(null);
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const isSyncingScroll = useRef(false);

  // 加载 PDM 自定义字段定义（筛选适用于零部件的）与 CATIA-PDM 字段映射
  useEffect(() => {
    customFieldsApi.listDefinitions().then(res => {
      const defs = (res.data || []).filter((d: any) => {
        const applies = d.applies_to || [];
        return applies.includes('component') || applies.includes('part') || applies.includes('assembly');
      });
      setFieldDefs(defs);
      fieldDefsRef.current = defs;
    }).catch(() => {});
    bridge.getFieldMapping().then(m => {
      setFieldMapping(m);
      mappingRef.current = m;
    }).catch(() => {});
  }, []);

  // CATIA 属性名 → PDM 字段名反向查找
  const getCatiaPropForPdmField = useCallback((pdmFieldName: string): string | undefined => {
    return Object.entries(fieldMapping.properties || {}).find(([, t]) => t === pdmFieldName)?.[0];
  }, [fieldMapping]);

  // 内置字段 PDM 目标(name/version) → 当前 CAD 属性名反查（无映射时回退英文默认）
  const builtinAttrOf = useCallback((target: 'name' | 'version', fallbackAttr: string): string => {
    return Object.entries(fieldMapping.builtin || {}).find(([, t]) => t === target)?.[0] || fallbackAttr;
  }, [fieldMapping]);

  // propertyColumns 来自 PDM 自定义字段定义；加载中回退到 CATIA 用户属性
  const pdmPropertyColumns = fieldDefs.map((d: any) => d.name);
  const catiaPropertyColumns = rows.length > 0 ? getPropertyColumns(rows[0].user_properties) : [];
  const propertyColumns = pdmPropertyColumns.length > 0 ? pdmPropertyColumns : catiaPropertyColumns;

  const totalMatched = rows.filter(r => r.match_status === 'matched').length;
  const totalNew = rows.filter(r => r.match_status === 'new').length;
  const totalConflict = rows.filter(r => r.match_status === 'conflict').length;
  const totalCheckedOut = rows.filter(r => r.checkout_status === 'checked_out').length;

  const isCheckedOutByMe = (row: BOMRow) => row.checkout_status === 'checked_out';
  const isCheckedOutByOther = (row: BOMRow) => row.checkout_status === 'other_checked_out';
  const canEditProps = (row: BOMRow) => !isCheckedOutByOther(row);

  const hoverClass = (row: BOMRow) => {
    if (row.match_status === 'new') return 'bg-yellow-100';
    if (row.checkout_status === 'checked_out') return 'bg-blue-100';
    return 'bg-gray-100';
  };
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // 折叠状态
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  // 工具栏「展开层级」下拉的受控值:'collapsed' | 'all' | 数字字符串 | 'custom'
  const [expandSel, setExpandSel] = useState<string>('all');
  const toggleCollapse = (path: string) => {
    setCollapsedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
    // 手动增删偏离批量层级 → 下拉显示"自定义"
    setExpandSel('custom');
  };
  const maxLevel = maxLevelOf(rows);
  const applyExpandSel = (value: string) => {
    setExpandSel(value);
    if (value === 'custom') return;
    const k = value === 'all' ? Infinity : value === 'collapsed' ? 0 : Number(value);
    setCollapsedPaths(buildCollapsedForLevel(rows, k));
  };
  const visibleRows = rows.filter(row => {
    if (row.level === 0) return true;
    const parts = row.path.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      if (collapsedPaths.has(parts.slice(0, i + 1).join('.'))) return false;
    }
    return true;
  });
  const hasChildren = (row: BOMRow) => {
    const idx = rows.indexOf(row);
    return idx >= 0 && idx < rows.length - 1 && rows[idx + 1].level > row.level;
  };

  // 同步右侧行高到左侧
  useEffect(() => {
    const sync = () => {
      const lr = leftBodyRef.current?.querySelectorAll('tr');
      const rr = rightBodyRef.current?.querySelectorAll('tr');
      if (!lr || !rr || lr.length !== rr.length) return;
      lr.forEach((l, i) => {
        const h = l.getBoundingClientRect().height;
        const rt = rr[i] as HTMLElement;
        // 仅在高度确有差异时写入，避免 ResizeObserver 反复触发导致行高不断累加
        if (h > 0 && Math.abs(rt.getBoundingClientRect().height - h) > 0.5) {
          rt.style.height = `${h}px`;
        }
      });
    };
    requestAnimationFrame(() => requestAnimationFrame(sync));
    const obs = new ResizeObserver(() => requestAnimationFrame(() => requestAnimationFrame(sync)));
    if (leftBodyRef.current) obs.observe(leftBodyRef.current);
    return () => obs.disconnect();
  }, [visibleRows, propertyColumns.length]);

  // 左右两侧垂直滚动同步，防止水平滚动条被垂直滚动条推到底部不可见
  const handleLeftScroll = useCallback(() => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (leftScrollRef.current && rightScrollRef.current) {
      rightScrollRef.current.scrollTop = leftScrollRef.current.scrollTop;
    }
    requestAnimationFrame(() => { isSyncingScroll.current = false; });
  }, []);

  const handleRightScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (rightScrollRef.current && leftScrollRef.current) {
      leftScrollRef.current.scrollTop = rightScrollRef.current.scrollTop;
    }
    if (rightHeadRef.current) {
      rightHeadRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
    requestAnimationFrame(() => { isSyncingScroll.current = false; });
  }, []);

  // 行内编辑写回 CAD：防抖处理。
  // 单元格值由 onChange 的乐观 setRows 立即更新（唯一显示事实源）；写回 CAD 用
  // 防抖，避免每敲一键就发一次 COM 写入——SolidWorks 写入含重建/保存(轻量化件还要
  // 打开-保存-关闭)，逐键调用很慢，且慢写入回调携带旧值二次 setRows 会把输入框
  // 回退成旧值造成闪烁。这里不在写回后再 setRows，从根上消除闪烁。
  const writeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingWrites = useRef<Record<string, { path: string; key: string; value: string }>>({});
  const flushWrite = useCallback(async (id: string) => {
    const timer = writeTimers.current[id];
    if (timer) { clearTimeout(timer); delete writeTimers.current[id]; }
    const p = pendingWrites.current[id];
    if (!p) return;
    delete pendingWrites.current[id];
    try {
      await bridge.writeProperty(p.path, p.key, p.value);
    } catch (e: any) {
      toast.error(e.message || '写入 CAD 失败');
    }
  }, [bridge]);
  const scheduleWrite = useCallback((path: string, key: string, value: string) => {
    const id = `${path}|${key}`;
    pendingWrites.current[id] = { path, key, value };
    if (writeTimers.current[id]) clearTimeout(writeTimers.current[id]);
    writeTimers.current[id] = setTimeout(() => { void flushWrite(id); }, 400);
  }, [flushWrite]);
  // 卸载/关闭工作台时冲刷未落盘的编辑，避免丢失最后一次输入
  useEffect(() => () => {
    Object.keys(pendingWrites.current).forEach(id => { void flushWrite(id); });
  }, [flushWrite]);

  // 提交一次编辑：乐观更新表格 + 防抖写回 CAD
  const commitEdit = useCallback((row: BOMRow, key: string, value: string, target: 'user' | 'builtin' = 'user') => {
    setRows(prev => syncRowsByPartNumber(prev, row, key, value, target));
    scheduleWrite(row.path, key, value);
  }, [scheduleWrite]);

  const [matching, setMatching] = useState(false);
  // 各版本附件计数（cad/production），显示在附件列按钮上方
  const [attCounts, setAttCounts] = useState<Record<string, { cad: number; production: number }>>({});
  // 已匹配版本的 PDM 自定义字段值（revision_id → field_id → value）；
  // 当 CAD 该字段为空时，右侧自定义字段列回退显示 PDM 已有值（绿色）
  const [pdmCfValues, setPdmCfValues] = useState<Record<string, Record<string, any>>>({});

  const refreshAttCount = useCallback(async (revisionId?: string) => {
    if (!revisionId) return;
    try {
      const atts = await partsApi.listAttachments(revisionId);
      const cad = (atts || []).filter((a: any) => a.category === 'cad').length;
      const production = (atts || []).filter((a: any) => a.category === 'production').length;
      setAttCounts(prev => ({ ...prev, [revisionId]: { cad, production } }));
    } catch {
      // 计数失败不影响主流程
    }
  }, []);
  // PDM匹配列点击后弹出的零部件详情
  const [detailPart, setDetailPart] = useState<{ masterId: string; revisionId?: string } | null>(null);

  // 件号+版本 组成去重键；版本 trim 后不区分大小写，与后端匹配规则一致
  const matchKeyOf = (r: BOMRow) =>
    `${(r.part_number || '').trim()}|${(r.builtin.Revision || '').trim().toUpperCase()}`;

  const runPdmMatch = useCallback(async (targetRows: BOMRow[]) => {
    const uniq = new Map<string, { code: string; version?: string }>();
    for (const r of targetRows) {
      const code = (r.part_number || '').trim();
      if (!code) continue;
      const k = matchKeyOf(r);
      if (!uniq.has(k)) uniq.set(k, { code, version: (r.builtin.Revision || '').trim() || undefined });
    }
    if (uniq.size === 0) return;
    setMatching(true);
    try {
      const data = await partsApi.cadBomMatch([...uniq.values()]);
      const resultMap = new Map<string, any>();
      for (const res of data.results || []) {
        resultMap.set(`${res.code}|${(res.version || '').toUpperCase()}`, res);
      }
      setRows(prev => prev.map(r => {
        const res = resultMap.get(matchKeyOf(r));
        if (!res) return r;
        if (res.match_status === 'matched') {
          return {
            ...r,
            match_status: 'matched' as const,
            pdm_match: {
              master_id: res.master_id,
              revision_id: res.revision_id,
              code: res.code,
              version: res.matched_version,
              name: res.name,
            },
            checkout_status: res.checkout_status,
          };
        }
        if (res.match_status === 'conflict') {
          return {
            ...r,
            match_status: 'conflict' as const,
            pdm_match: { code: res.code, latest_version: res.latest_version },
            checkout_status: null,
          };
        }
        return { ...r, match_status: 'new' as const, pdm_match: null, checkout_status: null };
      }));
      // 匹配成功的版本刷新附件计数
      const matchedRevIds: string[] = [...new Set<string>(
        (data.results || [])
          .filter((res: any) => res.match_status === 'matched' && res.revision_id)
          .map((res: any) => res.revision_id as string)
      )];
      matchedRevIds.forEach(id => { refreshAttCount(id); });
      // 拉取已匹配版本的 PDM 自定义字段值，供右侧字段列对比/回退显示
      if (matchedRevIds.length > 0) {
        try {
          const cfRes = await customFieldsApi.getValuesBatch({ type: 'component', ids: matchedRevIds.join(',') });
          setPdmCfValues(prev => ({ ...prev, ...(cfRes.data || {}) }));
        } catch { /* 自定义字段值拉取失败不影响主流程 */ }
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'PDM 匹配失败');
    } finally {
      setMatching(false);
    }
  }, [refreshAttCount]);

  // 进入匹配步骤时自动执行一次 PDM 匹配
  useEffect(() => {
    runPdmMatch(initialRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 重新匹配：先重新读取 CATIA 装配树刷新全部行数据，再执行 PDM 匹配
  const handleRefreshAndMatch = async () => {
    setMatching(true);
    try {
      const tree = await bridge.readAssemblyTree();
      if (!tree) {
        toast.error('读取装配结构失败');
        return;
      }
      const newRows = flattenTree(tree);
      setRows(newRows);
      // 重新读取装配树后重置折叠状态,与全新展开一致
      setCollapsedPaths(new Set());
      setExpandSel('all');
      await runPdmMatch(newRows);
    } catch (e: any) {
      toast.error(e.message || '读取装配结构失败');
    } finally {
      setMatching(false);
    }
  };

  const handleCheckout = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    try {
      await partsApi.checkout(row.pdm_match.revision_id);
      setRows(prev => prev.map(r =>
        r.path === row.path ? { ...r, checkout_status: 'checked_out' } : r
      ));
      toast.success('签出成功');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '签出失败');
    }
  };

  const handleCheckin = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    try {
      await partsApi.checkin(row.pdm_match.revision_id);
      setRows(prev => prev.map(r =>
        r.path === row.path ? { ...r, checkout_status: 'not_checked_out' } : r
      ));
      toast.success('签入成功');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '签入失败');
    }
  };

  const handleUndoCheckout = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    try {
      await partsApi.undocheckout(row.pdm_match.revision_id);
      setRows(prev => prev.map(r =>
        r.path === row.path ? { ...r, checkout_status: 'not_checked_out' } : r
      ));
      toast.success('已撤销签出');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '撤销签出失败');
    }
  };

  // 推送/拉取后刷新对比基准：重新读取该版本的 PDM 自定义字段值与名称，
  // 使右侧字段列与内置名称列的绿/红色状态按最新 PDM 数据重算（此时应与 CAD 一致→常态色）
  const refreshPdmCompare = useCallback(async (row: BOMRow) => {
    const revId = row.pdm_match?.revision_id;
    const masterId = row.pdm_match?.master_id;
    if (!revId) return;
    try {
      const cfRes = await customFieldsApi.getValuesBatch({ type: 'component', ids: revId });
      setPdmCfValues(prev => ({ ...prev, ...(cfRes.data || {}) }));
    } catch { /* 忽略 */ }
    if (masterId) {
      try {
        const master = await partsApi.get(masterId);
        if (master) {
          setRows(prev => prev.map(r => r.pdm_match?.revision_id === revId
            ? { ...r, pdm_match: { ...r.pdm_match!, name: master.name ?? r.pdm_match!.name } }
            : r));
        }
      } catch { /* 忽略 */ }
    }
  }, []);

  const handlePushToPDM = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    const key = row.path;
    if (pushingKeys.current.has(key)) return;
    pushingKeys.current.add(key);
    try {
      // 获取字段映射（每次打开工作台缓存一份）
      if (!mappingRef.current) {
        try {
          mappingRef.current = await bridge.getFieldMapping();
        } catch {
          mappingRef.current = DEFAULT_FIELD_MAPPING;
        }
      }
      const mapping = mappingRef.current!;

      // 1) PDM 固定字段（code / name / spec）：CATIA 值为空时不传，避免清空 PDM 已有值
      const masterData: Record<string, string> = {};
      for (const [attr, target] of Object.entries(mapping.builtin || {})) {
        const val = row.builtin[attr];
        if (val && (target === 'code' || target === 'name')) masterData[target] = val;
      }
      for (const [prop, target] of Object.entries(mapping.properties || {})) {
        if (target === 'spec' && row.user_properties[prop]) masterData.spec = row.user_properties[prop];
      }
      if (Object.keys(masterData).length > 0) {
        await partsApi.update(row.pdm_match.master_id!, masterData);
      }

      // 2) PDM 自定义字段：映射目标名与字段定义显示名精确匹配，未定义的字段跳过
      const customTargets = Object.entries(mapping.properties || {}).filter(([, t]) => t !== 'spec');
      if (customTargets.length > 0) {
        if (!fieldDefsRef.current) {
          const res = await customFieldsApi.listDefinitions();
          fieldDefsRef.current = res.data || [];
        }
        const values: { field_id: string; value: string | number }[] = [];
        for (const [prop, target] of customTargets) {
          const raw = row.user_properties[prop];
          if (!raw) continue;
          const def = fieldDefsRef.current!.find((d: any) => d.name === target);
          if (!def) continue;
          if (def.field_type === 'number') {
            const num = parseFloat(raw);
            if (Number.isNaN(num)) continue;
            values.push({ field_id: def.id, value: num });
          } else {
            values.push({ field_id: def.id, value: raw });
          }
        }
        if (values.length > 0) {
          // 零部件自定义字段值挂在版本(revision)上，entity_type 与详情页一致用 component
          await customFieldsApi.setValues('component', row.pdm_match.revision_id, values);
        }
      }
      // 3) 部件：附带推送结构 BOM 直接子项（新子项自动创建零部件，含实例变换矩阵）
      if (row.is_assembly) {
        const nameAttr = Object.entries(mapping.builtin || {}).find(([, t]) => t === 'name')?.[0] || 'Nomenclature';
        const children = rows
          .filter(r =>
            r.level === row.level + 1 &&
            r.path.startsWith(row.path + '.') &&
            (r.part_number || '').trim() !== ''
          )
          .map(r => ({
            code: r.part_number.trim(),
            name: r.builtin[nameAttr] || r.instance_name || undefined,
            spec: r.user_properties['规格型号'] || undefined,
            quantity: r.quantity,
            instances: (r.instances || []).map(i => ({ matrix: i.matrix, label: i.label })),
          }));
        const bomRes = await partsApi.cadBomSync(row.pdm_match.revision_id, children);
        const parts: string[] = [];
        if (bomRes.created_parts?.length) parts.push(`新建零件 ${bomRes.created_parts.length} 个`);
        if (bomRes.created_items) parts.push(`新增子项 ${bomRes.created_items}`);
        if (bomRes.updated_items) parts.push(`更新子项 ${bomRes.updated_items}`);
        if (bomRes.extra_in_pdm?.length) {
          toast.info(`PDM 中存在 CATIA 没有的子项（已保留）: ${bomRes.extra_in_pdm.join(', ')}`);
        }
        toast.success(`属性已推送到 PDM${parts.length ? '；BOM ' + parts.join('，') : '；BOM 无变化'}`);
      } else {
        toast.success('属性已推送到 PDM');
      }
      // 推送后 PDM 已与 CAD 一致，刷新对比基准使字段颜色恢复常态
      await refreshPdmCompare(row);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '属性推送失败');
    } finally {
      pushingKeys.current.delete(key);
    }
  };

  // PDM → CAD：把 PDM 固定字段(名称/规格)与自定义字段值按映射拉回并覆盖 CAD 属性。
  // 件号(PartNumber)是匹配主键不覆盖；PDM 该字段为空则跳过（不清空 CAD 已有值）。
  const handlePullFromPDM = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id || !row.pdm_match?.master_id) return;
    try {
      if (!mappingRef.current) {
        try { mappingRef.current = await bridge.getFieldMapping(); }
        catch { mappingRef.current = DEFAULT_FIELD_MAPPING; }
      }
      const mapping = mappingRef.current!;
      if (!fieldDefsRef.current) {
        const res = await customFieldsApi.listDefinitions();
        fieldDefsRef.current = res.data || [];
      }
      const defs = fieldDefsRef.current!;

      // 待写入 CAD 的 (CAD属性名, 值, 是否内置属性)
      const writes: { prop: string; value: string; builtin: boolean }[] = [];

      // 1) 固定字段：master 提供 name/spec；version 用匹配结果
      const master = await partsApi.get(row.pdm_match.master_id);
      for (const [attr, target] of Object.entries(mapping.builtin || {})) {
        if (attr === 'PartNumber') continue; // 件号不覆盖
        let val = '';
        if (target === 'name') val = master?.name || '';
        else if (target === 'version') val = row.pdm_match.version || '';
        if (val) writes.push({ prop: attr, value: val, builtin: true });
      }
      const specProp = Object.entries(mapping.properties || {}).find(([, t]) => t === 'spec')?.[0];
      if (specProp && master?.spec) writes.push({ prop: specProp, value: master.spec, builtin: false });

      // 2) 自定义字段：getValues → field_id→value，按 PDM 字段名映射回 CAD 属性名
      const cfRes = await customFieldsApi.getValues('component', row.pdm_match.revision_id);
      const cfMap: Record<string, any> = {};
      (cfRes.data || []).forEach((v: any) => { cfMap[v.field_id] = v.value; });
      for (const [prop, target] of Object.entries(mapping.properties || {})) {
        if (target === 'spec') continue;
        const def = defs.find((d: any) => d.name === target);
        if (!def) continue;
        const raw = cfMap[def.id];
        if (raw == null || raw === '') continue;
        writes.push({ prop, value: Array.isArray(raw) ? raw.join(', ') : String(raw), builtin: false });
      }

      if (writes.length === 0) {
        toast.info('PDM 无可拉取的字段值');
        return;
      }
      for (const w of writes) {
        await bridge.writeProperty(row.path, w.prop, w.value);
        setRows(prev => syncRowsByPartNumber(prev, row, w.prop, w.value, w.builtin ? 'builtin' : 'user'));
      }
      // 拉取后 CAD 已与 PDM 一致，刷新对比基准使字段颜色恢复常态
      await refreshPdmCompare(row);
      toast.success(`已从 PDM 拉取并覆盖 ${writes.length} 个 CAD 属性`);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e.message || '属性拉取失败');
    }
  };

  const handleCreatePart = async (row: BOMRow) => {
    try {
      const data = {
        code: row.builtin.PartNumber || row.instance_name,
        // CATIA 术语(Nomenclature)对应 PDM 中文名称(name)
        name: row.builtin.Nomenclature || row.instance_name,
        spec: row.user_properties['规格型号'] || '',
        type: (row.is_assembly ? 'assembly' : 'part') as 'part' | 'assembly',
      };
      const result = await partsApi.create(data);
      const revisionId = result.latest_revision?.id;
      // 创建后自动签出（若后端已自动签出则忽略冲突）
      if (revisionId) {
        try { await partsApi.checkout(revisionId); } catch { /* 可能已自动签出 */ }
      }
      const partNumber = row.builtin.PartNumber;
      const pdmMatch = { master_id: result.id, revision_id: revisionId, code: result.code, version: 'A', name: result.name };
      setRows(prev => prev.map(r =>
        r.builtin.PartNumber === partNumber ? {
          ...r,
          match_status: 'matched' as const,
          pdm_match: pdmMatch,
          checkout_status: 'checked_out' as const,
        } : r
      ));
      toast.success(`已创建零部件: ${result.code}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '创建失败');
    }
  };

  const [uploadingCad, setUploadingCad] = useState<string | null>(null);

  const handleUploadCAD = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    // 直接通过桥接程序上传 CATIA 源文件（无需用户选择文件），同名附件覆盖
    if (!row.doc_path) {
      toast.error('未获取到 CATIA 源文件路径，请在 CATIA 中保存文档后重新读取装配结构');
      return;
    }
    setUploadingCad(row.path);
    try {
      const res = await bridge.uploadFile(row.doc_path, row.pdm_match.revision_id, 'cad', true, true);
      const uploaded: string[] = res?.uploaded || [row.doc_path.split('\\').pop() || ''];
      toast.success(`CAD 源文件已上传: ${uploaded.join('、')}`);
      refreshAttCount(row.pdm_match.revision_id);
    } catch (e: any) {
      toast.error(e.message || 'CAD 源文件上传失败');
    } finally {
      setUploadingCad(null);
    }
  };

  const [uploadingPdf, setUploadingPdf] = useState<string | null>(null);

  const handleUploadPDF = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    // 通过桥接程序将零部件工程图(CATDrawing)转 PDF 并上传到生产附件，同名覆盖
    setUploadingPdf(row.path);
    try {
      const prefix = row.is_assembly ? namingPrefixes.pdfAssemblyPrefix : namingPrefixes.pdfPartPrefix;
      const code = (row.part_number || 'drawing').trim();
      const ver = row.pdm_match?.version || '';
      const fileName = `${prefix}${code}_${ver}.pdf`;
      await bridge.exportPdfUpload(row.path, fileName, row.pdm_match.revision_id);
      toast.success(`工程图 PDF 已上传: ${fileName}`);
      refreshAttCount(row.pdm_match.revision_id);
    } catch (e: any) {
      toast.error(e.message || '工程图 PDF 导出上传失败');
    } finally {
      setUploadingPdf(null);
    }
  };

  const [uploadingStp, setUploadingStp] = useState<string | null>(null);

  const handleUploadSTP = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    // 通过桥接程序将 CATIA 零部件导出为 STP 并上传到生产附件，同名覆盖
    setUploadingStp(row.path);
    try {
      const prefix = namingPrefixes.stpPrefix;
      const code = (row.part_number || 'export').trim();
      const ver = row.pdm_match?.version || '';
      const fileName = `${prefix}${code}_${ver}.stp`;
      await bridge.exportStpUpload(row.path, fileName, row.pdm_match.revision_id);
      toast.success(`STP 已导出并上传: ${fileName}`);
      refreshAttCount(row.pdm_match.revision_id);
    } catch (e: any) {
      toast.error(e.message || 'STP 导出上传失败');
    } finally {
      setUploadingStp(null);
    }
  };

  const handleBatchPushToPDM = async () => {
    const checkedOutRows = rows.filter(r => r.checkout_status === 'checked_out' && r.match_status === 'matched');
    for (const row of checkedOutRows) {
      await handlePushToPDM(row);
    }
    toast.success(`已批量推送 ${checkedOutRows.length} 个零部件的属性`);
  };

  const handleBatchCheckin = async () => {
    const checkedOutRows = rows.filter(r => r.checkout_status === 'checked_out');
    for (const row of checkedOutRows) {
      await handleCheckin(row);
    }
    toast.success(`已批量签入 ${checkedOutRows.length} 个零部件`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* 汇总栏 */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200 flex-wrap shrink-0">
        <span className="bg-green-100 text-green-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">已匹配 {totalMatched}</span>
        <span className="bg-yellow-100 text-yellow-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">可新建 {totalNew}</span>
        <span className="bg-red-100 text-red-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">冲突 {totalConflict}</span>
        <span className="bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">已签出 {totalCheckedOut}</span>
        <label className="flex items-center gap-1 text-xs text-gray-600 ml-1">
          展开层级
          <select
            value={expandSel}
            disabled={maxLevel === 0}
            onChange={e => applyExpandSel(e.target.value)}
            className="border border-gray-300 rounded px-1.5 py-1 text-xs disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="collapsed">全部折叠</option>
            {Array.from({ length: Math.max(0, maxLevel - 1) }, (_, i) => i + 1).map(k => (
              <option key={k} value={String(k)}>L{k}</option>
            ))}
            <option value="all">全部展开</option>
            {expandSel === 'custom' && <option value="custom">自定义</option>}
          </select>
        </label>
        <div className="flex-1" />
        <button
          onClick={handleRefreshAndMatch}
          disabled={matching}
          title="重新读取 CATIA 装配结构并重新匹配 PDM"
          className="px-3 py-1.5 bg-sky-500 text-white rounded text-xs hover:bg-sky-600 disabled:bg-gray-300"
        >
          {matching ? '匹配中...' : '重新匹配'}
        </button>
        <button onClick={handleBatchPushToPDM} className="px-3 py-1.5 bg-amber-500 text-white rounded text-xs hover:bg-amber-600">批量属性→PDM</button>
        <button onClick={handleBatchCheckin} className="px-3 py-1.5 bg-emerald-500 text-white rounded text-xs hover:bg-emerald-600">全部签入</button>
      </div>

      {/* 表格：左侧固定列 + 右侧自定义字段独立水平滚动 */}
      <div className="flex-1 min-h-0 flex">
        <div ref={leftScrollRef} className="shrink-0 overflow-y-auto overflow-x-hidden" onScroll={handleLeftScroll}>
          {/* ====== 左表：固定列 ====== */}
          <table className="border-collapse text-xs whitespace-nowrap">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 shadow-[0_2px_0_0_#e5e7eb]">
                  <th className="p-2 text-left" style={{ width: 180, paddingLeft: 28 }}>件号</th>
                  <th className="p-2 text-center" style={{ width: 40 }}>用量</th>
                  {BUILTIN_COLUMNS.map(col => (
                    <th key={col.target} className="p-2 text-left" style={{ width: col.target === 'version' ? 56 : 100 }}>{col.label}</th>
                  ))}
                  <th className="p-2 text-center" style={{ width: 90 }}>CAD附件</th>
                  <th className="p-2 text-center" style={{ width: 100 }}>生产附件</th>
                  <th className="p-2 text-left" style={{ width: 130 }}>PDM匹配</th>
                  <th className="p-2 text-left" style={{ width: 76 }}>匹配状态</th>
                  <th className="p-2 text-left" style={{ width: 76 }}>签出状态</th>
                  <th className="p-2 text-center" style={{ width: 160 }}>操作</th>
                </tr>
              </thead>
              <tbody ref={leftBodyRef}>
                {visibleRows.map((row, vi) => {
                  const ri = rows.indexOf(row);
                  const collapsed = collapsedPaths.has(row.path);
                  const expandable = hasChildren(row);
                  return (
                  <tr key={row.path}
                    onMouseEnter={() => setHoveredIndex(ri)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    className={`border-b border-gray-200 transition-colors ${hoveredIndex === ri ? hoverClass(row) : ''}`}>
                    <td
                      className="relative p-2 font-medium whitespace-nowrap"
                      style={{ width: 180, paddingLeft: 8 + row.level * 12 }}
                    >
                      {row.level > 0 && Array.from({ length: row.level }, (_, k) => (
                        <span
                          key={k}
                          className="absolute -top-px bottom-0 w-px bg-gray-300 pointer-events-none z-10"
                          style={{ left: 16 + k * 12 }}
                        />
                      ))}
                      <span className="inline-flex items-center gap-1">
                        {expandable ? (
                          <button type="button" onClick={() => toggleCollapse(row.path)}
                            className="w-4 h-4 inline-flex items-center justify-center shrink-0 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200/60"
                            title={collapsed ? '展开' : '折叠'}>
                            <BomChevron expanded={!collapsed} />
                          </button>
                        ) : (
                          <span className="w-4 shrink-0" />
                        )}
                        <span>{row.builtin.PartNumber || ''}</span>
                      </span>
                    </td>
                    <td className="p-2 text-center" style={{ width: 40 }}>{row.quantity}</td>
                    {BUILTIN_COLUMNS.map(col => {
                      // 内置列同样对比 PDM：术语/中文名称↔name、版本↔version
                      // CAD 属性名由当前生效映射反查（SW: 中文名称/Revision，CATIA: Nomenclature/Revision），
                      // 与拉取写回目标一致，确保拉取后左侧列同步刷新
                      const attr = builtinAttrOf(col.target, col.fallbackAttr);
                      const cadVal = row.builtin[attr] || '';
                      const pdmVal = col.target === 'name' ? (row.pdm_match?.name || '')
                        : (row.pdm_match?.version || '');
                      const fromPdm = cadVal === '' && pdmVal !== '';
                      const conflict = cadVal !== '' && pdmVal !== '' && cadVal.trim() !== pdmVal.trim();
                      const value = fromPdm ? pdmVal : cadVal;
                      const toneCls = fromPdm ? ' text-green-600 border-green-400'
                        : conflict ? ' text-red-600 border-red-400' : '';
                      const title = fromPdm ? `PDM 值（CAD 为空）: ${pdmVal}`
                        : conflict ? `与 PDM 不同 — CAD: ${cadVal} / PDM: ${pdmVal}` : undefined;
                      return (
                      <td key={col.target} className="p-2" style={{ width: col.target === 'version' ? 56 : 100 }} title={title}>
                        <input value={value} disabled={!canEditProps(row)}
                          onChange={e => commitEdit(row, attr, e.target.value, 'builtin')}
                          className={`border border-gray-300 rounded px-1.5 py-0.5 w-full disabled:bg-gray-100 disabled:border-gray-200${toneCls}`} />
                      </td>
                      );
                    })}
                    <td className="p-2 text-center" style={{ width: 90 }}>
                      {(() => { const n = row.pdm_match?.revision_id ? attCounts[row.pdm_match.revision_id]?.cad : undefined; return (<div className={`${n ? 'font-semibold text-blue-600' : 'text-gray-500'}`}>{n !== undefined ? n : '—'}</div>); })()}
                      {isCheckedOutByMe(row) && <button onClick={() => handleUploadCAD(row)} disabled={uploadingCad === row.path} title={row.doc_path || 'CATIA 源文件路径未知'} className="mt-1 px-2 py-0.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300">{uploadingCad === row.path ? '上传中...' : '上传源文件'}</button>}
                      {!row.pdm_match && <span className="text-gray-400">—</span>}
                      {row.pdm_match && !isCheckedOutByMe(row) && !isCheckedOutByOther(row) && <button disabled className="mt-1 px-2 py-0.5 bg-gray-200 text-gray-400 rounded cursor-not-allowed">需签出</button>}
                      {isCheckedOutByOther(row) && <button disabled className="mt-1 px-2 py-0.5 bg-gray-200 text-gray-400 rounded cursor-not-allowed">他人签出</button>}
                    </td>
                    <td className="p-2 text-center" style={{ width: 100 }}>
                      {(() => { const n = row.pdm_match?.revision_id ? attCounts[row.pdm_match.revision_id]?.production : undefined; return (<div className={`${n ? 'font-semibold text-amber-600' : 'text-gray-500'}`}>{n !== undefined ? n : '—'}</div>); })()}
                      {isCheckedOutByMe(row) && (<div className="flex gap-1 justify-center mt-1"><button onClick={() => handleUploadPDF(row)} disabled={uploadingPdf === row.path} title="工程图转PDF上传" className="px-2 py-0.5 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-300">{uploadingPdf === row.path ? '转换中...' : 'PDF'}</button><button onClick={() => handleUploadSTP(row)} disabled={uploadingStp === row.path} title="导出STP上传" className="px-2 py-0.5 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:bg-gray-300">{uploadingStp === row.path ? '导出中...' : 'STP'}</button></div>)}
                      {!row.pdm_match && <span className="text-gray-400">—</span>}
                      {row.pdm_match && !isCheckedOutByMe(row) && !isCheckedOutByOther(row) && <button disabled className="mt-1 px-2 py-0.5 bg-gray-200 text-gray-400 rounded cursor-not-allowed">需签出</button>}
                      {isCheckedOutByOther(row) && <button disabled className="mt-1 px-2 py-0.5 bg-gray-200 text-gray-400 rounded cursor-not-allowed">他人签出</button>}
                    </td>
                    <td className="p-2" style={{ width: 130 }}>
                      {row.match_status === 'conflict' && row.pdm_match ? <span className="text-red-600">{row.pdm_match.latest_version ? `版本冲突 (PDM最新: v${row.pdm_match.latest_version})` : '版本冲突'}</span>
                      : row.pdm_match?.master_id ? <span onClick={() => setDetailPart({ masterId: row.pdm_match!.master_id!, revisionId: row.pdm_match!.revision_id })} className="text-blue-600 cursor-pointer hover:underline" title="查看零部件详情">{row.pdm_match.code} (v{row.pdm_match.version})</span>
                      : row.pdm_match ? <span className="text-blue-600">{row.pdm_match.code} (v{row.pdm_match.version})</span>
                      : <span className="text-amber-600">— 无 —</span>}
                    </td>
                    <td className="p-2" style={{ width: 76 }}>
                      {row.match_status === 'matched' && <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full">已匹配</span>}
                      {row.match_status === 'new' && <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">可新建</span>}
                      {row.match_status === 'conflict' && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full">冲突</span>}
                      {row.match_status === 'unknown' && <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">未知</span>}
                    </td>
                    <td className="p-2" style={{ width: 76 }}>
                      {row.checkout_status === 'not_checked_out' && <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">未签出</span>}
                      {row.checkout_status === 'checked_out' && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">已签出</span>}
                      {row.checkout_status === 'other_checked_out' && <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">他人签出</span>}
                      {row.checkout_status === null && <span className="text-gray-400">—</span>}
                    </td>
                    <td className="p-2 text-center" style={{ width: 160 }}>
                      <div className="flex gap-1 flex-wrap justify-center">
                        {row.match_status === 'new' && <button onClick={() => handleCreatePart(row)} className="px-2 py-1 bg-amber-500 text-white rounded hover:bg-amber-600">创建零件</button>}
                        {row.match_status === 'matched' && row.checkout_status === 'not_checked_out' && (<><button onClick={() => handleCheckout(row)} className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">签出</button><button onClick={() => handlePullFromPDM(row)} className="px-2 py-1 bg-amber-50 text-amber-700 border border-amber-300 rounded hover:bg-amber-100">属性↓</button></>)}
                        {row.match_status === 'matched' && row.checkout_status === 'checked_out' && (
                          <div className="flex flex-col gap-1">
                            <div className="flex gap-1 justify-center">
                              <button onClick={() => handleCheckin(row)} className="px-2 py-1 bg-emerald-500 text-white rounded hover:bg-emerald-600">签入</button>
                              <button onClick={() => handleUndoCheckout(row)} className="px-2 py-1 bg-red-50 text-red-700 border border-red-300 rounded hover:bg-red-100">撤销</button>
                            </div>
                            <div className="flex gap-1 justify-center">
                              <button
                                onClick={() => handlePushToPDM(row)}
                                disabled={pushingKeys.current.has(row.path)}
                                title="CAD 属性推送到 PDM"
                                className="px-2 py-1 bg-blue-100 text-blue-700 border border-blue-300 rounded hover:bg-blue-200 disabled:opacity-40 disabled:cursor-not-allowed"
                              >属性↑</button>
                              <button onClick={() => handlePullFromPDM(row)} title="PDM 字段拉取覆盖 CAD 属性" className="px-2 py-1 bg-amber-50 text-amber-700 border border-amber-300 rounded hover:bg-amber-100">属性↓</button>
                            </div>
                          </div>
                        )}
                        {row.match_status === 'matched' && row.checkout_status === 'other_checked_out' && <button onClick={() => handlePullFromPDM(row)} className="px-2 py-1 bg-amber-50 text-amber-700 border border-amber-300 rounded hover:bg-amber-100">属性↓</button>}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
        </div>

        {/* ====== 右区：自定义字段 ====== */}
        <div className="flex-1 min-w-0 border-l-2 border-gray-200 flex flex-col">
          {/* 表头：固定在顶部，不随数据滚动 */}
          <div ref={rightHeadRef} className="shrink-0 overflow-hidden" style={{ scrollbarGutter: 'stable' }}>
            <table className="border-separate border-spacing-0 text-xs whitespace-nowrap w-full">
              <thead>
                <tr className="bg-gray-50 shadow-[0_2px_0_0_#e5e7eb]">
                  {propertyColumns.map(col => (
                    <th key={col} className="p-2 text-left" style={{ minWidth: 100 }}>{col}</th>
                  ))}
                </tr>
              </thead>
            </table>
          </div>
          {/* 数据：垂直+水平滚动，水平滚动条始终在容器底部可见 */}
          <div ref={rightScrollRef} className="flex-1 min-h-0 overflow-auto" style={{ scrollbarGutter: 'stable' }}
            onScroll={handleRightScroll}>
            <table className="border-separate border-spacing-0 text-xs whitespace-nowrap w-full">
                  <tbody ref={rightBodyRef}>
                    {visibleRows.map((row, vi) => {
                      const ri = rows.indexOf(row);
                      return (
                      <tr key={row.path}
                        onMouseEnter={() => setHoveredIndex(ri)}
                        onMouseLeave={() => setHoveredIndex(null)}
                        className={`transition-colors ${hoveredIndex === ri ? hoverClass(row) : ''}`}>
                        {propertyColumns.map(col => {
                          const catiaProp = getCatiaPropForPdmField(col);
                          const fieldDef = fieldDefs.find((d: any) => d.name === col);
                          const cadValue = catiaProp ? (row.user_properties[catiaProp] || '') : '';
                          const revId = row.pdm_match?.revision_id;
                          // 批量接口返回值按 field_key 索引（非 field_id）
                          const pdmRaw = revId && fieldDef ? pdmCfValues[revId]?.[fieldDef.field_key] : undefined;
                          const pdmValue = pdmRaw == null ? '' : (Array.isArray(pdmRaw) ? pdmRaw.join(', ') : String(pdmRaw));
                          // CAD 有值显示 CAD；CAD 空且 PDM 有值→回退显示 PDM（绿色）；
                          // CAD/PDM 都有但不同→显示 CAD（红色，提示冲突）
                          const fromPdm = cadValue === '' && pdmValue !== '';
                          const sameVal = fieldDef?.field_type === 'number'
                            ? Number(cadValue) === Number(pdmValue)
                            : cadValue.trim() === pdmValue.trim();
                          const conflict = cadValue !== '' && pdmValue !== '' && !sameVal;
                          const value = fromPdm ? pdmValue : cadValue;
                          const toneCls = fromPdm ? ' text-green-600 border-green-400'
                            : conflict ? ' text-red-600 border-red-400' : '';
                          const title = fromPdm ? `PDM 值（CAD 为空）: ${pdmValue}`
                            : conflict ? `与 PDM 不同 — CAD: ${cadValue} / PDM: ${pdmValue}` : undefined;
                          const isSelect = fieldDef?.field_type === 'select' && fieldDef?.options?.length > 0;
                          return (
                            <td key={col} className="p-2 border-b border-gray-200" style={{ minWidth: 100 }} title={title}>
                              {isSelect ? (
                                <select value={value} disabled={!canEditProps(row) || !catiaProp}
                                  onChange={e => { if (!catiaProp) return; commitEdit(row, catiaProp, e.target.value); }}
                                  className={`border border-gray-300 rounded px-1.5 py-0.5 w-full disabled:bg-gray-100 disabled:border-gray-200${toneCls}`}>
                                  <option value="">—</option>
                                  {fieldDef.options.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                                </select>
                              ) : (
                                <input value={value} disabled={!canEditProps(row) || !catiaProp}
                                  onChange={e => { if (!catiaProp) return; commitEdit(row, catiaProp, e.target.value); }}
                                  className={`border border-gray-300 rounded px-1.5 py-0.5 w-full disabled:bg-gray-100 disabled:border-gray-200${toneCls}`} />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
          </div>
        </div>
      </div>

      {/* PDM匹配零部件详情弹窗 */}
      {detailPart && (
        <PartDetailModal
          open={true}
          masterId={detailPart.masterId}
          revisionId={detailPart.revisionId}
          onClose={() => setDetailPart(null)}
        />
      )}
    </div>
  );
}

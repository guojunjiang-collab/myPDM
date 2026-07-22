import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from '../Toast';
import { partsApi, customFieldsApi } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { useCADBridge } from '../../hooks/useCADBridge';
import { syncRowsByPartNumber } from './syncRows';
import { flattenTree } from './flattenTree';
import PartDetailModal from '../PartDetailModal';

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

// CATIA 内置属性列：列头中文，写回 CATIA 用英文属性名。
// 件号（PartNumber）只读不在此列表；属性存于零件文档，编辑后按同 PartNumber 实例同步。
const BUILTIN_COLUMNS: { label: string; attr: string; width?: string }[] = [
  { label: '版本', attr: 'Revision', width: 'w-14' },
  { label: '术语/中文名称', attr: 'Nomenclature' },
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
  const leftTableRef = useRef<HTMLTableElement>(null);
  const rightTableRef = useRef<HTMLTableElement>(null);

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

  // 同步右表行高到左表（两个独立table需要手动对齐行高）
  useEffect(() => {
    const syncRowHeights = () => {
      const leftRows = leftTableRef.current?.querySelectorAll('tbody tr');
      const rightRows = rightTableRef.current?.querySelectorAll('tbody tr');
      if (!leftRows || !rightRows || leftRows.length !== rightRows.length) return;
      rightRows.forEach(r => { (r as HTMLElement).style.height = ''; });
      leftRows.forEach((lr, i) => {
        (rightRows[i] as HTMLElement).style.height = `${lr.getBoundingClientRect().height}px`;
      });
    };
    syncRowHeights();
    const observer = new ResizeObserver(syncRowHeights);
    if (leftTableRef.current) observer.observe(leftTableRef.current);
    return () => observer.disconnect();
  }, [rows]);

  // CATIA 属性名 → PDM 字段名反向查找
  const getCatiaPropForPdmField = useCallback((pdmFieldName: string): string | undefined => {
    return Object.entries(fieldMapping.properties || {}).find(([, t]) => t === pdmFieldName)?.[0];
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

  const handlePropEdit = useCallback(async (row: BOMRow, key: string, value: string) => {
    try {
      await bridge.writeProperty(row.path, key, value);
      setRows(prev => syncRowsByPartNumber(prev, row, key, value));
      toast.success(`已更新 CATIA 属性 ${key}`);
    } catch (e: any) {
      toast.error(e.message || '写入 CATIA 失败');
    }
  }, [bridge]);

  const handleBuiltinEdit = useCallback(async (row: BOMRow, attr: string, value: string) => {
    try {
      await bridge.writeProperty(row.path, attr, value);
      setRows(prev => syncRowsByPartNumber(prev, row, attr, value, 'builtin'));
      toast.success(`已更新 CATIA 属性 ${attr}`);
    } catch (e: any) {
      toast.error(e.message || '写入 CATIA 失败');
    }
  }, [bridge]);

  const [matching, setMatching] = useState(false);
  // 各版本附件计数（cad/production），显示在附件列按钮上方
  const [attCounts, setAttCounts] = useState<Record<string, { cad: number; production: number }>>({});

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

  const handlePushToPDM = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
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
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '属性推送失败');
    }
  };

  const handlePullFromPDM = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    try {
      const rev = await partsApi.getRevision(row.pdm_match.revision_id);
      if (!rev) return;
      const master = await partsApi.get(rev.master_id);
      if (master?.spec) {
        await bridge.writeProperty(row.path, '规格型号', master.spec);
        setRows(prev => syncRowsByPartNumber(prev, row, '规格型号', master.spec));
      }
      toast.success('属性已从 PDM 拉取');
    } catch (e: any) {
      toast.error(e.message || '属性拉取失败');
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

      {/* 表格：固定列左侧 + 自定义字段右侧滚动 */}
      <div className="flex-1 min-h-0">
        <div className="h-full overflow-y-auto overflow-x-hidden">
          <div className="flex">
            {/* ====== 左表：固定列 ====== */}
            <table ref={leftTableRef} className="shrink-0 border-collapse text-xs whitespace-nowrap">
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 shadow-[0_2px_0_0_#e5e7eb]">
                  <th className="p-2 text-left">层级</th>
                  <th className="p-2 text-left">件号</th>
                  <th className="p-2 text-center">用量</th>
                  {BUILTIN_COLUMNS.map(col => (
                    <th key={col.attr} className={`p-2 text-left ${col.width || ''}`}>{col.label}</th>
                  ))}
                  <th className="p-2 text-center">CAD附件</th>
                  <th className="p-2 text-center">生产附件</th>
                  <th className="p-2 text-left">PDM匹配</th>
                  <th className="p-2 text-left">匹配状态</th>
                  <th className="p-2 text-left">签出状态</th>
                  <th className="p-2 text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.path} className={`border-b border-gray-200 transition-colors ${
                    row.match_status === 'new' ? 'hover:bg-yellow-100' :
                    row.checkout_status === 'checked_out' ? 'hover:bg-blue-100' : 'hover:bg-gray-100'
                  }`}>
                    <td className="p-2">
                      {row.level === 0 ? <strong>{row.level}</strong> : row.path.replace('0.', '')}
                    </td>
                    <td className="p-2">{row.builtin.PartNumber || ''}</td>
                    <td className="p-2 text-center">{row.quantity}</td>

                    {BUILTIN_COLUMNS.map(col => (
                      <td key={col.attr} className={`p-2 ${col.width || ''}`}>
                        <input
                          value={row.builtin[col.attr] || ''}
                          disabled={!canEditProps(row)}
                          onChange={(e) => {
                            const val = e.target.value;
                            setRows(prev => syncRowsByPartNumber(prev, row, col.attr, val, 'builtin'));
                            handleBuiltinEdit(row, col.attr, val);
                          }}
                          className="border border-sky-300 rounded px-1.5 py-0.5 w-full text-xs disabled:bg-gray-100 disabled:border-gray-200"
                        />
                      </td>
                    ))}

                    <td className="p-2 text-center">
                      {(() => {
                        const n = row.pdm_match?.revision_id ? attCounts[row.pdm_match.revision_id]?.cad : undefined;
                        return (
                          <div className={`text-xs ${n ? 'font-semibold text-blue-600' : 'text-gray-500'}`}>
                            {n !== undefined ? n : '—'}
                          </div>
                        );
                      })()}
                      {isCheckedOutByMe(row) && (
                        <button
                          onClick={() => handleUploadCAD(row)}
                          disabled={uploadingCad === row.path}
                          title={row.doc_path || 'CATIA 源文件路径未知'}
                          className="mt-1 px-2 py-0.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 disabled:bg-gray-300"
                        >
                          {uploadingCad === row.path ? '上传中...' : '上传源文件'}
                        </button>
                      )}
                      {!row.pdm_match && <span className="text-gray-400 text-xs">—</span>}
                      {row.pdm_match && !isCheckedOutByMe(row) && !isCheckedOutByOther(row) && (
                        <button disabled className="mt-1 px-2 py-0.5 bg-gray-200 text-gray-400 rounded text-xs cursor-not-allowed">需签出</button>
                      )}
                      {isCheckedOutByOther(row) && (
                        <button disabled className="mt-1 px-2 py-0.5 bg-gray-200 text-gray-400 rounded text-xs cursor-not-allowed">他人签出</button>
                      )}
                    </td>

                    <td className="p-2 text-center">
                      {(() => {
                        const n = row.pdm_match?.revision_id ? attCounts[row.pdm_match.revision_id]?.production : undefined;
                        return (
                          <div className={`text-xs ${n ? 'font-semibold text-amber-600' : 'text-gray-500'}`}>
                            {n !== undefined ? n : '—'}
                          </div>
                        );
                      })()}
                      {isCheckedOutByMe(row) && (
                        <div className="flex gap-1 justify-center mt-1">
                          <button
                            onClick={() => handleUploadPDF(row)}
                            disabled={uploadingPdf === row.path}
                            title="通过桥接程序将工程图(CATDrawing)转 PDF 并上传（同名覆盖）"
                            className="px-2 py-0.5 bg-red-500 text-white rounded text-xs hover:bg-red-600 disabled:bg-gray-300"
                          >
                            {uploadingPdf === row.path ? '转换中...' : 'PDF'}
                          </button>
                          <button
                            onClick={() => handleUploadSTP(row)}
                            disabled={uploadingStp === row.path}
                            title="通过桥接程序将 CATIA 零部件导出为 STP 并上传（同名覆盖）"
                            className="px-2 py-0.5 bg-purple-500 text-white rounded text-xs hover:bg-purple-600 disabled:bg-gray-300"
                          >
                            {uploadingStp === row.path ? '导出中...' : 'STP'}
                          </button>
                        </div>
                      )}
                      {!row.pdm_match && <span className="text-gray-400 text-xs">—</span>}
                      {row.pdm_match && !isCheckedOutByMe(row) && !isCheckedOutByOther(row) && (
                        <button disabled className="mt-1 px-2 py-0.5 bg-gray-200 text-gray-400 rounded text-xs cursor-not-allowed">需签出</button>
                      )}
                      {isCheckedOutByOther(row) && (
                        <button disabled className="mt-1 px-2 py-0.5 bg-gray-200 text-gray-400 rounded text-xs cursor-not-allowed">他人签出</button>
                      )}
                    </td>

                    <td className="p-2">
                      {row.match_status === 'conflict' && row.pdm_match ? (
                        <span className="text-red-600">
                          {row.pdm_match.latest_version
                            ? `版本冲突 (PDM最新: v${row.pdm_match.latest_version})`
                            : '版本冲突'}
                        </span>
                      ) : row.pdm_match?.master_id ? (
                        <span
                          onClick={() => setDetailPart({ masterId: row.pdm_match!.master_id!, revisionId: row.pdm_match!.revision_id })}
                          className="text-blue-600 cursor-pointer hover:underline"
                          title="查看零部件详情"
                        >
                          {row.pdm_match.code} (v{row.pdm_match.version})
                        </span>
                      ) : row.pdm_match ? (
                        <span className="text-blue-600">{row.pdm_match.code} (v{row.pdm_match.version})</span>
                      ) : (
                        <span className="text-amber-600">— 无 —</span>
                      )}
                    </td>

                    <td className="p-2">
                      {row.match_status === 'matched' && <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs">已匹配</span>}
                      {row.match_status === 'new' && <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full text-xs">可新建</span>}
                      {row.match_status === 'conflict' && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs">冲突</span>}
                      {row.match_status === 'unknown' && <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full text-xs">未知</span>}
                    </td>

                    <td className="p-2">
                      {row.checkout_status === 'not_checked_out' && <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">未签出</span>}
                      {row.checkout_status === 'checked_out' && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs">已签出</span>}
                      {row.checkout_status === 'other_checked_out' && <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-xs">他人签出</span>}
                      {row.checkout_status === null && <span className="text-gray-400 text-xs">—</span>}
                    </td>

                    <td className="p-2 text-center">
                      <div className="flex gap-1 flex-wrap justify-center">
                        {row.match_status === 'new' && (
                          <button onClick={() => handleCreatePart(row)} className="px-2 py-1 bg-amber-500 text-white rounded text-xs hover:bg-amber-600">创建零件</button>
                        )}
                        {row.match_status === 'matched' && row.checkout_status === 'not_checked_out' && (
                          <>
                            <button onClick={() => handleCheckout(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">签出</button>
                            <button onClick={() => handlePullFromPDM(row)} className="px-2 py-1 bg-amber-50 text-amber-700 border border-amber-300 rounded text-xs hover:bg-amber-100">属性←</button>
                          </>
                        )}
                        {row.match_status === 'matched' && row.checkout_status === 'checked_out' && (
                          <>
                            <button onClick={() => handleCheckin(row)} className="px-2 py-1 bg-emerald-500 text-white rounded text-xs hover:bg-emerald-600">签入</button>
                            <button onClick={() => handlePushToPDM(row)} className="px-2 py-1 bg-blue-100 text-blue-700 border border-blue-300 rounded text-xs hover:bg-blue-200">属性→</button>
                            <button onClick={() => handleUndoCheckout(row)} className="px-2 py-1 bg-red-50 text-red-700 border border-red-300 rounded text-xs hover:bg-red-100">撤销</button>
                          </>
                        )}
                        {row.match_status === 'matched' && row.checkout_status === 'other_checked_out' && (
                          <button onClick={() => handlePullFromPDM(row)} className="px-2 py-1 bg-amber-50 text-amber-700 border border-amber-300 rounded text-xs hover:bg-amber-100">属性←</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* ====== 右表：自定义字段滚动区 ====== */}
            <div className="flex-1 overflow-x-auto" style={{ maxWidth: '50%' }}>
              <table ref={rightTableRef} className="border-collapse text-xs whitespace-nowrap w-full">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-50 shadow-[0_2px_0_0_#e5e7eb]">
                    {propertyColumns.map(col => (
                      <th key={col} className="p-2 text-left">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.path} className={`border-b border-gray-200 transition-colors ${
                      row.match_status === 'new' ? 'hover:bg-yellow-100' :
                      row.checkout_status === 'checked_out' ? 'hover:bg-blue-100' : 'hover:bg-gray-100'
                    }`}>
                      {propertyColumns.map(col => {
                        const catiaProp = getCatiaPropForPdmField(col);
                        const value = catiaProp ? (row.user_properties[catiaProp] || '') : '';
                        const fieldDef = fieldDefs.find((d: any) => d.name === col);
                        const isSelect = fieldDef?.field_type === 'select' && fieldDef?.options?.length > 0;
                        return (
                          <td key={col} className="p-2 align-top">
                            {isSelect ? (
                              <select
                                value={value}
                                disabled={!canEditProps(row) || !catiaProp}
                                onChange={(e) => {
                                  if (!catiaProp) return;
                                  const val = e.target.value;
                                  setRows(prev => syncRowsByPartNumber(prev, row, catiaProp, val));
                                  handlePropEdit(row, catiaProp, val);
                                }}
                                className="border border-blue-300 rounded px-1.5 py-0.5 w-full text-xs disabled:bg-gray-100 disabled:border-gray-200"
                              >
                                <option value="">—</option>
                                {fieldDef.options.map((opt: string) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                value={value}
                                disabled={!canEditProps(row) || !catiaProp}
                                onChange={(e) => {
                                  if (!catiaProp) return;
                                  const val = e.target.value;
                                  setRows(prev => syncRowsByPartNumber(prev, row, catiaProp, val));
                                  handlePropEdit(row, catiaProp, val);
                                }}
                                className="border border-blue-300 rounded px-1.5 py-0.5 w-full text-xs disabled:bg-gray-100 disabled:border-gray-200"
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

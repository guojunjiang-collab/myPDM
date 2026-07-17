import { useState, useCallback, useEffect } from 'react';
import { toast } from '../Toast';
import { partsApi } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { useCADBridge } from '../../hooks/useCADBridge';
import { syncRowsByPartNumber } from './syncRows';

export interface BOMRow {
  instance_name: string;
  part_number: string;
  path: string;
  level: number;
  is_assembly: boolean;
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
}

// CATIA 内置属性不作为用户属性列显示（内置属性有独立列，避免双重显示）
const BUILTIN_KEYS = new Set(['PartNumber', 'Revision', 'Definition', 'Nomenclature', 'DescriptionRef']);

function getPropertyColumns(userProps: Record<string, string>): string[] {
  return Object.keys(userProps).filter(k => !BUILTIN_KEYS.has(k));
}

// CATIA 内置属性列：列头中文，写回 CATIA 用英文属性名。
// 件号（PartNumber）只读不在此列表；属性存于零件文档，编辑后按同 PartNumber 实例同步。
const BUILTIN_COLUMNS: { label: string; attr: string }[] = [
  { label: '版本', attr: 'Revision' },
  { label: '定义', attr: 'Definition' },
  { label: '术语', attr: 'Nomenclature' },
  { label: '描述', attr: 'DescriptionRef' },
];

export function CADBOMMatchTable({ bridge, rows: initialRows, onComplete }: Props) {
  const [rows, setRows] = useState<BOMRow[]>(initialRows);
  const user = useAuthStore((s) => s.user);

  const propertyColumns = rows.length > 0 ? getPropertyColumns(rows[0].user_properties) : [];

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
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'PDM 匹配失败');
    } finally {
      setMatching(false);
    }
  }, []);

  // 进入匹配步骤时自动执行一次 PDM 匹配
  useEffect(() => {
    runPdmMatch(initialRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      await partsApi.update(row.pdm_match.master_id!, {
        code: row.builtin.PartNumber || row.pdm_match.code,
        name: row.builtin.Definition || row.pdm_match.name,
      });
      toast.success('属性已推送到 PDM');
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
        name: row.builtin.Definition || row.instance_name,
        spec: row.user_properties['规格型号'] || '',
        type: (row.is_assembly ? 'assembly' : 'part') as 'part' | 'assembly',
      };
      const result = await partsApi.create(data);
      setRows(prev => prev.map(r =>
        r.path === row.path ? {
          ...r,
          match_status: 'matched' as const,
          pdm_match: { master_id: result.id, revision_id: result.latest_revision?.id, code: result.code, version: 'A', name: result.name },
          checkout_status: 'not_checked_out' as const,
        } : r
      ));
      toast.success(`已创建零部件: ${result.code}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '创建失败');
    }
  };

  const handleUploadCAD = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.CATPart,.CATProduct,.CATDrawing';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const { v2UploadApi } = await import('../../services/api');
        const entityType = row.is_assembly ? 'assembly' : 'part';
        await v2UploadApi.uploadSmallFile(file, entityType, row.pdm_match!.revision_id!, undefined, 'cad');
        toast.success('CAD 附件上传成功');
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || '上传失败');
      }
    };
    input.click();
  };

  const handleUploadPDF = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const { v2UploadApi } = await import('../../services/api');
        const entityType = row.is_assembly ? 'assembly' : 'part';
        await v2UploadApi.uploadSmallFile(file, entityType, row.pdm_match!.revision_id!, undefined, 'production');
        toast.success('PDF 上传成功');
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || '上传失败');
      }
    };
    input.click();
  };

  const handleUploadSTP = async (row: BOMRow) => {
    if (!row.pdm_match?.revision_id) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.stp,.step';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const { v2UploadApi } = await import('../../services/api');
        const entityType = row.is_assembly ? 'assembly' : 'part';
        await v2UploadApi.uploadSmallFile(file, entityType, row.pdm_match!.revision_id!, undefined, 'production');
        toast.success('STP 上传成功');
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || '上传失败');
      }
    };
    input.click();
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
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200 flex-wrap">
        <span className="bg-green-100 text-green-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">已匹配 {totalMatched}</span>
        <span className="bg-yellow-100 text-yellow-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">可新建 {totalNew}</span>
        <span className="bg-red-100 text-red-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">冲突 {totalConflict}</span>
        <span className="bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">已签出 {totalCheckedOut}</span>
        <div className="flex-1" />
        <button
          onClick={() => runPdmMatch(rows)}
          disabled={matching}
          className="px-3 py-1.5 bg-sky-500 text-white rounded text-xs hover:bg-sky-600 disabled:bg-gray-300"
        >
          {matching ? '匹配中...' : '重新匹配'}
        </button>
        <button onClick={handleBatchPushToPDM} className="px-3 py-1.5 bg-amber-500 text-white rounded text-xs hover:bg-amber-600">批量属性→PDM</button>
        <button onClick={handleBatchCheckin} className="px-3 py-1.5 bg-emerald-500 text-white rounded text-xs hover:bg-emerald-600">全部签入</button>
      </div>

      {/* 表格 */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse whitespace-nowrap">
          <thead>
            <tr className="bg-gray-50 border-b-2 border-gray-200">
              <th className="p-2 text-left">层级</th>
              <th className="p-2 text-left">件号</th>
              {BUILTIN_COLUMNS.map(col => (
                <th key={col.attr} className="p-2 text-left bg-sky-50">{col.label}</th>
              ))}
              {propertyColumns.map(col => (
                <th key={col} className="p-2 text-left bg-green-50">{col}</th>
              ))}
              <th className="p-2 text-center bg-blue-50">CAD附件</th>
              <th className="p-2 text-center bg-amber-50">生产附件</th>
              <th className="p-2 text-left">PDM匹配</th>
              <th className="p-2 text-left">匹配状态</th>
              <th className="p-2 text-left">签出状态</th>
              <th className="p-2 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.path} className={`border-b border-gray-100 ${
                row.match_status === 'new' ? 'bg-yellow-50' :
                row.checkout_status === 'checked_out' ? 'bg-blue-50' : ''
              }`}>
                <td className="p-2">
                  {row.level === 0 ? <strong>{row.level}</strong> : row.path.replace('0.', '')}
                </td>
                <td className="p-2">{row.builtin.PartNumber || ''}</td>

                {BUILTIN_COLUMNS.map(col => (
                  <td key={col.attr} className="p-2 bg-sky-50">
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

                {propertyColumns.map(col => (
                  <td key={col} className="p-2 bg-green-50">
                    <input
                      value={row.user_properties[col] || ''}
                      disabled={!canEditProps(row)}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRows(prev => syncRowsByPartNumber(prev, row, col, val));
                        handlePropEdit(row, col, val);
                      }}
                      className="border border-blue-300 rounded px-1.5 py-0.5 w-full text-xs disabled:bg-gray-100 disabled:border-gray-200"
                    />
                  </td>
                ))}

                <td className="p-2 text-center bg-blue-50">
                  <div className="text-xs text-gray-500">—</div>
                  {isCheckedOutByMe(row) && (
                    <button onClick={() => handleUploadCAD(row)} className="mt-1 px-2 py-0.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">
                      上传
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

                <td className="p-2 text-center bg-amber-50">
                  <div className="text-xs text-gray-500">—</div>
                  {isCheckedOutByMe(row) && (
                    <div className="flex gap-1 justify-center mt-1">
                      <button onClick={() => handleUploadPDF(row)} className="px-2 py-0.5 bg-red-500 text-white rounded text-xs hover:bg-red-600">PDF</button>
                      <button onClick={() => handleUploadSTP(row)} className="px-2 py-0.5 bg-purple-500 text-white rounded text-xs hover:bg-purple-600">STP</button>
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
      </div>
    </div>
  );
}

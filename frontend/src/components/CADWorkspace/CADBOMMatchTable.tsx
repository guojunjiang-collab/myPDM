import { useState, useCallback } from 'react';
import { toast } from '../Toast';
import { partsApi } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { useCADBridge } from '../../hooks/useCADBridge';

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
  } | null;
  match_status: 'matched' | 'new' | 'conflict' | 'unknown';
  checkout_status: 'not_checked_out' | 'checked_out' | 'other_checked_out' | null;
}

interface Props {
  bridge: ReturnType<typeof useCADBridge>;
  rows: BOMRow[];
  onComplete: (count: number) => void;
}

function getPropertyColumns(userProps: Record<string, string>): string[] {
  return Object.keys(userProps).filter(k => k !== 'PartNumber' && k !== 'Revision' && k !== 'Definition');
}

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
      setRows(prev => prev.map(r =>
        r.path === row.path ? { ...r, user_properties: { ...r.user_properties, [key]: value } } : r
      ));
      toast.success(`已更新 CATIA 属性 ${key}`);
    } catch (e: any) {
      toast.error(e.message || '写入 CATIA 失败');
    }
  }, [bridge]);

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
        setRows(prev => prev.map(r =>
          r.path === row.path ? { ...r, user_properties: { ...r.user_properties, '规格型号': master.spec } } : r
        ));
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
        <button onClick={handleBatchPushToPDM} className="px-3 py-1.5 bg-amber-500 text-white rounded text-xs hover:bg-amber-600">批量属性→PDM</button>
        <button onClick={handleBatchCheckin} className="px-3 py-1.5 bg-emerald-500 text-white rounded text-xs hover:bg-emerald-600">全部签入</button>
      </div>

      {/* 表格 */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse whitespace-nowrap">
          <thead>
            <tr className="bg-gray-50 border-b-2 border-gray-200">
              <th className="p-2 text-left">层级</th>
              <th className="p-2 text-left">CATIA PartNumber</th>
              <th className="p-2 text-left">CATIA 名称</th>
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
                <td className="p-2">{row.instance_name}</td>

                {propertyColumns.map(col => (
                  <td key={col} className="p-2 bg-green-50">
                    <input
                      value={row.user_properties[col] || ''}
                      disabled={!canEditProps(row)}
                      onChange={(e) => {
                        const val = e.target.value;
                        setRows(prev => prev.map(r =>
                          r.path === row.path ? { ...r, user_properties: { ...r.user_properties, [col]: val } } : r
                        ));
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
                  {row.pdm_match ? (
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

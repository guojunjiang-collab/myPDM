import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { configurationApi, assemblyPartsApi } from '../../services/api';
import type { ConfigPartItem, ConfigChildItem } from '../../types';
import EntityDocumentSection from '../EntityDocumentSection';

interface Props {
  itemId: string | null;
  onClose: () => void;
}

export default function ConfigurationDetailModal({ itemId, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

  // 展开状态: { key: children[] }
  const [expandedParts, setExpandedParts] = useState<Record<string, any[]>>({});
  const [loadingPart, setLoadingPart] = useState<string | null>(null);
  const [expandedChild, setExpandedChild] = useState<Record<string, any[]>>({});
  const [noChildren, setNoChildren] = useState<Set<string>>(new Set());
  const [loadingChild, setLoadingChild] = useState<string | null>(null);

  useEffect(() => {
    if (!itemId) return;
    setLoading(true);
    configurationApi.getItem(itemId)
      .then((res) => {
        setData(res.data);
        setExpandedParts({}); setExpandedChild({}); setNoChildren(new Set());
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [itemId]);

  const togglePart = async (idx: string, entityId: string, entityType: string) => {
    if (expandedParts[idx]) { setExpandedParts(p => { const n = { ...p }; delete n[idx]; return n; }); return; }
    if (entityType !== 'assembly') return;
    setLoadingPart(idx);
    try {
      const r = await assemblyPartsApi.list(entityId);
      const children = (r.data || []).map((c: any) => ({
        entity_type: c.childType === 'component' || c.childType === 'assembly' ? 'assembly' : 'part',
        entity_id: c.child_id,
        entity_code: c.child_detail?.code || '',
        entity_name: c.child_detail?.name || '',
        entity_version: c.child_detail?.version || '',
        spec: c.child_detail?.spec || '',
        status: c.child_detail?.status || '',
        quantity: c.quantity || 1,
      }));
      setExpandedParts(p => ({ ...p, [idx]: children }));
    } catch { } finally { setLoadingPart(null); }
  };

  const toggleChild = async (idx: string, childId: string) => {
    if (expandedChild[idx]) { setExpandedChild(p => { const n = { ...p }; delete n[idx]; return n; }); return; }
    if (noChildren.has(idx)) return; // already checked, no children
    setLoadingChild(idx);
    try {
      const r = await configurationApi.getItem(childId);
      const children = (r.data.children || []).map((c: any) => ({
        child_id: c.child_id,
        child_code: c.child_detail?.code || '',
        child_name: c.child_detail?.name || '',
        spec: c.child_detail?.spec || '',
      }));
      if (children.length > 0) {
        setExpandedChild(p => ({ ...p, [idx]: children }));
      } else {
        setNoChildren(prev => new Set(prev).add(idx));
      }
    } catch { setNoChildren(prev => new Set(prev).add(idx)); }
    finally { setLoadingChild(null); }
  };

  const renderPartRow = (p: any, level: number, idx: string): React.ReactNode => {
    const isAssembly = p.part_type === 'assembly' || p.entity_type === 'assembly';
    const childRows = expandedParts[idx];
    return (
      <>
        <tr key={idx} className="hover:bg-gray-50">
          <td className="px-3 py-2 text-sm text-gray-400 whitespace-nowrap">
            <span>{'-'.repeat(level)}{level}</span>
            {isAssembly && (
              <button onClick={() => togglePart(idx, p.part_id || p.entity_id, p.part_type || p.entity_type)}
                className="inline-flex items-center w-5 h-5 text-gray-400 hover:text-gray-600 ml-1">
                {childRows ? '▼' : '▶'}
              </button>
            )}
          </td>
          <td className="px-3 py-2 text-sm font-medium">{p.part_detail?.code || p.entity_code || p.part_id}</td>
          <td className="px-3 py-2 text-sm">{p.part_detail?.name || p.entity_name || '-'}</td>
          <td className="px-3 py-2 text-sm text-gray-500">{p.part_type === 'assembly' || p.entity_type === 'assembly' ? '部件' : '零件'}</td>
          <td className="px-3 py-2 text-sm text-gray-500">{p.part_detail?.spec || p.spec || '-'}</td>
          <td className="px-3 py-2 text-sm">{p.part_detail?.version || p.entity_version || '-'}</td>
          <td className="px-3 py-2 text-sm whitespace-nowrap">
            <span className={`px-1.5 py-0.5 rounded text-sm ${(p.part_detail?.status || p.status) === 'draft' ? 'bg-blue-100 text-blue-700' : (p.part_detail?.status || p.status) === 'released' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
              {(p.part_detail?.status || p.status) === 'draft' ? '草稿' : (p.part_detail?.status || p.status) === 'released' ? '发布' : (p.part_detail?.status || p.status) === 'frozen' ? '冻结' : (p.part_detail?.status || p.status) === 'obsolete' ? '作废' : '-'}
            </span>
          </td>
          <td className="px-3 py-2 text-center text-sm">
            <span className={`px-2 py-0.5 text-sm rounded ${p.is_required ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {p.is_required != null ? (p.is_required ? '必选' : '可选') : '-'}
            </span>
          </td>
        </tr>
        {childRows && childRows.map((c: any, j: number) => renderPartRow(c, level + 1, `${idx}-${j}`))}
        {loadingPart === idx && <tr><td colSpan={8} className="px-3 py-2 text-sm text-gray-400 text-center">加载中...</td></tr>}
      </>
    );
  };

  const renderChildRow = (c: any, level: number, idx: string): React.ReactNode => {
    const childRows = expandedChild[idx];
    const isEmpty = noChildren.has(idx);
    return (
      <>
        <tr key={idx} className="hover:bg-gray-50">
          <td className="px-3 py-2 text-sm text-gray-400 whitespace-nowrap">
            <span>{'-'.repeat(level)}{level}</span>
            {!isEmpty && (
              <button onClick={() => toggleChild(idx, c.child_id || c.child_detail?.id)}
                className="inline-flex items-center w-5 h-5 text-gray-400 hover:text-gray-600 ml-1">
                {childRows ? '▼' : '▶'}
              </button>
            )}
          </td>
          <td className="px-3 py-2 text-sm font-medium">{c.child_detail?.code || c.child_code || c.child_id}</td>
          <td className="px-3 py-2 text-sm">{c.child_detail?.name || c.child_name || '-'}</td>
          <td className="px-3 py-2 text-sm text-gray-500">{c.child_detail?.spec || c.spec || '-'}</td>
          <td className="px-3 py-2 text-center text-sm">
            <span className={`px-2 py-0.5 text-sm rounded ${c.is_required ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {c.is_required ? '必选' : '可选'}
            </span>
          </td>
        </tr>
        {childRows && childRows.map((cc: any, j: number) => renderChildRow(cc, level + 1, `${idx}-${j}`))}
        {loadingChild === idx && <tr><td colSpan={5} className="px-3 py-2 text-sm text-gray-400 text-center">加载中...</td></tr>}
      </>
    );
  };

  if (!itemId) return null;

  return (
    <Modal open={!!itemId} onClose={onClose} title="构型项详情" width="full">
      {loading ? (
        <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
      ) : !data ? (
        <div className="py-8 text-center text-sm text-gray-400">加载失败</div>
      ) : (
        <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-1">
          {/* 基本信息 */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <div><label className="block text-sm font-medium text-gray-500 mb-1">构型号</label><div className="text-sm font-medium">{data.code}</div></div>
            <div><label className="block text-sm font-medium text-gray-500 mb-1">中文名称</label><div className="text-sm">{data.name}</div></div>
            <div><label className="block text-sm font-medium text-gray-500 mb-1">规格型号</label><div className="text-sm">{data.spec || '-'}</div></div>
            {data.remark && <div className="col-span-2"><label className="block text-sm font-medium text-gray-500 mb-1">备注</label><div className="text-sm text-gray-600">{data.remark}</div></div>}
          </div>

          {/* 关联零部件 */}
          <div>
            <h4 className="text-sm font-bold text-gray-700 mb-2">关联零部件 ({data.parts?.length || 0})</h4>
            {data.parts?.length > 0 ? (
              <table className="w-full text-sm border border-gray-200 rounded">
                <thead className="bg-gray-50"><tr>
                  <th className="text-left px-3 py-2 text-sm text-gray-500 w-20">层级</th>
                  <th className="text-left px-3 py-2 text-sm text-gray-500">件号</th>
                  <th className="text-left px-3 py-2 text-sm text-gray-500">名称</th>
                  <th className="text-left px-3 py-2 text-sm text-gray-500 w-16">类型</th>
                  <th className="text-left px-3 py-2 text-sm text-gray-500">规格型号</th>
                  <th className="text-left px-3 py-2 text-sm text-gray-500 w-14">版本</th>
                  <th className="text-left px-3 py-2 text-sm text-gray-500 w-16">状态</th>
                  <th className="text-center px-3 py-2 text-sm text-gray-500 w-20">必选/可选</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {(data.parts as ConfigPartItem[]).map((p, i) => renderPartRow(p, 0, String(i)))}
                </tbody>
              </table>
            ) : <div className="text-sm text-gray-400 py-2">暂无关联零部件</div>}
          </div>

          {/* 子构型项 */}
          <div>
            <h4 className="text-sm font-bold text-gray-700 mb-2">子构型项 ({data.children?.length || 0})</h4>
            {data.children?.length > 0 ? (
              <table className="w-full text-sm border border-gray-200 rounded">
                <thead className="bg-gray-50"><tr>
                  <th className="text-left px-3 py-2 text-sm text-gray-500 w-20">层级</th>
                  <th className="text-left px-3 py-2 text-sm text-gray-500">构型号</th>
                  <th className="text-left px-3 py-2 text-sm text-gray-500">名称</th>
                  <th className="text-left px-3 py-2 text-sm text-gray-500">规格型号</th>
                  <th className="text-center px-3 py-2 text-sm text-gray-500 w-20">必选/可选</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {(data.children as ConfigChildItem[]).map((c, i) => renderChildRow(c, 0, String(i)))}
                </tbody>
              </table>
            ) : <div className="text-sm text-gray-400 py-2">暂无子构型项</div>}
          </div>

          {/* 关联图文档 */}
          <EntityDocumentSection entityType="configuration" entityId={data.id} editable={false} />
        </div>
      )}
    </Modal>
  );
}

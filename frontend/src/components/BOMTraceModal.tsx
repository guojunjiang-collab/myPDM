import { useState, useEffect } from 'react';
import { bomApi, partsApi, assembliesApi, customFieldsApi } from '../services/api';
import { useDataStore } from '../stores/data';
import type { BOMTraceItem, CustomFieldDefinition, CustomFieldValue, AssemblyPartItem } from '../types';
import { buildTraceTree, flattenTraceTree } from '../pages/BOM/helpers';
import type { TraceTreeNode } from '../pages/BOM/helpers';
import { Modal } from './Modal';
import PartDetailContent from './PartDetailContent';
import AssemblyDetailContent from './AssemblyDetailContent';

interface BOMTraceModalProps {
  entity: { type: 'part' | 'assembly'; id: string; code: string; name: string; version?: string } | null;
  onClose: () => void;
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
  frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
  released: { label: '发布', cls: 'bg-green-100 text-green-800' },
  obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
};

export default function BOMTraceModal({ entity, onClose }: BOMTraceModalProps) {
  const [traceResult, setTraceResult] = useState<BOMTraceItem[]>([]);
  const [traceTree, setTraceTree] = useState<TraceTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 内置详情弹窗（点击父项时叠加在反查之上）
  const [detailEntity, setDetailEntity] = useState<{ type: 'part' | 'assembly'; id: string } | null>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailCustomDefs, setDetailCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [detailCustomValues, setDetailCustomValues] = useState<Record<string, any>>({});

  // 载入反查结果
  useEffect(() => {
    // entity 变化时清理上一次遗留的详情子弹窗状态
    setDetailEntity(null);
    setDetailData(null);
    setDetailCustomDefs([]);
    setDetailCustomValues({});
    if (!entity) {
      setTraceResult([]);
      setError('');
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      setTraceResult([]);
      try {
        const res = await bomApi.trace(entity.type, entity.id);
        if (!cancelled) setTraceResult(res.data || []);
      } catch {
        if (!cancelled) { setError('反查失败，请稍后重试'); setTraceResult([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entity]);

  useEffect(() => {
    setTraceTree(buildTraceTree(traceResult));
  }, [traceResult]);

  const toggleTraceNode = (targetId: string) => {
    setTraceTree(prev => {
      const toggle = (nodes: TraceTreeNode[]): TraceTreeNode[] =>
        nodes.map(n => {
          if (n.item.bom_item_id === targetId) return { ...n, expanded: !n.expanded };
          if (n.children.length > 0) return { ...n, children: toggle(n.children) };
          return n;
        });
      return toggle(prev);
    });
  };

  const handleViewEntity = async (type: 'part' | 'assembly', id: string) => {
    setDetailEntity({ type, id });
    setDetailData(null);
    setDetailLoading(true);
    setDetailCustomDefs([]);
    setDetailCustomValues({});
    try {
      const api = type === 'part' ? partsApi : assembliesApi;
      const res = await api.get(id);
      setDetailData(res.data);
      const allDefs = useDataStore.getState().customFieldDefs;
      const entityType = type === 'part' ? 'part' : 'component';
      const defs = allDefs.filter((d: CustomFieldDefinition) => d.applies_to?.includes(entityType));
      setDetailCustomDefs(defs);
      if (defs.length > 0) {
        try {
          const valuesRes = await customFieldsApi.getValues(entityType, id);
          const vals: Record<string, any> = {};
          (valuesRes.data || []).forEach((v: CustomFieldValue) => { vals[v.field_id] = v.value; });
          setDetailCustomValues(vals);
        } catch { /* custom fields optional */ }
      }
    } catch { setDetailData(null); }
    finally { setDetailLoading(false); }
  };

  return (
    <>
      <Modal
        open={!!entity}
        title={entity ? `反查 — ${entity.code} ${entity.name}${entity.version ? ' ' + entity.version : ''}` : ''}
        onClose={onClose}
        width="3xl"
      >
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-400">查询中...</div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
        ) : traceResult.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">未找到任何引用该实体的上级部件</div>
        ) : (
          <div className="border border-gray-200 rounded-lg">
            <div className="p-3 border-b border-gray-200 bg-gray-50">
              <span className="text-sm text-gray-600">找到 {traceResult.length} 个关联节点（{traceTree.length} 个顶层）</span>
            </div>
            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">层级</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">类型</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">件号</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">规格型号</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">版本</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">状态</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">用量</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {flattenTraceTree(traceTree).map((node, idx) => {
                    const item = node.item;
                    const parent = item.parent_assembly || item.parent_part;
                    const parentType = item.parent_assembly ? '部件' : '零件';
                    const parentTypeCls = item.parent_assembly ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700';
                    const st = STATUS_MAP[parent?.status || ''] || { label: parent?.status || '-', cls: 'bg-gray-100 text-gray-800' };
                    const hasChildren = node.children.length > 0;
                    return (
                      <tr
                        key={`${item.bom_item_id}-${idx}`}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => {
                          if (!parent) return;
                          const type: 'part' | 'assembly' = item.parent_assembly ? 'assembly' : 'part';
                          handleViewEntity(type, parent.id);
                        }}
                      >
                        <td className="px-3 py-2 whitespace-nowrap text-left" onClick={(e) => e.stopPropagation()}>
                          <span className="inline-flex items-center gap-0.5">
                            <span className="text-xs text-gray-400">{'-'.repeat(item.level)}{item.level}</span>
                            {hasChildren ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleTraceNode(item.bom_item_id); }}
                                className="w-4 h-4 inline-flex items-center justify-center text-gray-500 hover:bg-gray-200 rounded"
                              >
                                {node.expanded ? '▼' : '▶'}
                              </button>
                            ) : (
                              <span className="w-4 inline-block" />
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2"><span className={`px-1.5 py-0.5 text-xs rounded ${parentTypeCls}`}>{parentType}</span></td>
                        <td className="px-3 py-2 font-medium">{parent?.code || '-'}</td>
                        <td className="px-3 py-2">{parent?.name || '-'}</td>
                        <td className="px-3 py-2 text-gray-500">{parent?.spec || '-'}</td>
                        <td className="px-3 py-2 text-gray-500">{parent?.version || '-'}</td>
                        <td className="px-3 py-2"><span className={`px-1.5 py-0.5 text-xs rounded ${st.cls}`}>{st.label}</span></td>
                        <td className="px-3 py-2">{item.quantity}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {/* 内置详情弹窗（叠加在反查之上） */}
      <Modal
        open={!!detailEntity}
        title={detailEntity ? (detailEntity.type === 'part' ? '零件详情' : '部件详情') : ''}
        onClose={() => setDetailEntity(null)}
        width="full"
        zIndex={60}
      >
        {detailLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
        ) : !detailData ? (
          <div className="py-8 text-center text-sm text-gray-400">加载失败</div>
        ) : detailEntity?.type === 'part' ? (
          <PartDetailContent part={detailData} customFieldDefs={detailCustomDefs} customFieldValues={detailCustomValues} />
        ) : (
          <AssemblyDetailContent
            assembly={detailData}
            customFieldDefs={detailCustomDefs}
            customFieldValues={detailCustomValues}
            onSubItemClick={(item: AssemblyPartItem) => handleViewEntity(item.childType === 'part' ? 'part' : 'assembly', item.child_id)}
          />
        )}
      </Modal>
    </>
  );
}

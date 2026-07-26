import { useState, useEffect } from 'react';
import { bomApi } from '../../services/api';
import type { BOMTraceItem } from '../../types';
import { buildTraceTree, flattenTraceTree, getStatusLabel } from './helpers';
import type { TraceTreeNode } from './types';

interface Props {
  revisionId: string;
  root: { masterId: string; revisionId: string; code: string; name: string; version?: string; status?: string } | null;
  onViewEntity: (masterId: string, revisionId?: string) => void;
  onStateChange?: (state: { loading: boolean; error: boolean; empty: boolean }) => void;
}

const statusCls = (s: string) => {
  const map: Record<string, string> = {
    draft: 'bg-blue-100 text-blue-800',
    frozen: 'bg-orange-100 text-orange-800',
    released: 'bg-green-100 text-green-800',
    obsolete: 'bg-red-100 text-red-800',
  };
  return map[s] || 'bg-gray-100 text-gray-800';
};

export default function BomWhereUsedTree({ revisionId, root, onViewEntity, onStateChange }: Props) {
  const [traceResult, setTraceResult] = useState<BOMTraceItem[]>([]);
  const [traceTree, setTraceTree] = useState<TraceTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!revisionId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setSearched(false);
    bomApi.trace('component', revisionId)
      .then(res => {
        if (!cancelled) {
          setTraceResult(res.data || []);
          setSearched(true);
        }
      })
      .catch(() => {
        if (!cancelled) setError('反查失败，请稍后重试');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [revisionId]);

  useEffect(() => {
    setTraceTree(buildTraceTree(traceResult));
  }, [traceResult]);

  useEffect(() => {
    onStateChange?.({ loading, error: !!error, empty: searched && traceResult.length === 0 });
  }, [loading, error, searched, traceResult]);

  const toggleTraceNode = (targetId: string) => {
    setTraceTree((prev) => {
      const toggle = (nodes: TraceTreeNode[]): TraceTreeNode[] =>
        nodes.map((n) => {
          if (n.item.bom_item_id === targetId) return { ...n, expanded: !n.expanded };
          if (n.children.length > 0) return { ...n, children: toggle(n.children) };
          return n;
        });
      return toggle(prev);
    });
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-gray-400 bg-white rounded-lg border border-gray-200">
        反查中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
        {error}
      </div>
    );
  }

  if (!searched && traceResult.length === 0) {
    return null;
  }

  if (searched && traceResult.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 bg-white rounded-lg border border-gray-200">
        未找到任何引用该零部件（选中版本）的上级装配
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="p-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
        <span className="text-sm text-gray-600">
          找到 {traceResult.length} 个关联节点（{traceTree.length} 个顶层）
        </span>
      </div>
      <div className="overflow-auto max-h-[calc(100vh-360px)]">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">层级</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">类型</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">件号</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">版本</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">状态</th>
              <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">用量</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {root && (
              <tr
                className="bg-gray-50 hover:bg-gray-100 cursor-pointer"
                onClick={() => onViewEntity(root.masterId, root.revisionId)}
              >
                <td className="px-3 py-2 whitespace-nowrap text-left">
                  <span className="text-xs text-gray-400">0</span>
                </td>
                <td className="px-3 py-2">
                  <span className="px-1.5 py-0.5 text-xs rounded bg-purple-50 text-purple-700">零部件</span>
                </td>
                <td className="px-3 py-2 font-medium">{root.code}</td>
                <td className="px-3 py-2">{root.name}</td>
                <td className="px-3 py-2">{root.version || '-'}</td>
                <td className="px-3 py-2">
                  {root.status ? (
                    <span className={`px-1.5 py-0.5 text-xs rounded ${statusCls(root.status)}`}>
                      {getStatusLabel(root.status)}
                    </span>
                  ) : '-'}
                </td>
                <td className="px-3 py-2">-</td>
              </tr>
            )}
            {flattenTraceTree(traceTree).map((node, idx) => {
              const item = node.item;
              const parent = item.parent_assembly || item.parent_part;
              const hasChildren = node.children.length > 0;
              return (
                <tr
                  key={`${item.bom_item_id}-${idx}`}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => {
                    if (!parent) return;
                    onViewEntity(parent.master_id || parent.id, parent.revision_id);
                  }}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-left">
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
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 text-xs rounded bg-purple-50 text-purple-700">零部件</span>
                  </td>
                  <td className="px-3 py-2 font-medium">{parent?.code || '-'}</td>
                  <td className="px-3 py-2">{parent?.name || '-'}</td>
                  <td className="px-3 py-2 text-gray-500">{parent?.version || '-'}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 text-xs rounded ${statusCls(parent?.status || '')}`}>
                      {getStatusLabel(parent?.status || '-')}
                    </span>
                  </td>
                  <td className="px-3 py-2">{item.quantity}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

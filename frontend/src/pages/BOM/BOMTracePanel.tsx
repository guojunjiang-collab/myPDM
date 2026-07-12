import { useState, useEffect, useCallback, useRef } from 'react';
import { bomApi, partsApi } from '../../services/api';
import type { BOMTraceItem, PartListItem } from '../../types';
import { buildTraceTree, flattenTraceTree, getStatusLabel } from './helpers';
import type { TraceTreeNode } from './types';

interface BOMTracePanelProps {
  onViewEntity: (masterId: string, revisionId?: string) => void;
}

interface TraceSelection {
  masterId: string;
  revisionId: string;
  code: string;
  name: string;
  version?: string;
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

export default function BOMTracePanel({ onViewEntity }: BOMTracePanelProps) {
  const [traceSearch, setTraceSearch] = useState('');
  const [traceSearchResults, setTraceSearchResults] = useState<PartListItem[]>([]);
  const [traceSearchLoading, setTraceSearchLoading] = useState(false);
  const [selected, setSelected] = useState<TraceSelection | null>(null);
  const [traceResult, setTraceResult] = useState<BOMTraceItem[]>([]);
  const [traceSearched, setTraceSearched] = useState(false);
  const [traceError, setTraceError] = useState('');
  const traceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [traceTree, setTraceTree] = useState<TraceTreeNode[]>([]);
  const [loading, setLoading] = useState(false);

  // 搜索零部件（防抖）
  const handleTraceSearch = useCallback((query: string) => {
    setTraceSearch(query);
    if (traceDebounceRef.current) clearTimeout(traceDebounceRef.current);
    if (!query.trim()) {
      setTraceSearchResults([]);
      return;
    }
    traceDebounceRef.current = setTimeout(async () => {
      setTraceSearchLoading(true);
      try {
        const data = await partsApi.list({ search: query.trim(), page_size: 20 });
        setTraceSearchResults((data.items || []).slice(0, 20));
      } catch {
        setTraceSearchResults([]);
      } finally {
        setTraceSearchLoading(false);
      }
    }, 300);
  }, []);

  // 选择搜索结果 — 直接触发反查（按选中版本 revision）
  const selectTraceEntity = async (item: PartListItem) => {
    const sel: TraceSelection = {
      masterId: item.master_id,
      revisionId: item.revision_id,
      code: item.code,
      name: item.name,
      version: item.version,
    };
    setSelected(sel);
    setTraceSearch(`${item.code} - ${item.name}`);
    setTraceSearchResults([]);
    setLoading(true);
    setTraceError('');
    setTraceResult([]);
    setTraceSearched(false);
    try {
      const response = await bomApi.trace('component', sel.revisionId);
      setTraceResult(response.data || []);
      setTraceSearched(true);
    } catch (error) {
      console.error('反查失败', error);
      setTraceError('反查失败，请稍后重试');
      setTraceResult([]);
    } finally {
      setLoading(false);
    }
  };

  // 清除选择
  const clearTraceEntity = () => {
    setSelected(null);
    setTraceSearch('');
    setTraceSearchResults([]);
    setTraceResult([]);
    setTraceTree([]);
    setTraceSearched(false);
    setTraceError('');
  };

  // 从扁平结果构建树
  useEffect(() => {
    setTraceTree(buildTraceTree(traceResult));
  }, [traceResult]);

  // 展开/收起全部
  const toggleTraceAll = () => {
    const allExpanded = traceTree.length > 0 && traceTree.every((n) => n.expanded);
    setTraceTree((prev) => {
      const toggleAll = (nodes: TraceTreeNode[]): TraceTreeNode[] =>
        nodes.map((n) => ({
          ...n,
          expanded: !allExpanded,
          children: n.children.length > 0 ? toggleAll(n.children) : n.children,
        }));
      return toggleAll(prev);
    });
  };

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

  return (
    <div>
      {/* 搜索区域 */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 mb-4">
        <div className="text-sm font-medium text-gray-700 mb-2">
          通过件号或名称搜索零部件，反查使用了该零部件（选中版本）的上级装配
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="输入零部件件号或名称搜索..."
            value={traceSearch}
            onChange={(e) => handleTraceSearch(e.target.value)}
            className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {traceSearchLoading && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">搜索中...</span>
          )}
          {traceSearchResults.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-auto">
              {traceSearchResults.map((item) => (
                <button
                  key={item.revision_id}
                  type="button"
                  onClick={() => selectTraceEntity(item)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                >
                  <span className="font-medium">{item.code}</span>
                  <span className="text-gray-500 ml-2">{item.name}</span>
                  {item.version && <span className="text-gray-400 ml-2 text-xs">{item.version}</span>}
                  <span className={`ml-2 px-1.5 py-0.5 text-xs rounded ${statusCls(item.status)}`}>
                    {getStatusLabel(item.status)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {selected && (
          <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-blue-50 rounded-lg text-sm">
            {loading ? (
              <span className="text-gray-500">查询中...</span>
            ) : (
              <>
                <span className="text-gray-500">已选择：</span>
                <span className="font-medium">{selected.code}</span>
                <span className="text-gray-600">{selected.name}</span>
                {selected.version && <span className="text-gray-400">{selected.version}</span>}
              </>
            )}
            <button
              type="button"
              onClick={clearTraceEntity}
              className="ml-auto text-gray-400 hover:text-red-500 text-lg leading-none"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {traceError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
          {traceError}
        </div>
      )}

      {/* 空状态：尚未搜索 */}
      {!traceSearched && !traceError && traceResult.length === 0 && (
        <div className="text-center py-8 text-gray-400 bg-white rounded-lg border border-gray-200">
          请通过件号或名称搜索并选择要反查的零部件
        </div>
      )}

      {/* 空状态：已搜索但无结果 */}
      {traceSearched && traceResult.length === 0 && !traceError && (
        <div className="text-center py-8 text-gray-400 bg-white rounded-lg border border-gray-200">
          未找到任何引用该零部件（选中版本）的上级装配
        </div>
      )}

      {/* 反查结果树形表格 */}
      {traceResult.length > 0 && (
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
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">规格型号</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">版本</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">状态</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">用量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {/* 反查根节点 */}
                {selected && (
                  <tr
                    className="bg-gray-50 hover:bg-gray-100 cursor-pointer"
                    onClick={() => onViewEntity(selected.masterId, selected.revisionId)}
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-left">
                      <span className="inline-flex items-center gap-0.5">
                        <span className="text-xs text-gray-400">0</span>
                        {traceTree.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleTraceAll(); }}
                            className="w-4 h-4 inline-flex items-center justify-center text-gray-500 hover:bg-gray-200 rounded"
                          >
                            {traceTree.every((n) => n.expanded) ? '▼' : '▶'}
                          </button>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 text-xs rounded bg-purple-50 text-purple-700">零部件</span>
                    </td>
                    <td className="px-3 py-2 font-medium">{selected.code}</td>
                    <td className="px-3 py-2">{selected.name}</td>
                    <td className="px-3 py-2">-</td>
                    <td className="px-3 py-2">{selected.version || '-'}</td>
                    <td className="px-3 py-2">-</td>
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
                      <td className="px-3 py-2 text-gray-500">{parent?.spec || '-'}</td>
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
      )}
    </div>
  );
}

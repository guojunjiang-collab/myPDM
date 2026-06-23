import { useState, useEffect, useCallback, useRef } from 'react';
import { bomApi, partsApi, assembliesApi } from '../../services/api';
import type { BOMTraceItem } from '../../types';
import { buildTraceTree, flattenTraceTree } from './helpers';
import type { TraceTreeNode } from './types';

interface BOMTracePanelProps {
  onViewEntity: (type: 'part' | 'assembly', id: string) => void;
}

export default function BOMTracePanel({ onViewEntity }: BOMTracePanelProps) {
  // BOM 反查模式 — 全部状态归本组件管理
  const [traceType, setTraceType] = useState<'part' | 'assembly'>('part');
  const [traceSearch, setTraceSearch] = useState('');
  const [traceSearchResults, setTraceSearchResults] = useState<any[]>([]);
  const [traceSearchLoading, setTraceSearchLoading] = useState(false);
  const [selectedTraceEntity, setSelectedTraceEntity] = useState<{ id: string; code: string; name: string; version?: string } | null>(null);
  const [traceResult, setTraceResult] = useState<BOMTraceItem[]>([]);
  const [traceSearched, setTraceSearched] = useState(false);
  const [traceError, setTraceError] = useState('');
  const traceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [traceTree, setTraceTree] = useState<TraceTreeNode[]>([]);
  const [loading, setLoading] = useState(false);

  // 搜索零件/部件（防抖）
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
        const api = traceType === 'part' ? partsApi : assembliesApi;
        const response = await api.list({ search: query.trim() });
        const items = Array.isArray(response.data)
          ? response.data
          : (response.data.items || []);
        setTraceSearchResults(items.slice(0, 20));
      } catch {
        setTraceSearchResults([]);
      } finally {
        setTraceSearchLoading(false);
      }
    }, 300);
  }, [traceType]);

  // 选择搜索结果 — 直接触发反查
  const selectTraceEntity = async (entity: { id: string; code: string; name: string; version?: string }) => {
    setSelectedTraceEntity(entity);
    setTraceSearch(entity.code + ' - ' + entity.name);
    setTraceSearchResults([]);
    // 直接执行反查
    setLoading(true);
    setTraceError('');
    setTraceResult([]);
    setTraceSearched(false);
    try {
      const response = await bomApi.trace(traceType, entity.id);
      setTraceResult(response.data || []);
      setTraceSearched(true);
    } catch (error) {
      console.error('反查失败', error);
      setTraceError('反查失败，请检查ID是否正确');
      setTraceResult([]);
    } finally {
      setLoading(false);
    }
  };

  // 清除选择
  const clearTraceEntity = () => {
    setSelectedTraceEntity(null);
    setTraceSearch('');
    setTraceSearchResults([]);
    setTraceResult([]);
    setTraceTree([]);
    setTraceSearched(false);
    setTraceError('');
  };

  // 切换类型时清除搜索结果
  useEffect(() => {
    setSelectedTraceEntity(null);
    setTraceSearch('');
    setTraceSearchResults([]);
  }, [traceType]);

  // 从扁平结果构建树
  useEffect(() => {
    setTraceTree(buildTraceTree(traceResult));
  }, [traceResult]);

  // 展开/收起反查树节点
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

  return (
    <div>
      {/* 搜索区域 */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 mb-4">
        <div className="text-sm font-medium text-gray-700 mb-2">
          选择实体类型，通过件号或名称搜索
        </div>
        <div className="flex gap-2 items-center mb-2">
          <select
            value={traceType}
            onChange={(e) => setTraceType(e.target.value as 'part' | 'assembly')}
            className="px-3 py-2 border border-gray-300 rounded-lg"
          >
            <option value="part">零件</option>
            <option value="assembly">部件</option>
          </select>
          <div className="relative flex-1">
            <input
              type="text"
              placeholder={traceType === 'part' ? '输入零件件号或名称搜索...' : '输入部件件号或名称搜索...'}
              value={traceSearch}
              onChange={(e) => handleTraceSearch(e.target.value)}
              className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {traceSearchLoading && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">搜索中...</span>
            )}
            {/* 搜索结果下拉 */}
            {traceSearchResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-auto">
                {traceSearchResults.map((item: any) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectTraceEntity(item)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                  >
                    <span className="font-medium">{item.code}</span>
                    <span className="text-gray-500 ml-2">{item.name}</span>
                    {item.version && (
                      <span className="text-gray-400 ml-2 text-xs">{item.version}</span>
                    )}
                    <span className={`ml-2 px-1.5 py-0.5 text-xs rounded ${
                      item.status === 'released' ? 'bg-green-100 text-green-700' :
                      item.status === 'frozen' ? 'bg-orange-100 text-orange-700' :
                      item.status === 'obsolete' ? 'bg-red-100 text-red-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {(() => {
                        const m: Record<string, string> = { draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废' };
                        return m[item.status] || item.status;
                      })()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {selectedTraceEntity && (
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg text-sm">
            {loading ? (
              <span className="text-gray-500">查询中...</span>
            ) : (
              <>
                <span className="text-gray-500">已选择：</span>
                <span className="font-medium">{selectedTraceEntity.code}</span>
                <span className="text-gray-600">{selectedTraceEntity.name}</span>
                {selectedTraceEntity.version && <span className="text-gray-400">{selectedTraceEntity.version}</span>}
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
          请通过件号或名称搜索并选择要反查的{traceType === 'part' ? '零件' : '部件'}
        </div>
      )}

      {/* 空状态：已搜索但无结果 */}
      {traceSearched && traceResult.length === 0 && !traceError && (
        <div className="text-center py-8 text-gray-400 bg-white rounded-lg border border-gray-200">
          未找到任何引用该实体的上级部件
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
          <div className="overflow-auto max-h-96">
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
                {selectedTraceEntity && (
                  <tr className="bg-gray-50 hover:bg-gray-100 cursor-pointer"
                    onClick={() => onViewEntity(traceType, selectedTraceEntity.id)}>
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
                      <span className={`px-1.5 py-0.5 text-xs rounded ${traceType === 'part' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}`}>
                        {traceType === 'part' ? '零件' : '部件'}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium">{selectedTraceEntity.code}</td>
                    <td className="px-3 py-2">{selectedTraceEntity.name}</td>
                    <td className="px-3 py-2">-</td>
                    <td className="px-3 py-2">{selectedTraceEntity.version || '-'}</td>
                    <td className="px-3 py-2">-</td>
                    <td className="px-3 py-2">-</td>
                  </tr>
                )}
                {flattenTraceTree(traceTree).map((node, idx) => {
                  const item = node.item;
                  const parent = item.parent_assembly || item.parent_part;
                  const parentType = item.parent_assembly ? '部件' : '零件';
                  const parentTypeCls = item.parent_assembly
                    ? 'bg-green-50 text-green-700'
                    : 'bg-blue-50 text-blue-700';
                  const statusMap: Record<string, { label: string; cls: string }> = {
                    draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
                    frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
                    released: { label: '发布', cls: 'bg-green-100 text-green-800' },
                    obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
                  };
                  const st = statusMap[parent?.status || ''] || { label: parent?.status || '-', cls: 'bg-gray-100 text-gray-800' };
                  const hasChildren = node.children.length > 0;

                  return (
                    <tr
                      key={`${item.bom_item_id}-${idx}`}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => {
                        const parent = item.parent_assembly || item.parent_part;
                        if (!parent) return;
                        const type: 'part' | 'assembly' = item.parent_assembly ? 'assembly' : 'part';
                        onViewEntity(type, parent.id);
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
                        <span className={`px-1.5 py-0.5 text-xs rounded ${parentTypeCls}`}>
                          {parentType}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-medium">{parent?.code || '-'}</td>
                      <td className="px-3 py-2">{parent?.name || '-'}</td>
                      <td className="px-3 py-2 text-gray-500">{parent?.spec || '-'}</td>
                      <td className="px-3 py-2 text-gray-500">{parent?.version || '-'}</td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 text-xs rounded ${st.cls}`}>
                          {st.label}
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

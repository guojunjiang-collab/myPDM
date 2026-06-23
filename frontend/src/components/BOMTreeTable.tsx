import { useState, useEffect, useCallback } from 'react';
import type { AssemblyPartItem } from '../types';
import { assemblyPartsApi } from '../services/api';

interface BOMTreeTableProps {
  assemblyId: string;
  assemblyCode?: string;
  assemblyName?: string;
  maxHeight?: string;
  onRowClick?: (item: AssemblyPartItem) => void;
}

/** 递归树节点 */
interface TreeNode {
  item: AssemblyPartItem;
  level: number;
  children: TreeNode[];
  hasChildren: boolean;
  expanded: boolean;
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

export default function BOMTreeTable({ assemblyId, assemblyCode, assemblyName, maxHeight = 'max-h-[calc(100vh-300px)]', onRowClick }: BOMTreeTableProps) {
  const [viewParts, setViewParts] = useState<TreeNode[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loadingViewParts, setLoadingViewParts] = useState(false);
  const [viewSortField, setViewSortField] = useState<string | null>(null);
  const [viewSortDir, setViewSortDir] = useState<'asc' | 'desc' | null>(null);

  /** 加载子项树 */
  const loadViewParts = useCallback(async () => {
    setLoadingViewParts(true);
    try {
      const res = await assemblyPartsApi.list(assemblyId);
      const items: AssemblyPartItem[] = res.data || [];
      setViewParts(items.map((item) => ({
        item,
        level: 0,
        children: [],
        hasChildren: item.childType === 'component',
        expanded: expandedIds.has(item.id),
      })));
    } catch {
      setViewParts([]);
    } finally {
      setLoadingViewParts(false);
    }
  }, [assemblyId]);

  useEffect(() => {
    loadViewParts();
  }, [loadViewParts]);

  /** 递归展开子部件的子项 */
  const expandChildren = useCallback(async (node: TreeNode): Promise<TreeNode> => {
    if (node.item.childType !== 'component' || !node.item.child_detail) {
      return node;
    }
    try {
      const res = await assemblyPartsApi.list(node.item.child_detail.id);
      const childItems: AssemblyPartItem[] = res.data || [];
      const children: TreeNode[] = childItems.map((ci) => ({
        item: ci,
        level: node.level + 1,
        children: [],
        hasChildren: ci.childType === 'component',
        expanded: false,
      }));
      return { ...node, children };
    } catch {
      return node;
    }
  }, []);

  /** 展开/收起 */
  const toggleExpand = async (node: TreeNode) => {
    if (node.item.childType !== 'component') return;

    const nextExpanded = new Set(expandedIds);
    if (nextExpanded.has(node.item.id)) {
      nextExpanded.delete(node.item.id);
    } else {
      nextExpanded.add(node.item.id);
    }
    setExpandedIds(nextExpanded);

    if (nextExpanded.has(node.item.id)) {
      const expandedNode = await expandChildren(node);
      setViewParts((prev) => replaceNode(prev, node.item.id, expandedNode));
    } else {
      setViewParts((prev) => replaceNode(prev, node.item.id, { ...node, children: [] }));
    }
  };

  const replaceNode = (nodes: TreeNode[], targetId: string, replacement: TreeNode): TreeNode[] => {
    return nodes.map((n) => {
      if (n.item.id === targetId) return replacement;
      if (n.children.length > 0) {
        return { ...n, children: replaceNode(n.children, targetId, replacement) };
      }
      return n;
    });
  };

  /** 渲染扁平化的树行 */
  const flattenTree = (nodes: TreeNode[]): TreeNode[] => {
    const result: TreeNode[] = [];
    const walk = (list: TreeNode[]) => {
      for (const n of list) {
        result.push(n);
        if (n.children.length > 0) {
          walk(n.children);
        }
      }
    };
    walk(nodes);
    return result;
  };

  /** 详情子项排序 */
  const sortViewParts = useCallback((nodes: TreeNode[]): TreeNode[] => {
    if (!viewSortField || !viewSortDir) return nodes;
    return [...nodes].sort((a, b) => {
      let aVal: string = '';
      let bVal: string = '';
      const ad = a.item.child_detail;
      const bd = b.item.child_detail;
      if (viewSortField === 'type') { aVal = a.item.childType; bVal = b.item.childType; }
      else if (viewSortField === 'code') { aVal = ad?.code || ''; bVal = bd?.code || ''; }
      else if (viewSortField === 'version') { aVal = ad?.version || ''; bVal = bd?.version || ''; }
      else if (viewSortField === 'status') { aVal = ad?.status || ''; bVal = bd?.status || ''; }
      const cmp = aVal.localeCompare(bVal, 'zh-CN');
      return viewSortDir === 'desc' ? -cmp : cmp;
    });
  }, [viewSortField, viewSortDir]);

  const handleViewSort = (field: string) => {
    if (viewSortField === field) {
      if (viewSortDir === 'asc') setViewSortDir('desc');
      else if (viewSortDir === 'desc') { setViewSortField(null); setViewSortDir(null); }
    } else {
      setViewSortField(field);
      setViewSortDir('asc');
    }
  };

  const getViewSortIcon = (field: string): string => {
    if (viewSortField !== field) return '↕';
    if (viewSortDir === 'asc') return '↑';
    return '↓';
  };

  /** 渲染一行树节点 */
  const renderViewTreeNode = (node: TreeNode) => {
    const { item, level, children, hasChildren } = node;
    const rowClick = onRowClick ? () => onRowClick(item) : undefined;
    const dataCellCls = onRowClick ? 'cursor-pointer' : '';

    return (
      <tr key={item.id} className="hover:bg-gray-50">
        <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
          <span className="text-xs text-gray-400">{'-'.repeat(level + 1)}{level + 1}</span>
          {hasChildren && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleExpand(node); }}
                className="inline-flex items-center w-5 h-5 text-gray-400 hover:text-gray-600 ml-1"
              >
              {children.length > 0 ? '▼' : '▶'}
            </button>
          )}
        </td>
        <td className={`px-3 py-2 ${dataCellCls}`} onClick={rowClick}>
          <span className={`px-1.5 py-0.5 text-xs rounded ${
            item.childType === 'part' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'
          }`}>
            {item.childType === 'part' ? '零件' : '部件'}
          </span>
        </td>
        <td className={`px-3 py-2 font-medium ${dataCellCls}`} onClick={rowClick}>{item.child_detail?.code || '-'}</td>
        <td className={`px-3 py-2 ${dataCellCls}`} onClick={rowClick}>{item.child_detail?.name || '-'}</td>
        <td className={`px-3 py-2 text-gray-500 ${dataCellCls}`} onClick={rowClick}>{item.child_detail?.spec || '-'}</td>
        <td className={`px-3 py-2 text-gray-500 ${dataCellCls}`} onClick={rowClick}>{item.child_detail?.version || '-'}</td>
        <td className={`px-3 py-2 ${dataCellCls}`} onClick={rowClick}>
          <span className={`px-1.5 py-0.5 text-xs rounded ${statusTag(item.child_detail?.status || 'draft').cls}`}>
            {statusTag(item.child_detail?.status || 'draft').label}
          </span>
        </td>
        <td className={`px-3 py-2 ${dataCellCls}`} onClick={rowClick}>{item.quantity}</td>
      </tr>
    );
  };

  /** 渲染子项表格 */
  const renderViewPartsTable = () => {
    const sorted = sortViewParts(viewParts);
    const flatRows = flattenTree(sorted);
    const allExpanded = viewParts.length > 0 && viewParts.every((n) => n.expanded);
    const toggleAll = async () => {
      if (allExpanded) {
        const newNodes = viewParts.map((n) => ({ ...n, expanded: false, children: [] }));
        setExpandedIds(new Set());
        setViewParts(newNodes);
      } else {
        setExpandedIds(new Set(viewParts.map((n) => n.item.id)));
        const newNodes = await Promise.all(viewParts.map((n) => expandChildren({ ...n, expanded: true })));
        setViewParts(newNodes);
      }
    };
    return (
      <div className="border rounded-lg overflow-hidden mt-1">
        {loadingViewParts && flatRows.length === 0 && !assemblyCode ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">加载子项中...</div>
        ) : (
          <div className={`overflow-auto ${maxHeight}`}>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">层级</th>
                  <th onClick={() => handleViewSort('type')} className="px-3 py-2 text-left text-gray-500 font-medium w-24 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">类型 {getViewSortIcon('type')}</th>
                  <th onClick={() => handleViewSort('code')} className="px-3 py-2 text-left text-gray-500 font-medium cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">件号 {getViewSortIcon('code')}</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">中文名称</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">规格型号</th>
                  <th onClick={() => handleViewSort('version')} className="px-3 py-2 text-left text-gray-500 font-medium w-24 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">版本 {getViewSortIcon('version')}</th>
                  <th onClick={() => handleViewSort('status')} className="px-3 py-2 text-left text-gray-500 font-medium w-24 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap">状态 {getViewSortIcon('status')}</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">用量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {assemblyCode && (
                  <tr className="bg-gray-50 hover:bg-gray-100 cursor-pointer"
                    onClick={() => onRowClick?.({
                      id: assemblyId, childType: 'assembly', child_id: assemblyId,
                      child_detail: { code: assemblyCode, name: assemblyName || '', spec: '', version: '', status: 'draft' },
                      quantity: 1, unit: '', seq: 0,
                    } as unknown as AssemblyPartItem)}>
                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                      <span className="text-xs text-gray-400">0</span>
                      {flatRows.length > 0 && (
                        <button onClick={(e) => { e.stopPropagation(); toggleAll(); }}
                          className="inline-flex items-center w-5 h-5 text-gray-400 hover:text-gray-600 ml-1">
                          {allExpanded ? '▼' : '▶'}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 text-xs rounded bg-purple-50 text-purple-700">部件</span>
                    </td>
                    <td className="px-3 py-2 font-medium">{assemblyCode}</td>
                    <td className="px-3 py-2">{assemblyName || '-'}</td>
                    <td className="px-3 py-2">-</td>
                    <td className="px-3 py-2">-</td>
                    <td className="px-3 py-2">-</td>
                    <td className="px-3 py-2">1</td>
                  </tr>
                )}
                {flatRows.length === 0 && !loadingViewParts && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">暂无子项</td></tr>
                )}
                {flatRows.map(renderViewTreeNode)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {renderViewPartsTable()}
    </div>
  );
}

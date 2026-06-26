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
  const [noChildren, setNoChildren] = useState<Set<string>>(new Set());
  const [loadingViewParts, setLoadingViewParts] = useState(false);
  const [viewSortField, setViewSortField] = useState<string | null>(null);
  const [viewSortDir, setViewSortDir] = useState<'asc' | 'desc' | null>(null);

  /** 预查子项是否有孙项：并行请求，返回 nodes 和无子项 id 列表 */
  const preCheckChildren = useCallback(async (items: AssemblyPartItem[], level: number): Promise<{ nodes: TreeNode[]; noChildIds: string[] }> => {
    const nodes: TreeNode[] = items.map((item) => ({
      item, level, children: [], hasChildren: false, expanded: false,
    }));
    const compItems = items.filter((it) => it.childType === 'component' && it.child_detail?.id);
    if (compItems.length === 0) return { nodes, noChildIds: [] };
    const checks = await Promise.allSettled(
      compItems.map((it) => assemblyPartsApi.list(it.child_detail!.id))
    );
    const noChildIds: string[] = [];
    checks.forEach((c, i) => {
      if (c.status === 'fulfilled') {
        const grandchildren = (c.value.data || []) as any[];
        if (grandchildren.length > 0) {
          const node = nodes.find((n) => n.item.id === compItems[i].id);
          if (node) node.hasChildren = true;
        } else {
          noChildIds.push(compItems[i].id);
        }
      }
    });
    return { nodes, noChildIds };
  }, []);

  /** 加载子项树（含预查） */
  const loadViewParts = useCallback(async () => {
    setLoadingViewParts(true);
    try {
      const res = await assemblyPartsApi.list(assemblyId);
      const items: AssemblyPartItem[] = res.data || [];
      const { nodes, noChildIds } = await preCheckChildren(items, 0);
      if (noChildIds.length > 0) {
        setNoChildren(prev => { const s = new Set(prev); noChildIds.forEach(id => s.add(id)); return s; });
      }
      setViewParts(nodes);
    } catch {
      setViewParts([]);
    } finally {
      setLoadingViewParts(false);
    }
  }, [assemblyId, preCheckChildren]);

  useEffect(() => { loadViewParts(); }, [loadViewParts]);

  /** 递归展开子项（含预查孙项） */
  const expandChildren = useCallback(async (node: TreeNode): Promise<TreeNode> => {
    if (node.item.childType !== 'component' || !node.item.child_detail) return node;
    try {
      const res = await assemblyPartsApi.list(node.item.child_detail.id);
      const childItems: AssemblyPartItem[] = res.data || [];
      const { nodes, noChildIds } = await preCheckChildren(childItems, node.level + 1);
      if (noChildIds.length > 0) {
        setNoChildren(prev => { const s = new Set(prev); noChildIds.forEach(id => s.add(id)); return s; });
      }
      return { ...node, children: nodes, hasChildren: nodes.length > 0 };
    } catch {
      return node;
    }
  }, [preCheckChildren]);

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
      if (expandedNode.children.length === 0) {
        setNoChildren(prev => new Set(prev).add(node.item.id));
      }
      setViewParts((prev) => replaceNode(prev, node.item.id, expandedNode));
    } else {
      setViewParts((prev) => replaceNode(prev, node.item.id, { ...node, children: [] }));
    }
  };

  const replaceNode = (nodes: TreeNode[], targetId: string, replacement: TreeNode): TreeNode[] => {
    return nodes.map((n) => {
      if (n.item.id === targetId) return replacement;
      if (n.children.length > 0) return { ...n, children: replaceNode(n.children, targetId, replacement) };
      return n;
    });
  };

  const flattenTree = (nodes: TreeNode[]): TreeNode[] => {
    const result: TreeNode[] = [];
    const walk = (list: TreeNode[]) => {
      for (const n of list) {
        result.push(n);
        if (n.children.length > 0) walk(n.children);
      }
    };
    walk(nodes);
    return result;
  };

  const sortViewParts = useCallback((nodes: TreeNode[]): TreeNode[] => {
    if (!viewSortField || !viewSortDir) return nodes;
    return [...nodes].sort((a, b) => {
      let aVal = '', bVal = '';
      const ad = a.item.child_detail, bd = b.item.child_detail;
      if (viewSortField === 'code') { aVal = ad?.code || ''; bVal = bd?.code || ''; }
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
    } else { setViewSortField(field); setViewSortDir('asc'); }
  };

  const getViewSortIcon = (field: string): string => {
    if (viewSortField !== field) return '\u2195';
    return viewSortDir === 'asc' ? '\u2191' : '\u2193';
  };

  const renderViewTreeNode = (node: TreeNode) => {
    const { item, level, children, hasChildren } = node;
    const rowClick = onRowClick ? () => onRowClick(item) : undefined;
    const dataCellCls = onRowClick ? 'cursor-pointer' : '';
    return (
      <tr key={item.id} className="hover:bg-gray-50">
        <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
          <span className="text-xs text-gray-400">{'-'.repeat(level + 1)}{level + 1}</span>
          {hasChildren && !noChildren.has(item.id) && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleExpand(node); }}
              className="inline-flex items-center w-5 h-5 text-gray-400 hover:text-gray-600 ml-1"
            >
              {children.length > 0 ? '\u25BC' : '\u25B6'}
            </button>
          )}
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
                          {allExpanded ? '\u25BC' : '\u25B6'}
                        </button>
                      )}
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
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">暂无子项</td></tr>
                )}
                {flatRows.map(renderViewTreeNode)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return <div>{renderViewPartsTable()}</div>;
}

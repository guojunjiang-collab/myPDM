import { useState, useEffect, useCallback } from 'react';
import type { AssemblyPartItem } from '../types';
import { partsApi } from '../services/api';

interface BOMTreeTableProps {
  /** 根版本 revision_id */
  revisionId: string;
  assemblyCode?: string;
  assemblyName?: string;
  /** 根节点 master_id（用于根行点击打开详情） */
  rootMasterId?: string;
  maxHeight?: string;
  onRowClick?: (item: AssemblyPartItem) => void;
}

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

/** 把 partsApi.getBOM 返回的扁平子项映射为 AssemblyPartItem */
const toAssemblyPartItem = (c: any): AssemblyPartItem => ({
  id: c.id,
  childType: c.child_type === 'assembly' ? 'component' : 'part',
  child_id: c.child_master_id,
  child_master_id: c.child_master_id,
  child_revision_id: c.child_revision_id,
  componentId: null,
  partId: null,
  quantity: c.quantity,
  created_at: '',
  child_detail: {
    id: c.child_master_id,
    code: c.child_code,
    name: c.child_name,
    spec: c.child_spec,
    version: c.child_version,
    status: c.child_status,
  },
});

export default function BOMTreeTable({ revisionId, assemblyCode, assemblyName, rootMasterId, maxHeight = 'max-h-[calc(100vh-300px)]', onRowClick }: BOMTreeTableProps) {
  const [viewParts, setViewParts] = useState<TreeNode[]>([]);
  const [loadingViewParts, setLoadingViewParts] = useState(false);
  const [viewSortField, setViewSortField] = useState<string | null>(null);
  const [viewSortDir, setViewSortDir] = useState<'asc' | 'desc' | null>(null);

  const mapChildren = (rows: any[], level: number): TreeNode[] =>
    (rows || []).map((c) => ({
      item: toAssemblyPartItem(c),
      level,
      children: [],
      hasChildren: !!c.has_children,
      expanded: false,
    }));

  const loadViewParts = useCallback(async () => {
    if (!revisionId) return;
    setLoadingViewParts(true);
    try {
      const rows = await partsApi.getBOM(revisionId);
      setViewParts(mapChildren(rows as any[], 0));
    } catch {
      setViewParts([]);
    } finally {
      setLoadingViewParts(false);
    }
  }, [revisionId]);

  useEffect(() => { loadViewParts(); }, [loadViewParts]);

  const replaceNode = (nodes: TreeNode[], targetId: string, replacement: TreeNode): TreeNode[] =>
    nodes.map((n) => {
      if (n.item.id === targetId) return replacement;
      if (n.children.length > 0) return { ...n, children: replaceNode(n.children, targetId, replacement) };
      return n;
    });

  const toggleExpand = async (node: TreeNode) => {
    if (!node.hasChildren) return;
    if (node.expanded) {
      setViewParts((prev) => replaceNode(prev, node.item.id, { ...node, expanded: false, children: [] }));
      return;
    }
    try {
      const rows = await partsApi.getBOM(node.item.child_revision_id || '');
      setViewParts((prev) => replaceNode(prev, node.item.id, { ...node, expanded: true, children: mapChildren(rows as any[], node.level + 1) }));
    } catch { /* ignore */ }
  };

  const flattenTree = (nodes: TreeNode[]): TreeNode[] => {
    const result: TreeNode[] = [];
    const walk = (list: TreeNode[]) => {
      for (const n of list) {
        result.push(n);
        if (n.expanded && n.children.length > 0) walk(n.children);
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
    const { item, level, hasChildren } = node;
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
              {node.expanded ? '\u25BC' : '\u25B6'}
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
        setViewParts(viewParts.map((n) => ({ ...n, expanded: false, children: [] })));
      } else {
        const newNodes = await Promise.all(viewParts.map(async (n) => {
          if (!n.hasChildren) return { ...n, expanded: true };
          try {
            const rows = await partsApi.getBOM(n.item.child_revision_id || '');
            return { ...n, expanded: true, children: mapChildren(rows as any[], n.level + 1) };
          } catch { return { ...n, expanded: true }; }
        }));
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
                      id: revisionId, childType: 'component', child_id: rootMasterId || revisionId,
                      child_master_id: rootMasterId, child_revision_id: revisionId,
                      componentId: null, partId: null,
                      child_detail: { id: rootMasterId || '', code: assemblyCode, name: assemblyName || '', spec: '', version: '', status: 'draft' },
                      quantity: 1, created_at: '',
                    })}>
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

import { useState, useEffect, useCallback } from 'react';
import type { Assembly, CustomFieldDefinition, AssemblyPartItem } from '../types';
import { formatDateTime } from '../utils/date';
import EntityDocumentSection from './EntityDocumentSection';
import { assemblyPartsApi } from '../services/api';

interface AssemblyDetailContentProps {
  assembly: Assembly;
  customFieldDefs: CustomFieldDefinition[];
  customFieldValues: Record<string, unknown>;
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

export default function AssemblyDetailContent({ assembly, customFieldDefs, customFieldValues }: AssemblyDetailContentProps) {
  const [viewParts, setViewParts] = useState<TreeNode[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loadingViewParts, setLoadingViewParts] = useState(false);
  const [viewSortField, setViewSortField] = useState<string | null>(null);
  const [viewSortDir, setViewSortDir] = useState<'asc' | 'desc' | null>(null);

  /** 加载子项树 */
  const loadViewParts = useCallback(async () => {
    setLoadingViewParts(true);
    try {
      const res = await assemblyPartsApi.list(assembly.id);
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
  }, [assembly.id]);

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

    return (
      <tr key={item.id} className="hover:bg-gray-50">
        <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
          <span className="text-xs text-gray-400">L{level + 1}</span>
          {hasChildren && (
            <button
              onClick={() => toggleExpand(node)}
              className="inline-flex items-center w-5 h-5 text-gray-400 hover:text-gray-600 ml-1"
            >
              {children.length > 0 ? '▼' : '▶'}
            </button>
          )}
        </td>
        <td className="px-3 py-2">
          <span className={`px-1.5 py-0.5 text-xs rounded ${
            item.childType === 'part' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'
          }`}>
            {item.childType === 'part' ? '零件' : '部件'}
          </span>
        </td>
        <td className="px-3 py-2 font-medium">{item.child_detail?.code || '-'}</td>
        <td className="px-3 py-2">{item.child_detail?.name || '-'}</td>
        <td className="px-3 py-2 text-gray-500">{item.child_detail?.spec || '-'}</td>
        <td className="px-3 py-2 text-gray-500">{item.child_detail?.version || '-'}</td>
        <td className="px-3 py-2">
          <span className={`px-1.5 py-0.5 text-xs rounded ${statusTag(item.child_detail?.status || 'draft').cls}`}>
            {statusTag(item.child_detail?.status || 'draft').label}
          </span>
        </td>
        <td className="px-3 py-2">{item.quantity}</td>
      </tr>
    );
  };

  /** 渲染子项表格 */
  const renderViewPartsTable = () => {
    const sorted = sortViewParts(viewParts);
    const flatRows = flattenTree(sorted);
    return (
      <div className="border rounded-lg overflow-hidden mt-1">
        {loadingViewParts && flatRows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">加载子项中...</div>
        ) : flatRows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">暂无子项</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">层级</th>
                  <th onClick={() => handleViewSort('type')} className="px-3 py-2 text-left text-gray-500 font-medium w-16 cursor-pointer hover:text-gray-700 select-none">类型 {getViewSortIcon('type')}</th>
                  <th onClick={() => handleViewSort('code')} className="px-3 py-2 text-left text-gray-500 font-medium cursor-pointer hover:text-gray-700 select-none">件号 {getViewSortIcon('code')}</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">中文名称</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">规格型号</th>
                  <th onClick={() => handleViewSort('version')} className="px-3 py-2 text-left text-gray-500 font-medium w-16 cursor-pointer hover:text-gray-700 select-none">版本 {getViewSortIcon('version')}</th>
                  <th onClick={() => handleViewSort('status')} className="px-3 py-2 text-left text-gray-500 font-medium w-16 cursor-pointer hover:text-gray-700 select-none">状态 {getViewSortIcon('status')}</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">用量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {flatRows.map(renderViewTreeNode)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* 基本属性 */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">件号</label>
          <div className="text-sm font-medium">{assembly.code}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">中文名称</label>
          <div className="text-sm">{assembly.name}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">规格型号</label>
          <div className="text-sm">{assembly.spec || '-'}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">版本</label>
          <div className="text-sm">{assembly.version || '-'}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">状态</label>
          <span className={`inline-block px-2 py-1 text-xs rounded-full ${statusTag(assembly.status).cls}`}>
            {statusTag(assembly.status).label}
          </span>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">备注</label>
          <div className="text-sm">{assembly.remark || '-'}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">创建时间</label>
          <div className="text-sm">{formatDateTime(assembly.created_at)}</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">更新时间</label>
          <div className="text-sm">{formatDateTime(assembly.updated_at)}</div>
        </div>
      </div>

      {/* 自定义字段 */}
      {customFieldDefs.length > 0 && (
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium text-gray-700 mb-3">自定义字段</h4>
          <div className="grid grid-cols-2 gap-4">
            {customFieldDefs.map(def => (
              <div key={def.id}>
                <label className="block text-xs font-medium text-gray-500 mb-1">{def.name}</label>
                <div className="text-sm">
                  {def.field_type === 'select'
                    ? String(
                        (def.options || []).find((o) => o === customFieldValues[def.id]) ||
                          customFieldValues[def.id] ||
                          '-',
                      )
                    : Array.isArray(customFieldValues[def.id])
                      ? ((customFieldValues[def.id] as string[]).join(', ') || '-')
                      : String(customFieldValues[def.id] ?? '-')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 关联图文档 */}
      <EntityDocumentSection entityType="assembly" entityId={assembly.id} editable={false} />

      {/* 子项清单 */}
      <div className="border-t pt-4">
        <h4 className="text-sm font-medium text-gray-700 mb-2">子项清单</h4>
        {renderViewPartsTable()}
      </div>
    </div>
  );
}
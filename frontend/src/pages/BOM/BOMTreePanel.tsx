import { useState, useRef, useCallback } from 'react';
import { partsApi } from '../../services/api';
import type { PartListItem } from '../../types';
import { getStatusLabel } from './helpers';

interface BOMTreePanelProps {
  onViewEntity: (masterId: string, revisionId?: string) => void;
}

/** partsApi.getBOM 返回的子项结构 */
interface BomChild {
  id: string;
  child_master_id: string;
  child_revision_id: string;
  child_code: string;
  child_name: string;
  child_spec: string;
  child_version: string;
  child_status: string;
  child_type: string;
  has_children: boolean;
  quantity: number;
}

interface TreeNode {
  item: BomChild;
  level: number;
  children: TreeNode[];
  expanded: boolean;
  hasChildren: boolean;
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

export default function BOMTreePanel({ onViewEntity }: BOMTreePanelProps) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PartListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PartListItem | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = (query: string) => {
    setSearch(query);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await partsApi.list({ search: query.trim(), page_size: 20 });
        setResults((data.items || []).slice(0, 20));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const mapChildren = (rows: BomChild[], level: number): TreeNode[] =>
    rows.map((r) => ({ item: r, level, children: [], expanded: false, hasChildren: !!r.has_children }));

  const selectPart = async (p: PartListItem) => {
    setSelected(p);
    setSearch(`${p.code} - ${p.name}`);
    setResults([]);
    setTree([]);
    setLoading(true);
    try {
      const rows = await partsApi.getBOM(p.revision_id);
      setTree(mapChildren(rows as BomChild[], 0));
    } catch {
      setTree([]);
    } finally {
      setLoading(false);
    }
  };

  const clearSelection = () => {
    setSelected(null);
    setSearch('');
    setResults([]);
    setTree([]);
  };

  /** 用替换后的节点更新树 */
  const replaceNode = (nodes: TreeNode[], targetId: string, replacement: TreeNode): TreeNode[] =>
    nodes.map((n) => {
      if (n.item.id === targetId) return replacement;
      if (n.children.length > 0) return { ...n, children: replaceNode(n.children, targetId, replacement) };
      return n;
    });

  const toggleNode = async (node: TreeNode) => {
    if (!node.hasChildren) return;
    if (node.expanded) {
      setTree((prev) => replaceNode(prev, node.item.id, { ...node, expanded: false, children: [] }));
      return;
    }
    try {
      const rows = await partsApi.getBOM(node.item.child_revision_id);
      setTree((prev) =>
        replaceNode(prev, node.item.id, {
          ...node,
          expanded: true,
          children: mapChildren(rows as BomChild[], node.level + 1),
        }),
      );
    } catch {
      /* ignore */
    }
  };

  const flatten = useCallback((nodes: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    const walk = (list: TreeNode[]) => {
      for (const n of list) {
        out.push(n);
        if (n.expanded && n.children.length > 0) walk(n.children);
      }
    };
    walk(nodes);
    return out;
  }, []);

  const flatRows = flatten(tree);

  return (
    <div>
      {/* 搜索区域 */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 mb-4">
        <div className="relative">
          <input
            type="text"
            placeholder="输入零部件件号或名称搜索..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {searching && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">搜索中...</span>
          )}
          {results.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-auto">
              {results.map((item) => (
                <button
                  key={item.revision_id}
                  type="button"
                  onClick={() => selectPart(item)}
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
            <span className="text-gray-500">已选择：</span>
            <span className="font-medium">{selected.code}</span>
            <span className="text-gray-600">{selected.name}</span>
            {selected.version && <span className="text-gray-400">{selected.version}</span>}
            <button
              type="button"
              onClick={clearSelection}
              className="ml-auto text-gray-400 hover:text-red-500 text-lg leading-none"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {!selected ? (
        <div className="text-center py-8 text-gray-400 bg-white rounded-lg border border-gray-200">
          请搜索并选择一个零部件查看 BOM 树
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-white">
          <div className="overflow-auto max-h-[calc(100vh-320px)]">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-24">层级</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">件号</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">规格型号</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-24">版本</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-24">状态</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">用量</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {/* 根节点 */}
                <tr
                  className="bg-gray-50 hover:bg-gray-100 cursor-pointer"
                  onClick={() => onViewEntity(selected.master_id, selected.revision_id)}
                >
                  <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                    <span className="text-xs text-gray-400">0</span>
                  </td>
                  <td className="px-3 py-2 font-medium">{selected.code}</td>
                  <td className="px-3 py-2">{selected.name}</td>
                  <td className="px-3 py-2 text-gray-500">{selected.spec || '-'}</td>
                  <td className="px-3 py-2 text-gray-500">{selected.version || '-'}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 text-xs rounded ${statusCls(selected.status)}`}>
                      {getStatusLabel(selected.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2">1</td>
                </tr>
                {loading && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">加载子项中...</td>
                  </tr>
                )}
                {!loading && flatRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">暂无子项</td>
                  </tr>
                )}
                {flatRows.map((node) => {
                  const it = node.item;
                  return (
                    <tr key={it.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                        <span className="text-xs text-gray-400">{'-'.repeat(node.level + 1)}{node.level + 1}</span>
                        {node.hasChildren && (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleNode(node); }}
                            className="inline-flex items-center w-5 h-5 text-gray-400 hover:text-gray-600 ml-1"
                          >
                            {node.expanded ? '\u25BC' : '\u25B6'}
                          </button>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 font-medium cursor-pointer"
                        onClick={() => onViewEntity(it.child_master_id, it.child_revision_id)}
                      >
                        {it.child_code || '-'}
                      </td>
                      <td
                        className="px-3 py-2 cursor-pointer"
                        onClick={() => onViewEntity(it.child_master_id, it.child_revision_id)}
                      >
                        {it.child_name || '-'}
                      </td>
                      <td className="px-3 py-2 text-gray-500">{it.child_spec || '-'}</td>
                      <td className="px-3 py-2 text-gray-500">{it.child_version || '-'}</td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 text-xs rounded ${statusCls(it.child_status)}`}>
                          {getStatusLabel(it.child_status)}
                        </span>
                      </td>
                      <td className="px-3 py-2">{it.quantity}</td>
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

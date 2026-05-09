import { useState, useEffect, useCallback, useRef } from 'react';
import { bomApi, assembliesApi, partsApi, customFieldsApi } from '../services/api';
import { useDataStore } from '../stores/data';
import type { BOMCompareNode, BOMCompareResponse, BOMTraceItem, CustomFieldDefinition, CustomFieldValue } from '../types';
import BOMTreeTable from '../components/BOMTreeTable';
import { Modal } from '../components/Modal';
import PartDetailContent from '../components/PartDetailContent';
import AssemblyDetailContent from '../components/AssemblyDetailContent';

interface SelectOption {
  id: string;
  code: string;
  name: string;
}

interface TraceTreeNode {
  item: BOMTraceItem;
  level: number;
  children: TraceTreeNode[];
  expanded: boolean;
}

function getChangeLabel(node: BOMCompareNode): string {
  const { change_type, left, right } = node;
  switch (change_type) {
    case 'none':
      return '无变更';
    case 'add':
      return '新增';
    case 'delete':
      return '删除';
    case 'internal':
      return '内部变更';
    case 'modify': {
      const parts: string[] = [];
      if (left && right) {
        if (left.detail.version !== right.detail.version) {
          parts.push(`版本变更 ${left.detail.version}→${right.detail.version}`);
        }
        if (left.quantity !== right.quantity) {
          parts.push(`数量变更 ${left.quantity}→${right.quantity}`);
        }
        if (left.detail.spec !== right.detail.spec) {
          parts.push(`规格变更 ${left.detail.spec || '-'}→${right.detail.spec || '-'}`);
        }
      }
      return parts.length > 0 ? parts.join('，') : '已修改';
    }
    default:
      return change_type;
  }
}

function getRowBgClass(changeType: string): string {
  switch (changeType) {
    case 'add': return 'bg-green-50';
    case 'delete': return 'bg-red-50';
    case 'modify': return 'bg-yellow-50';
    case 'internal': return 'bg-orange-50';
    default: return '';
  }
}

function getStatusLabel(status: string): string {
  const m: Record<string, string> = { draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废' };
  return m[status] || status;
}

function buildTraceTree(items: BOMTraceItem[]): TraceTreeNode[] {
  const roots: TraceTreeNode[] = [];
  const stack: TraceTreeNode[] = [];
  for (const item of items) {
    const node: TraceTreeNode = { item, level: item.level, children: [], expanded: true };
    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
      stack.pop();
    }
    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
  }
  return roots;
}

function flattenTraceTree(nodes: TraceTreeNode[]): TraceTreeNode[] {
  const result: TraceTreeNode[] = [];
  for (const n of nodes) {
    result.push(n);
    if (n.expanded && n.children.length > 0) {
      result.push(...flattenTraceTree(n.children));
    }
  }
  return result;
}

export default function BOM() {
  const [mode, setMode] = useState<'tree' | 'compare' | 'trace'>('tree');

  // BOM 树模式
  const [assemblies, setAssemblies] = useState<SelectOption[]>([]);
  const [selectedAssembly, setSelectedAssembly] = useState('');
  const [loading, setLoading] = useState(false);
  const [treeSearch, setTreeSearch] = useState('');
  const [treeSearchResults, setTreeSearchResults] = useState<any[]>([]);
  const [treeSearchLoading, setTreeSearchLoading] = useState(false);
  const treeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // BOM 对比模式
  const [compareLeft, setCompareLeft] = useState<SelectOption | null>(null);
  const [compareRight, setCompareRight] = useState<SelectOption | null>(null);
  const [compareResult, setCompareResult] = useState<BOMCompareResponse | null>(null);
  const [splitRatio, setSplitRatio] = useState(50);
  const dragStateRef = useRef<{ startX: number; startRatio: number } | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  // Compare search bars
  const [compareLeftSearch, setCompareLeftSearch] = useState('');
  const [compareLeftResults, setCompareLeftResults] = useState<any[]>([]);
  const [compareLeftSearchLoading, setCompareLeftSearchLoading] = useState(false);
  const cmpLeftDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [compareRightSearch, setCompareRightSearch] = useState('');
  const [compareRightResults, setCompareRightResults] = useState<any[]>([]);
  const [compareRightSearchLoading, setCompareRightSearchLoading] = useState(false);
  const cmpRightDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 行点击弹窗详情
  const [detailEntity, setDetailEntity] = useState<{ type: 'part' | 'assembly'; id: string } | null>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailCustomDefs, setDetailCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [detailCustomValues, setDetailCustomValues] = useState<Record<string, any>>({});

  // BOM 反查模式
  const [traceType, setTraceType] = useState<'part' | 'assembly'>('part');
  const [traceSearch, setTraceSearch] = useState('');
  const [traceSearchResults, setTraceSearchResults] = useState<any[]>([]);
  const [traceSearchLoading, setTraceSearchLoading] = useState(false);
  const [selectedTraceEntity, setSelectedTraceEntity] = useState<{ id: string; code: string; name: string } | null>(null);
  const [traceResult, setTraceResult] = useState<BOMTraceItem[]>([]);
  const [traceSearched, setTraceSearched] = useState(false);
  const [traceError, setTraceError] = useState('');
  const traceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [traceTree, setTraceTree] = useState<TraceTreeNode[]>([]);

  // 加载部件列表用于选择
  useEffect(() => {
    loadAssemblies();
  }, []);

  const loadAssemblies = async () => {
    try {
      const response = await assembliesApi.list();
      const items = Array.isArray(response.data)
        ? response.data
        : (response.data.items || []);
      // 只显示草稿/冻结/发布状态的部件（排除作废）
      const filtered = items.filter((a: { status?: string }) =>
        a.status !== 'obsolete'
      );
      setAssemblies(filtered.map((a: { id: string; code: string; name: string }) => ({
        id: a.id,
        code: a.code,
        name: a.name,
      })));
    } catch (error) {
      console.error('加载部件失败', error);
    }
  };

  // 通用装配体搜索（防抖），被 Tree 和 Compare 共用
  const searchAssemblies = useCallback((
    query: string,
    setSearch: (v: string) => void,
    setResults: (v: any[]) => void,
    setLoading: (v: boolean) => void,
    debounceRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
  ) => {
    setSearch(query);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await assembliesApi.list({ search: query.trim() });
        const items = Array.isArray(response.data) ? response.data : (response.data.items || []);
        setResults(items.slice(0, 20));
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 300);
  }, []);

  // 执行 BOM 对比
  const handleCompare = async () => {
    if (!compareLeft || !compareRight) return;
    setLoading(true);
    try {
      const response = await bomApi.compare(compareLeft.id, compareRight.id);
      setCompareResult(response.data);
    } catch (error) {
      setCompareResult(null);
      alert('对比失败: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // 拖拽分隔线处理
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStateRef.current = { startX: e.clientX, startRatio: splitRatio };
  }, [splitRatio]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStateRef.current || !tableContainerRef.current) return;
      const { startX, startRatio } = dragStateRef.current;
      const rect = tableContainerRef.current.getBoundingClientRect();
      const dx = e.clientX - startX;
      const newRatio = startRatio + (dx / rect.width) * 100;
      setSplitRatio(Math.max(20, Math.min(80, newRatio)));
    };

    const handleMouseUp = () => {
      dragStateRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // 行点击：弹出实体详情 Modal
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
  const selectTraceEntity = async (entity: { id: string; code: string; name: string }) => {
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
  const toggleTraceNode = (target: TraceTreeNode) => {
    const toggle = (nodes: TraceTreeNode[]): TraceTreeNode[] =>
      nodes.map(n => {
        if (n === target) return { ...n, expanded: !n.expanded };
        if (n.children.length > 0) return { ...n, children: toggle(n.children) };
        return n;
      });
    setTraceTree(toggle(traceTree));
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">BOM 管理</h2>

      {/* 模式切换 */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setMode('tree')}
          className={`px-4 py-2 rounded-lg ${
            mode === 'tree'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          BOM 树
        </button>
        <button
          onClick={() => setMode('compare')}
          className={`px-4 py-2 rounded-lg ${
            mode === 'compare'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          BOM 对比
        </button>
        <button
          onClick={() => setMode('trace')}
          className={`px-4 py-2 rounded-lg ${
            mode === 'trace'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          BOM 反查
        </button>
      </div>

      {/* BOM 树模式 */}
      {mode === 'tree' && (
        <div>
          <div className="bg-white p-4 rounded-lg border border-gray-200 mb-4">
            <div className="relative">
              <input
                type="text"
                placeholder="输入部件件号或名称搜索..."
                value={treeSearch}
                onChange={(e) => searchAssemblies(e.target.value, setTreeSearch, setTreeSearchResults, setTreeSearchLoading, treeDebounceRef)}
                className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              {treeSearchLoading && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">搜索中...</span>
              )}
              {treeSearchResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-auto">
                  {treeSearchResults.map((item: any) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSelectedAssembly(item.id);
                        setTreeSearch(item.code + ' - ' + item.name);
                        setTreeSearchResults([]);
                      }}
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
          {selectedAssembly ? (
            <BOMTreeTable assemblyId={selectedAssembly} onRowClick={(item) => handleViewEntity(item.childType === 'part' ? 'part' : 'assembly', item.child_id)} />
          ) : (
            <div className="text-center py-8 text-gray-400 bg-white rounded-lg border border-gray-200">
              请选择一个部件查看 BOM 树
            </div>
          )}
        </div>
      )}

      {/* BOM 对比模式 */}
      {mode === 'compare' && (
        <div>
          <div className="bg-white p-4 rounded-lg border border-gray-200 mb-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">左侧部件</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="输入部件件号或名称搜索..."
                    value={compareLeftSearch}
                    onChange={(e) => searchAssemblies(e.target.value, setCompareLeftSearch, setCompareLeftResults, setCompareLeftSearchLoading, cmpLeftDebounceRef)}
                    className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  {compareLeftSearchLoading && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">搜索中...</span>
                  )}
                  {compareLeftResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-auto">
                      {compareLeftResults.map((item: any) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setCompareLeft({ id: item.id, code: item.code, name: item.name });
                            setCompareLeftSearch(item.code + ' - ' + item.name);
                            setCompareLeftResults([]);
                          }}
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">右侧部件</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="输入部件件号或名称搜索..."
                    value={compareRightSearch}
                    onChange={(e) => searchAssemblies(e.target.value, setCompareRightSearch, setCompareRightResults, setCompareRightSearchLoading, cmpRightDebounceRef)}
                    className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  {compareRightSearchLoading && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">搜索中...</span>
                  )}
                  {compareRightResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-auto">
                      {compareRightResults.map((item: any) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setCompareRight({ id: item.id, code: item.code, name: item.name });
                            setCompareRightSearch(item.code + ' - ' + item.name);
                            setCompareRightResults([]);
                          }}
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
            </div>
            <button
              onClick={handleCompare}
              disabled={!compareLeft || !compareRight || loading}
              className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              开始对比
            </button>
          </div>

          {compareResult && compareResult.comparison.length > 0 && (
            <div>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div className="p-2 bg-blue-50 rounded text-sm">
                  部件A: {compareResult.left_assembly.code} - {compareResult.left_assembly.name} (版本: {compareResult.left_assembly.version})
                </div>
                <div className="p-2 bg-blue-50 rounded text-sm">
                  部件B: {compareResult.right_assembly.code} - {compareResult.right_assembly.name} (版本: {compareResult.right_assembly.version})
                </div>
              </div>

              <div className="flex gap-3 mb-4 p-3 bg-gray-50 rounded-lg border">
                {(() => {
                  const items = compareResult.comparison;
                  const added = items.filter((n: BOMCompareNode) => n.change_type === 'add').length;
                  const deleted = items.filter((n: BOMCompareNode) => n.change_type === 'delete').length;
                  const modified = items.filter((n: BOMCompareNode) => n.change_type === 'modify').length;
                  const unchanged = items.filter((n: BOMCompareNode) => n.change_type === 'none').length;
                  return (
                    <>
                      <span>直接子项共 {items.length} 项</span>
                      <span className="text-green-600 font-medium">新增 {added}</span>
                      <span className="text-red-600 font-medium">删除 {deleted}</span>
                      <span className="text-yellow-600 font-medium">修改 {modified}</span>
                      <span className="text-gray-500">无变化 {unchanged}</span>
                    </>
                  );
                })()}
              </div>

              <div
                ref={tableContainerRef}
                className="border rounded-lg overflow-auto max-h-[70vh]"
                style={{ userSelect: dragStateRef.current ? 'none' : undefined }}
              >
                {(() => {
                  // 动态列宽：左右区域按 splitRatio 分配，分隔线固定约 6px
                  const DIVIDER_PCT = 0.5; // 分隔线占总宽度百分比
                  const CHANGE_PCT = 9;    // 变更信息列占总宽度百分比
                  const leftPct = splitRatio;
                  const rightPct = 100 - splitRatio - DIVIDER_PCT * 2 - CHANGE_PCT;
                  const leftCols = [6, 8, 22, 26, 10, 10, 10, 8]; // 层级 类型 件号 名称 规格 版本 状态 用量
                  const rightCols = [10, 24, 28, 10, 10, 10, 8];  // 类型 件号 名称 规格 版本 状态 用量
                  const lTotal = leftCols.reduce((s, w) => s + w, 0);
                  const rTotal = rightCols.reduce((s, w) => s + w, 0);

                  return (
                <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                  <colgroup>
                    {leftCols.map((w, i) => (
                      <col key={`l${i}`} style={{ width: (w / lTotal * leftPct) + '%' }} />
                    ))}
                    <col style={{ width: DIVIDER_PCT + '%' }} />
                    {rightCols.map((w, i) => (
                      <col key={`r${i}`} style={{ width: (w / rTotal * rightPct) + '%' }} />
                    ))}
                    <col style={{ width: DIVIDER_PCT + '%' }} />
                    <col style={{ width: CHANGE_PCT + '%' }} />
                  </colgroup>
                  <thead>
                    <tr className="bg-gray-50 text-xs font-medium text-gray-600 border-b">
                      <th colSpan={8} className="px-2 py-2 text-left border-r border-gray-200">部件A</th>
                      <th
                        className="relative bg-gray-200 p-0 cursor-col-resize select-none"
                        onMouseDown={handleDragStart}
                      >
                        <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 bg-gray-400 rounded" />
                      </th>
                      <th colSpan={7} className="px-2 py-2 text-left">部件B</th>
                      <th className="w-px bg-gray-300 p-0" />
                      <th className="px-2 py-2 text-left">变更信息</th>
                    </tr>
                    <tr className="bg-gray-50 text-xs font-medium text-gray-500 border-b">
                      <th className="px-2 py-1 text-left">层级</th>
                      <th className="px-2 py-1 text-left">类型</th>
                      <th className="px-2 py-1 text-left">件号</th>
                      <th className="px-2 py-1 text-left">名称</th>
                      <th className="px-2 py-1 text-left">规格</th>
                      <th className="px-2 py-1 text-left">版本</th>
                      <th className="px-2 py-1 text-left">状态</th>
                      <th className="px-2 py-1 text-right">用量</th>
                      <th
                        className="relative bg-gray-200 p-0 cursor-col-resize select-none"
                        onMouseDown={handleDragStart}
                      >
                        <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 bg-gray-400 rounded" />
                      </th>
                      <th className="px-2 py-1 text-left">类型</th>
                      <th className="px-2 py-1 text-left">件号</th>
                      <th className="px-2 py-1 text-left">名称</th>
                      <th className="px-2 py-1 text-left">规格</th>
                      <th className="px-2 py-1 text-left">版本</th>
                      <th className="px-2 py-1 text-left">状态</th>
                      <th className="px-2 py-1 text-right">用量</th>
                      <th className="w-px bg-gray-300 p-0" />
                      <th className="px-2 py-1 text-left">变更信息</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareResult.comparison.map((node: BOMCompareNode, idx: number) => {
                      const bgClass = getRowBgClass(node.change_type);

                      return (
                        <tr
                          key={node.key || idx}
                          className={(bgClass ? bgClass + ' ' : '') + 'border-b border-gray-100 hover:bg-opacity-80 cursor-pointer'}
                          onClick={() => {
                            const side = node.left || node.right;
                            if (!side) return;
                            const type: 'part' | 'assembly' = side.child_type === 'part' ? 'part' : 'assembly';
                            handleViewEntity(type, side.child_id);
                          }}
                        >
                          <td className="px-2 py-1 text-xs text-gray-500 whitespace-nowrap">
                            <span className="inline-flex items-center gap-0.5">
                              <span className="w-4 inline-block" />
                              <span>L{node.level + 1}</span>
                            </span>
                          </td>
                          <td className="px-2 py-1">
                            {node.left ? (
                              <span className={'px-1.5 py-0.5 text-xs rounded ' + (node.left.child_type === 'component' || node.left.child_type === 'assembly' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800')}>
                                {node.left.child_type === 'component' || node.left.child_type === 'assembly' ? '部件' : '零件'}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="px-2 py-1 text-xs font-medium">{node.left?.detail.code || '-'}</td>
                          <td className="px-2 py-1 text-xs text-gray-700">{node.left?.detail.name || '-'}</td>
                          <td className="px-2 py-1 text-xs text-gray-500">{node.left?.detail.spec || '-'}</td>
                          <td className="px-2 py-1 text-xs text-gray-500">{node.left?.detail.version || '-'}</td>
                          <td className="px-2 py-1 text-xs">{getStatusLabel(node.left?.detail.status || '-')}</td>
                          <td className="px-2 py-1 text-xs text-right font-medium">{node.left?.quantity ?? '-'}</td>

                          <td className="bg-gray-100 p-0" />

                          <td className="px-2 py-1">
                            {node.right ? (
                              <span className={'px-1.5 py-0.5 text-xs rounded ' + (node.right.child_type === 'component' || node.right.child_type === 'assembly' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800')}>
                                {node.right.child_type === 'component' || node.right.child_type === 'assembly' ? '部件' : '零件'}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="px-2 py-1 text-xs font-medium">{node.right?.detail.code || '-'}</td>
                          <td className="px-2 py-1 text-xs text-gray-700">{node.right?.detail.name || '-'}</td>
                          <td className="px-2 py-1 text-xs text-gray-500">{node.right?.detail.spec || '-'}</td>
                          <td className="px-2 py-1 text-xs text-gray-500">{node.right?.detail.version || '-'}</td>
                          <td className="px-2 py-1 text-xs">{getStatusLabel(node.right?.detail.status || '-')}</td>
                          <td className="px-2 py-1 text-xs text-right font-medium">{node.right?.quantity ?? '-'}</td>

                          <td className="w-px bg-gray-200 p-0" />

                          <td className="px-2 py-1 text-xs">{getChangeLabel(node)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                  );
                })()}
              </div>
            </div>
          )}

          {compareResult && compareResult.comparison.length === 0 && (
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <p className="text-sm text-gray-500 text-center">直接子项对比结果为空</p>
            </div>
          )}
        </div>
      )}

      {/* BOM 反查模式 */}
      {mode === 'trace' && (
        <div>
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

          {traceError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
              {traceError}
            </div>
          )}

          {!traceSearched && !traceError && traceResult.length === 0 && (
            <div className="text-center py-8 text-gray-400 bg-white rounded-lg border border-gray-200">
              请通过件号或名称搜索并选择要反查的{traceType === 'part' ? '零件' : '部件'}
            </div>
          )}

          {traceSearched && traceResult.length === 0 && !traceError && (
            <div className="text-center py-8 text-gray-400 bg-white rounded-lg border border-gray-200">
              未找到任何引用该实体的上级部件
            </div>
          )}

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
                            handleViewEntity(type, parent.id);
                          }}
                        >
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className="inline-flex items-center gap-0.5">
                              {hasChildren ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); toggleTraceNode(node); }}
                                  className="w-4 h-4 inline-flex items-center justify-center text-gray-500 hover:bg-gray-200 rounded"
                                >
                                  {node.expanded ? '▼' : '▶'}
                                </button>
                              ) : (
                                <span className="w-4 inline-block" />
                              )}
                              <span className="text-xs text-gray-400">L{item.level}</span>
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
      )}

      {/* ---- 行点击详情弹窗 ---- */}
      <Modal
        open={!!detailEntity}
        title={detailEntity ? (detailEntity.type === 'part' ? '零件详情' : '部件详情') : ''}
        onClose={() => setDetailEntity(null)}
        width="full"
      >
        {detailLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
        ) : !detailData ? (
          <div className="py-8 text-center text-sm text-gray-400">加载失败</div>
        ) : detailEntity?.type === 'part' ? (
          <PartDetailContent part={detailData} customFieldDefs={detailCustomDefs} customFieldValues={detailCustomValues} />
        ) : (
          <AssemblyDetailContent assembly={detailData} customFieldDefs={detailCustomDefs} customFieldValues={detailCustomValues} onSubItemClick={(item) => handleViewEntity(item.childType === 'part' ? 'part' : 'assembly', item.child_id)} />
        )}
      </Modal>
    </div>
  );
}
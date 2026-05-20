import { useState, useCallback, useEffect, useRef } from 'react';
import { bomApi, assembliesApi } from '../../services/api';
import type { BOMCompareNode, BOMCompareResponse } from '../../types';
import {
  getChangedFields,
  getChangeLabel,
  getRowBgClass,
  CHANGED_CELL_CLASS,
  getStatusLabel,
  type SelectOption,
} from './helpers';

interface BOMComparePanelProps {
  assemblies: SelectOption[];
  onViewEntity: (type: 'part' | 'assembly', id: string) => void;
}

export default function BOMComparePanel({ onViewEntity }: BOMComparePanelProps) {
  const [compareLeft, setCompareLeft] = useState<SelectOption | null>(null);
  const [compareRight, setCompareRight] = useState<SelectOption | null>(null);
  const [compareResult, setCompareResult] = useState<BOMCompareResponse | null>(null);
  const [splitRatio, setSplitRatio] = useState(50);
  const [loading, setLoading] = useState(false);
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

  // Inline debounced search for left
  const handleLeftSearch = useCallback((query: string) => {
    setCompareLeftSearch(query);
    if (cmpLeftDebounceRef.current) clearTimeout(cmpLeftDebounceRef.current);
    if (!query.trim()) { setCompareLeftResults([]); return; }
    cmpLeftDebounceRef.current = setTimeout(async () => {
      setCompareLeftSearchLoading(true);
      try {
        const response = await assembliesApi.list({ search: query.trim() });
        const items = Array.isArray(response.data) ? response.data : (response.data.items || []);
        setCompareLeftResults(items.slice(0, 20));
      } catch { setCompareLeftResults([]); }
      finally { setCompareLeftSearchLoading(false); }
    }, 300);
  }, []);

  // Inline debounced search for right
  const handleRightSearch = useCallback((query: string) => {
    setCompareRightSearch(query);
    if (cmpRightDebounceRef.current) clearTimeout(cmpRightDebounceRef.current);
    if (!query.trim()) { setCompareRightResults([]); return; }
    cmpRightDebounceRef.current = setTimeout(async () => {
      setCompareRightSearchLoading(true);
      try {
        const response = await assembliesApi.list({ search: query.trim() });
        const items = Array.isArray(response.data) ? response.data : (response.data.items || []);
        setCompareRightResults(items.slice(0, 20));
      } catch { setCompareRightResults([]); }
      finally { setCompareRightSearchLoading(false); }
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

  return (
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
                onChange={(e) => handleLeftSearch(e.target.value)}
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
                onChange={(e) => handleRightSearch(e.target.value)}
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
                  const changed = getChangedFields(node);

                  return (
                    <tr
                      key={node.key || idx}
                      className={(bgClass ? bgClass + ' ' : '') + 'border-b border-gray-100 hover:bg-opacity-80 cursor-pointer'}
                      onClick={() => {
                        const side = node.left || node.right;
                        if (!side) return;
                        const type: 'part' | 'assembly' = side.child_type === 'part' ? 'part' : 'assembly';
                        onViewEntity(type, side.child_id);
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
                      <td className={`px-2 py-1 text-xs font-medium ${changed.has('code') ? CHANGED_CELL_CLASS : ''}`}>{node.right?.detail.code || '-'}</td>
                      <td className={`px-2 py-1 text-xs ${changed.has('name') ? CHANGED_CELL_CLASS : 'text-gray-700'}`}>{node.right?.detail.name || '-'}</td>
                      <td className={`px-2 py-1 text-xs ${changed.has('spec') ? CHANGED_CELL_CLASS : 'text-gray-500'}`}>{node.right?.detail.spec || '-'}</td>
                      <td className={`px-2 py-1 text-xs ${changed.has('version') ? CHANGED_CELL_CLASS : 'text-gray-500'}`}>{node.right?.detail.version || '-'}</td>
                      <td className={`px-2 py-1 text-xs ${changed.has('status') ? CHANGED_CELL_CLASS : ''}`}>{getStatusLabel(node.right?.detail.status || '-')}</td>
                      <td className={`px-2 py-1 text-xs text-right font-medium ${changed.has('quantity') ? CHANGED_CELL_CLASS : ''}`}>{node.right?.quantity ?? '-'}</td>

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
  );
}

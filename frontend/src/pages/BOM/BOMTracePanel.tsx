import { useState, useCallback, useRef } from 'react';
import { partsApi } from '../../services/api';
import type { PartListItem } from '../../types';
import { getStatusLabel } from './helpers';
import BomWhereUsedTree from './BomWhereUsedTree';

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
  const traceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const selectTraceEntity = (item: PartListItem) => {
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
  };

  const clearTraceEntity = () => {
    setSelected(null);
    setTraceSearch('');
    setTraceSearchResults([]);
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
            <span className="text-gray-500">已选择：</span>
            <span className="font-medium">{selected.code}</span>
            <span className="text-gray-600">{selected.name}</span>
            {selected.version && <span className="text-gray-400">{selected.version}</span>}
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

      {selected && (
        <BomWhereUsedTree
          revisionId={selected.revisionId}
          root={{
            masterId: selected.masterId,
            revisionId: selected.revisionId,
            code: selected.code,
            name: selected.name,
            version: selected.version,
          }}
          onViewEntity={onViewEntity}
        />
      )}
    </div>
  );
}

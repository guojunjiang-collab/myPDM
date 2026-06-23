import { useState, useRef } from 'react';
import { assembliesApi } from '../../services/api';
import BOMTreeTable from '../../components/BOMTreeTable';
import type { SelectOption } from './types';

interface BOMTreePanelProps {
  assemblies: SelectOption[];
  onViewEntity: (type: 'part' | 'assembly', id: string) => void;
}

export default function BOMTreePanel({ assemblies: _assemblies, onViewEntity }: BOMTreePanelProps) {
  const [selectedAssembly, setSelectedAssembly] = useState('');
  const [selectedAssemblyCode, setSelectedAssemblyCode] = useState('');
  const [selectedAssemblyName, setSelectedAssemblyName] = useState('');
  const [treeSearch, setTreeSearch] = useState('');
  const [treeSearchResults, setTreeSearchResults] = useState<any[]>([]);
  const [treeSearchLoading, setTreeSearchLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const treeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTreeSearch = (query: string) => {
    setTreeSearch(query);
    if (treeDebounceRef.current) clearTimeout(treeDebounceRef.current);
    if (!query.trim()) {
      setTreeSearchResults([]);
      return;
    }
    treeDebounceRef.current = setTimeout(async () => {
      setTreeSearchLoading(true);
      setLoading(true);
      try {
        const response = await assembliesApi.list({ search: query.trim() });
        const items = Array.isArray(response.data)
          ? response.data
          : (response.data.items || []);
        setTreeSearchResults(items.slice(0, 20));
      } catch {
        setTreeSearchResults([]);
      } finally {
        setTreeSearchLoading(false);
        setLoading(false);
      }
    }, 300);
  };

  // ── 渲染 ──
  return (
    <div>
      <div className="bg-white p-4 rounded-lg border border-gray-200 mb-4">
        <div className="relative">
          <input
            type="text"
            placeholder="输入部件件号或名称搜索..."
            value={treeSearch}
            onChange={(e) => handleTreeSearch(e.target.value)}
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
                    setSelectedAssemblyCode(item.code);
                    setSelectedAssemblyName(item.name);
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
        <BOMTreeTable
          assemblyId={selectedAssembly}
          assemblyCode={selectedAssemblyCode}
          assemblyName={selectedAssemblyName}
          onRowClick={(item) => onViewEntity(item.childType === 'part' ? 'part' : 'assembly', item.child_id)}
        />
      ) : (
        <div className="text-center py-8 text-gray-400 bg-white rounded-lg border border-gray-200">
          请选择一个部件查看 BOM 树
        </div>
      )}
    </div>
  );
}

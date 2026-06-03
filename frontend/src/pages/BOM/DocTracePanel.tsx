import { useState, useCallback, useRef } from 'react';
import { documentsApi } from '../../services/api';

interface DocTracePanelProps {
  onViewEntity: (type: 'part' | 'assembly', id: string) => void;
}

export default function DocTracePanel({ onViewEntity }: DocTracePanelProps) {
  // ── 图文档反查状态 ──
  const [docTraceSearch, setDocTraceSearch] = useState('');
  const [docTraceSearchResults, setDocTraceSearchResults] = useState<any[]>([]);
  const [docTraceSearchLoading, setDocTraceSearchLoading] = useState(false);
  const [selectedDocTraceEntity, setSelectedDocTraceEntity] = useState<{ id: string; code: string; name: string } | null>(null);
  const [docTraceResult, setDocTraceResult] = useState<any>(null);
  const [docTraceSearched, setDocTraceSearched] = useState(false);
  const [docTraceError, setDocTraceError] = useState('');
  const docTraceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 搜索图文档（防抖） ──
  const handleDocTraceSearch = useCallback((query: string) => {
    setDocTraceSearch(query);
    if (docTraceDebounceRef.current) clearTimeout(docTraceDebounceRef.current);
    if (!query.trim()) {
      setDocTraceSearchResults([]);
      return;
    }
    docTraceDebounceRef.current = setTimeout(async () => {
      setDocTraceSearchLoading(true);
      try {
        const response = await documentsApi.list({ keyword: query.trim() });
        const items = Array.isArray(response.data)
          ? response.data
          : (response.data.items || []);
        setDocTraceSearchResults(items.slice(0, 20));
      } catch {
        setDocTraceSearchResults([]);
      } finally {
        setDocTraceSearchLoading(false);
      }
    }, 300);
  }, []);

  // ── 选择图文档 — 直接触发反查 ──
  const selectDocTraceEntity = async (entity: { id: string; code: string; name: string }) => {
    setSelectedDocTraceEntity(entity);
    setDocTraceSearch(entity.code + ' - ' + entity.name);
    setDocTraceSearchResults([]);
    setDocTraceResult(null);
    setDocTraceSearched(false);
    setDocTraceError('');
    try {
      const response = await documentsApi.references(entity.id);
      setDocTraceResult(response.data);
      setDocTraceSearched(true);
    } catch (error) {
      console.error('图文档反查失败', error);
      setDocTraceError('反查失败，请检查ID是否正确');
      setDocTraceResult(null);
    }
  };

  // ── 清除图文档选择 ──
  const clearDocTraceEntity = () => {
    setSelectedDocTraceEntity(null);
    setDocTraceSearch('');
    setDocTraceSearchResults([]);
    setDocTraceResult(null);
    setDocTraceSearched(false);
    setDocTraceError('');
  };

  return (
    <div>
      {/* 搜索栏 */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 mb-4">
        <div className="text-sm font-medium text-gray-700 mb-2">
          通过图文档编号或名称搜索，查看哪些零件、部件和用户看板引用了该图文档
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="输入图文档编号或名称搜索..."
            value={docTraceSearch}
            onChange={(e) => handleDocTraceSearch(e.target.value)}
            className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {docTraceSearchLoading && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">搜索中...</span>
          )}
          {docTraceSearchResults.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-auto">
              {docTraceSearchResults.map((item: any) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectDocTraceEntity(item)}
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
        {selectedDocTraceEntity && (
          <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-blue-50 rounded-lg text-sm">
            <span className="text-gray-500">已选择：</span>
            <span className="font-medium">{selectedDocTraceEntity.code}</span>
            <span className="text-gray-600">{selectedDocTraceEntity.name}</span>
            <button
              type="button"
              onClick={clearDocTraceEntity}
              className="ml-auto text-gray-400 hover:text-red-500 text-lg leading-none"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {docTraceError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
          {docTraceError}
        </div>
      )}

      {/* 初始空状态 */}
      {!docTraceSearched && !docTraceError && !docTraceResult && (
        <div className="text-center py-8 text-gray-400 bg-white rounded-lg border border-gray-200">
          请通过编号或名称搜索并选择要反查的图文档
        </div>
      )}

      {/* 无引用结果 */}
      {docTraceSearched && docTraceResult && docTraceResult.reference_count === 0 && docTraceResult.dashboard_folder_count === 0 && (
        <div className="text-center py-8 text-gray-400 bg-white rounded-lg border border-gray-200">
          未找到任何引用该图文档的零件、部件或用户看板
        </div>
      )}

      {/* 有引用结果 */}
      {docTraceSearched && docTraceResult && (docTraceResult.reference_count > 0 || docTraceResult.dashboard_folder_count > 0) && (
        <div>
          {/* 统计摘要 */}
          <div className="flex gap-3 mb-4 p-3 bg-gray-50 rounded-lg border text-sm">
            {(docTraceResult.references || []).filter((r: any) => r.entity_type === 'part').length > 0 && (
              <span>零件 <span className="font-medium text-blue-600">{(docTraceResult.references || []).filter((r: any) => r.entity_type === 'part').length}</span> 个</span>
            )}
            {(docTraceResult.references || []).filter((r: any) => r.entity_type === 'component').length > 0 && (
              <span>部件 <span className="font-medium text-green-600">{(docTraceResult.references || []).filter((r: any) => r.entity_type === 'component').length}</span> 个</span>
            )}
            {docTraceResult.dashboard_folder_count > 0 && (
              <span>用户看板 <span className="font-medium text-purple-600">{docTraceResult.dashboard_folder_count}</span> 个</span>
            )}
            <span className="text-gray-400">共 {docTraceResult.reference_count + docTraceResult.dashboard_folder_count} 个引用</span>
          </div>

          {/* 零件/部件引用表 */}
          {docTraceResult.reference_count > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 mb-4">
              <div className="p-3 border-b border-gray-200 bg-gray-50">
                <span className="text-sm font-medium text-gray-700">零件 / 部件引用</span>
                <span className="text-xs text-gray-400 ml-2">{docTraceResult.reference_count} 项</span>
              </div>
              <div className="overflow-auto max-h-80">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">类型</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">件号</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">版本</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">状态</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium w-24">文档分类</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(docTraceResult.references || []).map((ref: any, idx: number) => {
                      const isPart = ref.entity_type === 'part';
                      const statusMap: Record<string, { label: string; cls: string }> = {
                        draft: { label: '草稿', cls: 'bg-blue-100 text-blue-800' },
                        frozen: { label: '冻结', cls: 'bg-orange-100 text-orange-800' },
                        released: { label: '发布', cls: 'bg-green-100 text-green-800' },
                        obsolete: { label: '作废', cls: 'bg-red-100 text-red-800' },
                      };
                      const st = statusMap[ref.status] || { label: ref.status || '-', cls: 'bg-gray-100 text-gray-800' };
                      return (
                        <tr
                          key={`${ref.entity_id}-${idx}`}
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => onViewEntity(isPart ? 'part' : 'assembly', ref.entity_id)}
                        >
                          <td className="px-3 py-2">
                            <span className={`px-1.5 py-0.5 text-xs rounded ${isPart ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}`}>
                              {isPart ? '零件' : '部件'}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-medium">{ref.entity_code}</td>
                          <td className="px-3 py-2">{ref.entity_name}</td>
                          <td className="px-3 py-2 text-gray-500">{ref.version || '-'}</td>
                          <td className="px-3 py-2">
                            <span className={`px-1.5 py-0.5 text-xs rounded ${st.cls}`}>{st.label}</span>
                          </td>
                          <td className="px-3 py-2 text-gray-500 text-xs">{ref.category || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 用户看板文件夹引用表 */}
          {docTraceResult.dashboard_folder_count > 0 && (
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="p-3 border-b border-gray-200 bg-gray-50">
                <span className="text-sm font-medium text-gray-700">用户看板引用</span>
                <span className="text-xs text-gray-400 ml-2">{docTraceResult.dashboard_folder_count} 项</span>
              </div>
              <div className="overflow-auto max-h-80">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">文件夹名称</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium">文件夹路径</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-medium w-32">所属用户</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(docTraceResult.dashboard_folders || []).map((folder: any, idx: number) => (
                      <tr key={`${folder.folder_id}-${idx}`} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium">{folder.folder_name}</td>
                        <td className="px-3 py-2 text-gray-500">{folder.folder_path}</td>
                        <td className="px-3 py-2 text-gray-600">{folder.user_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

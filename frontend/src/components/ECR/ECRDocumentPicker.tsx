import { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { documentsApi } from '../../services/api';
import type { ECRDocumentLink, Document } from '../../types';

interface ECRDocumentPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (docs: ECRDocumentLink[]) => void;
  alreadyLinked: string[];
}

export function ECRDocumentPicker({ open, onClose, onSelect, alreadyLinked }: ECRDocumentPickerProps) {
  const [search, setSearch] = useState('');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setSearch('');
      setSelectedIds(new Set());
      loadDocuments();
    }
  }, [open]);

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const resp = await documentsApi.list({ page_size: 200 });
      const data = resp.data;
      const list = data.items || data || [];
      setDocuments(Array.isArray(list) ? list : []);
    } catch {
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredDocs = documents.filter((doc) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (doc.code || '').toLowerCase().includes(q) ||
      (doc.name || '').toLowerCase().includes(q) ||
      (doc.version || '').toLowerCase().includes(q)
    );
  });

  const toggleSelect = (docId: string) => {
    const next = new Set(selectedIds);
    if (next.has(docId)) {
      next.delete(docId);
    } else {
      next.add(docId);
    }
    setSelectedIds(next);
  };

  const handleConfirm = () => {
    const selectedDocs = documents.filter((d) => selectedIds.has(d.id) && !alreadyLinked.includes(d.id));
    const links: ECRDocumentLink[] = selectedDocs.map((d) => ({
      document_id: d.id,
      document_code: d.code,
      document_name: d.name,
      document_version: d.version || '',
    }));
    onSelect(links);
    onClose();
  };

  return (
    <Modal open={open} title="关联图文档" onClose={onClose} width="lg">
      <div className="space-y-4">
        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索文档编号/名称/版本..."
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />

        {/* Document table */}
        <div className="max-h-64 overflow-y-auto border border-gray-200 rounded">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-gray-400">
              加载中...
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">
              {search.trim() ? '未找到匹配的文档' : '暂无可关联的文档'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="w-10 px-3 py-2 text-left">
                    <input
                      type="checkbox"
                      onChange={(e) => {
                        if (e.target.checked) {
                          const all = new Set(filteredDocs.filter((d) => !alreadyLinked.includes(d.id)).map((d) => d.id));
                          setSelectedIds(all);
                        } else {
                          setSelectedIds(new Set());
                        }
                      }}
                      checked={
                        filteredDocs.length > 0 &&
                        filteredDocs.every((d) => alreadyLinked.includes(d.id) || selectedIds.has(d.id))
                      }
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">文档编号</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">文档名称</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">版本</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredDocs.map((doc) => {
                  const isAlreadyLinked = alreadyLinked.includes(doc.id);
                  const isSelected = selectedIds.has(doc.id);
                  return (
                    <tr
                      key={doc.id}
                      className={`hover:bg-gray-50 cursor-pointer ${
                        isAlreadyLinked ? 'opacity-50' : ''
                      }`}
                      onClick={() => {
                        if (isAlreadyLinked) return;
                        toggleSelect(doc.id);
                      }}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isAlreadyLinked || isSelected}
                          disabled={isAlreadyLinked}
                          onChange={() => toggleSelect(doc.id)}
                          className="rounded border-gray-300"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900">{doc.code}</td>
                      <td className="px-3 py-2 text-gray-600">{doc.name}</td>
                      <td className="px-3 py-2 text-gray-400">{doc.version || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-200">
          <span className="text-xs text-gray-500">
            已选 {selectedIds.size} 个文档
            {alreadyLinked.length > 0 && (
              <span className="ml-2 text-gray-400">
                （{alreadyLinked.length} 个已关联）
              </span>
            )}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedIds.size === 0}
              className="px-4 py-2 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              确认关联 ({selectedIds.size})
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

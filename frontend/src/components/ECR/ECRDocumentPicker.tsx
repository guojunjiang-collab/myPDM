import { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { documentsApi } from '../../services/api';
import type { ECRDocumentLink, Document } from '../../types';
import Button from '../ui/Button';
import Input from '../ui/Input';
import SortableTh from '../ui/SortableTh';
import { useTableSort } from '../../hooks/useTableSort';
import { compareVersions } from '../../constants';

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

  // 文档表排序（勾选列不排序）
  const { sortedData: sortedDocs, sortField, sortDirection, handleSort } = useTableSort<Document>(filteredDocs, { fieldComparators: { version: (a, b) => compareVersions(String(a), String(b)) } });

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
        <Input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索文档编号/名称/版本..."
        />

        {/* Document table */}
        <div className="max-h-64 overflow-y-auto border border-[var(--ui-border)] rounded">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-[var(--ui-text-tertiary)]">
              加载中...
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="text-center py-8 text-sm text-[var(--ui-text-tertiary)]">
              {search.trim() ? '未找到匹配的文档' : '暂无可关联的文档'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[var(--ui-bg-subtle)] sticky top-0">
                <tr>
                  <SortableTh className="text-left w-10">
                    <input
                      type="checkbox"
                      onChange={(e) => {
                        if (e.target.checked) {
                          const all = new Set(sortedDocs.filter((d) => !alreadyLinked.includes(d.id)).map((d) => d.id));
                          setSelectedIds(all);
                        } else {
                          setSelectedIds(new Set());
                        }
                      }}
                      checked={
                        sortedDocs.length > 0 &&
                        sortedDocs.every((d) => alreadyLinked.includes(d.id) || selectedIds.has(d.id))
                      }
                      className="rounded border-gray-300"
                    />
                  </SortableTh>
                  <SortableTh sortKey="code" active={sortField === 'code'} direction={sortDirection} onSort={(k) => handleSort(k as keyof Document)} className="text-left">文档编号</SortableTh>
                  <SortableTh sortKey="name" active={sortField === 'name'} direction={sortDirection} onSort={(k) => handleSort(k as keyof Document)} className="text-left">文档名称</SortableTh>
                  <SortableTh sortKey="version" active={sortField === 'version'} direction={sortDirection} onSort={(k) => handleSort(k as keyof Document)} className="text-left">版本</SortableTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedDocs.map((doc) => {
                  const isAlreadyLinked = alreadyLinked.includes(doc.id);
                  const isSelected = selectedIds.has(doc.id);
                  return (
                    <tr
                      key={doc.id}
                      className={`hover:bg-[var(--ui-bg-hover)] cursor-pointer ${
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
                      <td className="px-3 py-2 font-medium text-[var(--ui-text-primary)]">{doc.code}</td>
                      <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{doc.name}</td>
                      <td className="px-3 py-2 text-[var(--ui-text-tertiary)]">{doc.version || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-[var(--ui-border)]">
          <span className="text-xs text-[var(--ui-text-secondary)]">
            已选 {selectedIds.size} 个文档
            {alreadyLinked.length > 0 && (
              <span className="ml-2 text-[var(--ui-text-tertiary)]">
                （{alreadyLinked.length} 个已关联）
              </span>
            )}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={selectedIds.size === 0}
            >
              确认关联 ({selectedIds.size})
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

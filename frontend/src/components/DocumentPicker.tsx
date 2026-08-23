import { useState, useEffect, useMemo } from 'react';
import { useDataStore } from '../stores/data';
import { documentsApi, customFieldsApi } from '../services/api';
import { Modal } from './Modal';
import Badge from './ui/Badge';
import Button from './ui/Button';
import Input from './ui/Input';
import Select from './ui/Select';
import TreeToggle from './ui/TreeToggle';
import type { Document, CustomFieldDefinition, CustomFieldValue } from '../types';

/* ----------------------------------------------------------------
   Types
   ---------------------------------------------------------------- */

interface SelectedItem {
  id: string;
  revision_id?: string;
  code: string;
  name: string;
  version: string;
  status: string;
}

interface CandidateItem extends SelectedItem {
  revision_id?: string;
  customFieldValues: Record<string, unknown>;
}

interface DocumentPickerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (items: { document_id: string; category?: string }[]) => void;
  existingDocIds?: Set<string>;
  docFieldDefs?: CustomFieldDefinition[];
  docFieldValues?: Record<string, Record<string, unknown>>;
  entityType?: string;
  entityCode?: string;
  entityName?: string;
}

/* ----------------------------------------------------------------
   Helpers
   ---------------------------------------------------------------- */

const renderFieldValue = (v: unknown) => {
  if (v === undefined || v === null || v === '') return <span className="text-gray-300">-</span>;
  if (Array.isArray(v)) return v.length > 0 ? String(v.join(',')) : <span className="text-gray-300">-</span>;
  return String(v);
};

/* ----------------------------------------------------------------
   Component
   ---------------------------------------------------------------- */

export default function DocumentPicker({
  open,
  onClose,
  onConfirm,
  existingDocIds = new Set(),
  docFieldDefs: propFieldDefs,
  docFieldValues: propFieldValues,
  entityType,
  entityCode,
  entityName,
}: DocumentPickerProps) {
  /* ---- 筛选 ---- */
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  /* ---- 已选 ---- */
  const [selected, setSelected] = useState<Map<string, SelectedItem>>(new Map());

  /* ---- 数据源 ---- */
  const storeDocuments = useDataStore((s) => s.documents);
  const [fetchedDocs, setFetchedDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);

  /* ---- 快速新建 ---- */
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickForm, setQuickForm] = useState({ code: '', name: '', remark: '' });
  const [quickCreating, setQuickCreating] = useState(false);

  /* ---- 内部自定义字段（props 未传入时自行加载） ---- */
  const [localFieldDefs, setLocalFieldDefs] = useState<CustomFieldDefinition[]>([]);
  const [localFieldValues, setLocalFieldValues] = useState<Record<string, Record<string, unknown>>>({});

  /* 加载数据 */
  useEffect(() => {
    if (!open) return;
    setQuickForm({ code: '', name: '', remark: '' });
    setQuickOpen(false);
    setQuickCreating(false);
    setLoading(true);

    const docPromise: Promise<Document[]> = storeDocuments.length > 0
      ? Promise.resolve(storeDocuments)
      : documentsApi.list({ page_size: 10000 }).then((r) => {
          const data = r.data as Record<string, unknown>;
          return Array.isArray(data) ? data : (data?.items || []) as Document[];
        });

    // 如果外部传入了字段定义和值，就不需要自行加载
    const needLoadFields = !propFieldDefs || !propFieldValues;
    let fieldDefsPromise: Promise<CustomFieldDefinition[]> = Promise.resolve([]);

    if (needLoadFields) {
      fieldDefsPromise = customFieldsApi.listDefinitions().then((r) =>
        (r.data || []).filter((d: CustomFieldDefinition) => d.applies_to?.includes('document')),
      );
    }

    docPromise.then((docs) => {
      setFetchedDocs(docs);
      if (needLoadFields) {
        fieldDefsPromise.then((defs) => {
          setLocalFieldDefs(defs);
          if (defs.length > 0 && docs.length > 0) {
            Promise.all(
              docs.map(async (doc) => {
                try {
                  const res = await customFieldsApi.getValues('document', doc.id);
                  const vals: Record<string, unknown> = {};
                  (res.data || []).forEach((v: CustomFieldValue) => {
                    vals[v.field_id] = v.value;
                  });
                  return { id: doc.id, vals };
                } catch {
                  return { id: doc.id, vals: {} };
                }
              }),
            ).then((results) => {
              const all: Record<string, Record<string, unknown>> = {};
              for (const r of results) all[r.id] = r.vals;
              setLocalFieldValues(all);
            });
          }
        });
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [open, storeDocuments, propFieldDefs, propFieldValues]);

  // 优先使用 props，fallback 到内部加载的
  const fieldDefs = propFieldDefs && propFieldDefs.length > 0 ? propFieldDefs : localFieldDefs;
  const fieldValues = propFieldValues || localFieldValues;

  const documentsList = storeDocuments.length > 0 ? storeDocuments : fetchedDocs;

  /* 搜索 + 筛选 */
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return documentsList
      .filter((doc) => {
        if (existingDocIds.has(doc.id || doc.revision_id || '')) return false;
        if (statusFilter && doc.status !== statusFilter) return false;
        if (!keyword) return true;
        return doc.code.toLowerCase().includes(keyword) || doc.name.toLowerCase().includes(keyword);
      })
      .map((doc) => ({
        id: doc.id || doc.revision_id || '',
        revision_id: doc.revision_id,
        code: doc.code,
        name: doc.name,
        version: doc.version || 'A',
        status: doc.status,
        customFieldValues: fieldValues[doc.id || doc.revision_id || ''] || {},
      }));
  }, [documentsList, search, statusFilter, existingDocIds, fieldValues]);

  /* ---- 操作 ---- */

  const addToSelected = (item: CandidateItem) => {
    const docId = item.id || item.revision_id || '';
    if (selected.has(docId)) return;
    setSelected(new Map(selected).set(docId, { id: docId, code: item.code, name: item.name, version: item.version, status: item.status }));
  };

  const removeFromSelected = (id: string) => {
    const next = new Map(selected);
    next.delete(id);
    setSelected(next);
  };

  const handleQuickCreate = async () => {
    if (!quickForm.code.trim() || !quickForm.name.trim()) return;
    setQuickCreating(true);
    try {
      const r = await documentsApi.create({
        code: quickForm.code.trim(),
        name: quickForm.name.trim(),
        remark: quickForm.remark.trim() || undefined,
      });
      const doc = r.data as Document;
      // 加入已选
      setSelected((prev) => new Map(prev).set(doc.id, {
        id: doc.id,
        code: doc.code,
        name: doc.name,
        version: doc.version || 'A',
        status: doc.status,
      }));
      // 同步进候选数据源，无需重新搜索
      setFetchedDocs((prev) => [...prev, doc]);
      useDataStore.getState().setDocuments([...useDataStore.getState().documents, doc]);
      setQuickForm({ code: '', name: '', remark: '' });
    } catch {
      alert('新建图文档失败，请检查编号是否重复');
    } finally {
      setQuickCreating(false);
    }
  };

  const handleConfirm = () => {
    const result = Array.from(selected.values()).map((v) => ({
      document_id: v.id,
    }));
    onConfirm(result);
    setSelected(new Map());
    setSearch('');
    setStatusFilter('');
  };

  const handleCancel = () => {
    setSelected(new Map());
    setSearch('');
    setStatusFilter('');
    onClose();
  };

  const entityTypeLabel = entityType === 'part' ? '零件' : entityType === 'assembly' ? '部件' : entityType === 'component' ? '零部件' : entityType === 'configuration' ? '构型项' : '';
  const entityLabel = entityCode && entityTypeLabel ? ` - ${entityTypeLabel} ${entityCode}${entityName ? ` ${entityName}` : ''}` : '';
  const title = `关联图文档${entityLabel}`;

  const selectedList = useMemo(() => Array.from(selected.values()), [selected]);

  return (
    <Modal open={open} title={title} onClose={handleCancel} width="full" zIndex={60}>
      <div className="space-y-4 max-h-[75vh] flex flex-col">
        {/* ---- 1. 已选 ---- */}
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-[var(--ui-bg-subtle)] border-b px-4 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              已选图文档{selectedList.length > 0 ? ` (${selectedList.length})` : ''}
            </span>
          </div>
          {selectedList.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-[var(--ui-text-tertiary)]">请在下方列表中选择要关联的图文档</div>
          ) : (
            <div className="overflow-x-auto max-h-48 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--ui-bg-subtle)] border-b sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">图文档编号</th>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">图文档名称</th>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">版本</th>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">状态</th>
                    {fieldDefs.map((def) => (
                      <th key={def.id} className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium whitespace-nowrap">{def.name}</th>
                    ))}
                    <th className="px-3 py-2 text-right text-[var(--ui-text-secondary)] font-medium w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {selectedList.map((item) => (
                    <tr key={item.id} className="hover:bg-[var(--ui-bg-hover)]">
                      <td className="px-3 py-2 font-medium">{item.code}</td>
                      <td className="px-3 py-2">{item.name}</td>
                      <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{item.version}</td>
                      <td className="px-3 py-2">
                        <Badge status={item.status} />
                      </td>
                      {fieldDefs.map((def) => (
                        <td key={def.id} className="px-3 py-2 text-[var(--ui-text-secondary)] whitespace-nowrap">
                          {renderFieldValue((fieldValues[item.id] || {})[def.id])}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right">
                        <Button variant="danger" size="xs" type="button" onClick={() => removeFromSelected(item.id)} title="移除">✕</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ---- 2. 搜索 & 筛选 ---- */}
        <div className="flex gap-2 items-center">
          <Input
            type="text"
            placeholder="搜索编号、名称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="frozen">冻结</option>
            <option value="released">发布</option>
            <option value="obsolete">作废</option>
          </Select>
        </div>

        {/* ---- 快速新建 ---- */}
        <div className="border rounded-lg overflow-hidden">
          <div className="flex items-center">
            <TreeToggle expanded={quickOpen} onClick={() => setQuickOpen(!quickOpen)} size="sm" />
            <Button variant="ghost" size="sm" className="flex-1 !justify-start" type="button" onClick={() => setQuickOpen(!quickOpen)}>
              快速新建图文档
            </Button>
          </div>
          {quickOpen && (
            <div className="px-4 py-3 border-t space-y-2 bg-[var(--ui-bg-subtle)]">
              <div className="flex gap-2">
                <Input value={quickForm.code} onChange={e => setQuickForm({ ...quickForm, code: e.target.value })} placeholder="编号 *" size="xs" className="flex-1" />
                <Input value={quickForm.name} onChange={e => setQuickForm({ ...quickForm, name: e.target.value })} placeholder="名称 *" size="xs" className="flex-1" />
              </div>
              <div className="flex gap-2">
                <Input value={quickForm.remark} onChange={e => setQuickForm({ ...quickForm, remark: e.target.value })} placeholder="备注" size="xs" className="flex-1" />
                <Button size="sm" type="button" onClick={handleQuickCreate} disabled={quickCreating} className="whitespace-nowrap">
                  {quickCreating ? '创建中...' : '新建并添加'}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ---- 3. 可选列表 ---- */}
        <div className="border rounded-lg overflow-hidden flex-1 min-h-0">
          <div className="overflow-y-auto max-h-64">
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--ui-text-tertiary)]">加载中...</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[var(--ui-text-tertiary)]">无匹配结果</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[var(--ui-bg-subtle)] border-b sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">图文档编号</th>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">图文档名称</th>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">版本</th>
                    <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium w-16">状态</th>
                    {fieldDefs.map((def) => (
                      <th key={def.id} className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium whitespace-nowrap">{def.name}</th>
                    ))}
                    <th className="px-3 py-2 text-center text-[var(--ui-text-secondary)] font-medium w-20">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((item) => {
                    const docId = item.id || item.revision_id || '';
                    const isAdded = selected.has(docId);
                    return (
                      <tr key={item.id} className="hover:bg-[var(--ui-bg-hover)]">
                        <td className="px-3 py-2 font-medium">{item.code}</td>
                        <td className="px-3 py-2">{item.name}</td>
                        <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{item.version}</td>
                        <td className="px-3 py-2">
                          <Badge status={item.status} />
                        </td>
                        {fieldDefs.map((def) => (
                          <td key={def.id} className="px-3 py-2 text-[var(--ui-text-secondary)] whitespace-nowrap">
                            {renderFieldValue(item.customFieldValues[def.id])}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-center">
                          {isAdded ? (
                            <span className="text-xs text-green-600">已关联</span>
                          ) : (
                            <Button size="xs" type="button" onClick={() => addToSelected(item)}>
                              关联
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ---- 底部 ---- */}
        <div className="flex justify-between items-center pt-2 border-t">
          <span className="text-sm text-[var(--ui-text-secondary)]">已选 <span className="font-medium text-gray-700">{selectedList.length}</span> 项</span>
          <div className="flex gap-2">
            <Button variant="secondary" type="button" onClick={handleCancel}>取消</Button>
            <Button type="button" onClick={handleConfirm} disabled={selectedList.length === 0}>
              确认关联
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

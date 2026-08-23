import { useState, useEffect, useMemo, useCallback } from 'react';
import { useDataStore } from '../stores/data';
import { documentsApi, customFieldsApi } from '../services/api';
import EntityPickerModal from './ui/EntityPickerModal';
import { toast } from './Toast';
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
  customFieldValues?: Record<string, unknown>;
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
   Component（EntityPickerModal 薄封装，吸收原自绘骨架）
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
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<SelectedItem[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);

  /* ---- 数据源（store 优先，fallback API；打开时加载一次） ---- */
  const storeDocuments = useDataStore((s) => s.documents);
  const [fetchedDocs, setFetchedDocs] = useState<Document[]>([]);
  const [localFieldDefs, setLocalFieldDefs] = useState<CustomFieldDefinition[]>([]);
  const [localFieldValues, setLocalFieldValues] = useState<Record<string, Record<string, unknown>>>({});

  /* ---- 快速新建 ---- */
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickForm, setQuickForm] = useState({ code: '', name: '', remark: '' });
  const [quickCreating, setQuickCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setStatusFilter('');
    setQuickForm({ code: '', name: '', remark: '' });
    setQuickOpen(false);
    setQuickCreating(false);
    setRefreshToken(0);

    const docPromise: Promise<Document[]> = storeDocuments.length > 0
      ? Promise.resolve(storeDocuments)
      : documentsApi.list({ page_size: 10000 }).then((r) => {
          const data = r.data as Record<string, unknown>;
          return Array.isArray(data) ? data : (data?.items || []) as Document[];
        });

    // 外部传入字段定义/值则不需要自行加载
    const needLoadFields = !propFieldDefs || !propFieldValues;

    docPromise.then((docs) => {
      setFetchedDocs(docs);
      if (needLoadFields) {
        customFieldsApi.listDefinitions().then((r) => {
          const defs = (r.data || []).filter((d: CustomFieldDefinition) => d.applies_to?.includes('document'));
          setLocalFieldDefs(defs);
          if (defs.length > 0 && docs.length > 0) {
            Promise.all(
              docs.map(async (doc) => {
                try {
                  const res = await customFieldsApi.getValues('document', doc.id);
                  const vals: Record<string, unknown> = {};
                  (res.data || []).forEach((v: CustomFieldValue) => { vals[v.field_id] = v.value; });
                  return { id: doc.id, vals };
                } catch {
                  return { id: doc.id, vals: {} };
                }
              }),
            ).then((results) => {
              const all: Record<string, Record<string, unknown>> = {};
              for (const r2 of results) all[r2.id] = r2.vals;
              setLocalFieldValues(all);
            });
          }
        });
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fieldDefs = propFieldDefs && propFieldDefs.length > 0 ? propFieldDefs : localFieldDefs;
  const fieldValues = propFieldValues || localFieldValues;
  const documentsList = storeDocuments.length > 0 ? storeDocuments : fetchedDocs;

  const fetchData = useCallback(async (params: { search: string; status?: string }) => {
    const kw = params.search.trim().toLowerCase();
    return documentsList
      .filter((doc) => {
        if (existingDocIds.has(doc.id || doc.revision_id || '')) return false;
        if (params.status && doc.status !== params.status) return false;
        if (!kw) return true;
        return doc.code.toLowerCase().includes(kw) || doc.name.toLowerCase().includes(kw);
      })
      .map((doc) => ({
        id: doc.id || doc.revision_id || '',
        revision_id: doc.revision_id,
        code: doc.code,
        name: doc.name,
        version: doc.version || 'A',
        status: doc.status,
        customFieldValues: fieldValues[doc.id || doc.revision_id || ''] || {},
      }) as CandidateItem);
  }, [documentsList, existingDocIds, fieldValues]);

  const columns = useMemo(() => ([
    { key: 'code', title: '图文档编号', width: '160px', render: (d: CandidateItem) => <span className="font-medium">{d.code}</span> },
    { key: 'name', title: '图文档名称', render: (d: CandidateItem) => d.name },
    { key: 'version', title: '版本', width: '70px', render: (d: CandidateItem) => <span className="text-[var(--ui-text-secondary)]">{d.version}</span> },
    { key: 'status', title: '状态', width: '80px', render: (d: CandidateItem) => <Badge status={d.status} /> },
    ...fieldDefs.map((def) => ({
      key: def.id,
      title: def.name,
      render: (d: CandidateItem) => <span className="text-[var(--ui-text-secondary)] whitespace-nowrap">{renderFieldValue((d.customFieldValues || {})[def.id])}</span>,
    })),
  ]), [fieldDefs]);

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
      setSelected((prev) => [...prev, {
        id: doc.id,
        code: doc.code,
        name: doc.name,
        version: doc.version || 'A',
        status: doc.status,
      }]);
      setFetchedDocs((prev) => [...prev, doc]);
      useDataStore.getState().setDocuments([...useDataStore.getState().documents, doc]);
      setQuickForm({ code: '', name: '', remark: '' });
      setRefreshToken((t) => t + 1);
    } catch {
      toast.error('新建图文档失败，请检查编号是否重复');
    } finally {
      setQuickCreating(false);
    }
  };

  const entityTypeLabel = entityType === 'part' ? '零件' : entityType === 'assembly' ? '部件' : entityType === 'component' ? '零部件' : entityType === 'configuration' ? '构型项' : '';
  const entityLabel = entityCode && entityTypeLabel ? ` - ${entityTypeLabel} ${entityCode}${entityName ? ` ${entityName}` : ''}` : '';
  const title = `关联图文档${entityLabel}`;

  return (
    <EntityPickerModal<CandidateItem>
      open={open}
      title={title}
      onClose={onClose}
      width="full"
      fetchData={fetchData}
      filterParams={{ status: statusFilter, r: refreshToken }}
      getKey={(d) => d.id}
      columns={columns}
      selected={selected}
      onSelectedChange={setSelected}
      onConfirm={(items) => {
        onConfirm(items.map((v) => ({ document_id: v.id })));
        onClose();
      }}
      searchPlaceholder="搜索编号、名称..."
      filters={
        <Select className="!w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="frozen">冻结</option>
          <option value="released">发布</option>
          <option value="obsolete">作废</option>
        </Select>
      }
      quickCreate={
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
      }
    />
  );
}

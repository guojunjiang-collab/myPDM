import { useEffect, useState } from 'react';
import { formatDate } from '../../lib/date';
import { useDebounced } from '../../hooks/useDebounced';
import { configurationApi } from '../../services/api';
import { canEdit, isAdmin } from '../../stores/auth';
import { useDataStore } from '../../stores/data';
import { ConfirmModal } from '../Modal';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import ConfigurationCreateModal from './ConfigurationCreateModal';
import type { CustomFieldDefinition } from '../../types';

interface ConfigItemRow {
  revision_id: string;
  master_id: string;
  code: string;
  name: string;
  version: string;
  status: string;
  check_out_user_id?: string;
  check_out_user_name?: string;
  check_out_date?: string;
  latest_iteration: number;
  created_at?: string;
  updated_at?: string;
  version_count?: number;
}

interface Props {
  onOpenDetail: (revisionId: string, code: string) => void;
  refreshTrigger?: number;
  pendingPatch?: React.MutableRefObject<{ oldCode?: string; revisionId: string; code?: string; name?: string } | null>;
}

type SortField = 'code' | 'name' | 'created_at' | 'version' | 'status' | 'check_out_user_name';
type SortOrder = 'asc' | 'desc';

export default function ConfigurationList({ onOpenDetail, refreshTrigger, pendingPatch }: Props) {
  const storeCustomDefs = useDataStore((s) => s.customFieldDefs);
  const configCustomDefs = storeCustomDefs.filter((d: CustomFieldDefinition) =>
    d.applies_to?.includes('configuration_item')
  );

  const [items, setItems] = useState<ConfigItemRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const [sortField, setSortField] = useState<SortField>('code');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 400);
  const [searchField, setSearchField] = useState('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [topLevelOnly, setTopLevelOnly] = useState(false);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    configurationApi.listItems({
      page,
      page_size: pageSize,
      sort_field: sortField,
      sort_order: sortOrder,
      search: debouncedSearch || undefined,
      search_field: searchField.startsWith('cf_') ? 'all' : searchField,
      include_custom_fields: true,
      status: statusFilter || undefined,
      show_all_versions: showAllVersions,
      top_level: topLevelOnly || undefined,
    }).then((r) => {
      const data = r.data as any;
      const rawItems: any[] = data.items || [];
      const rows: ConfigItemRow[] = rawItems.map((item: any) => ({
        revision_id: item.revision_id || item.id,
        master_id: item.master_id,
        code: item.code || '',
        name: item.name || '',
        version: item.version || '',
        status: item.status || 'draft',
        check_out_user_id: item.check_out_user_id,
        check_out_user_name: item.check_out_user_name,
        check_out_date: item.check_out_date,
        latest_iteration: item.latest_iteration || 1,
        created_at: item.created_at,
        updated_at: item.updated_at,
        version_count: item.version_count,
      }));
      setItems(rows);
      setTotal(data.total || 0);
      setPage(data.page || 1);
    }).catch(() => {
      setItems([]);
      setTotal(0);
    }).finally(() => setLoading(false));
  }, [page, sortField, sortOrder, debouncedSearch, searchField, statusFilter, showAllVersions, topLevelOnly, refreshToken, refreshTrigger]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, searchField, statusFilter, showAllVersions, topLevelOnly, sortField, sortOrder]);

  const onSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };
  const sortIcon = (field: SortField) =>
    sortField === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : ' ⇅';

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleteError(null);
    try {
      await configurationApi.delete(deleteId);
      setDeleteId(null);
      setItems(prev => prev.filter(item => item.revision_id !== deleteId));
      setRefreshToken(t => t + 1);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (detail) {
        setDeleteError(typeof detail === 'string' ? detail : '删除失败');
      } else {
        setDeleteError('删除失败，请重试');
      }
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex gap-2 mb-4 shrink-0">
        <Input
          type="text"
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={searchField === 'all' ? '搜索全部字段...' : searchField === 'code' ? '搜索构型号...' : searchField === 'name' ? '搜索名称...' : searchField.startsWith('cf_') ? `搜索${configCustomDefs.find(d => d.id === searchField.replace('cf_', ''))?.name || '自定义字段'}...` : '搜索...'}
          className="flex-1 min-w-0"
        />
        <Select
          className="!w-auto"
          value={searchField}
          onChange={(e) => setSearchField(e.target.value)}
        >
          <option value="all">全部字段</option>
          <option value="code">构型号</option>
          <option value="name">名称</option>
          {configCustomDefs.map(def => (
            <option key={def.id} value={`cf_${def.id}`}>{def.name}</option>
          ))}
        </Select>
        <Button active={topLevelOnly} onClick={() => setTopLevelOnly((v) => !v)} title="只显示没有父项的最顶层构型项">
          仅顶层构型项
        </Button>
        <Button active={showAllVersions} onClick={() => setShowAllVersions((v) => !v)}>
          全部版本
        </Button>

        <div className="flex-1" />
        {canEdit() && (
          <Button onClick={() => setCreateOpen(true)}>+ 新建构型</Button>
        )}
      </div>

      <div className="relative bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-y-auto flex-1 min-h-0">
        <table className="w-full">
          <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)] sticky top-0 z-10">
            <tr>
              <th onClick={() => onSort('code')} className="text-left px-3 py-3 text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none whitespace-nowrap w-60">构型号{sortIcon('code')}</th>
              <th onClick={() => onSort('name')} className="text-left px-3 py-3 text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none whitespace-nowrap">名称{sortIcon('name')}</th>
              <th onClick={() => onSort('created_at')} className="text-center px-2 py-3 text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none whitespace-nowrap w-44">创建时间{sortIcon('created_at')}</th>
              <th onClick={() => onSort('version')} className="text-center px-2 py-3 text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none whitespace-nowrap w-16">版本{sortIcon('version')}</th>
              <th onClick={() => onSort('status')} className="text-center px-2 py-3 text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none whitespace-nowrap w-20">状态{sortIcon('status')}</th>
              <th onClick={() => onSort('check_out_user_name')} className="text-center px-2 py-3 text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none whitespace-nowrap w-20">签出状态{sortIcon('check_out_user_name')}</th>
              <th className="text-center px-2 py-3 text-sm font-medium text-[var(--ui-text-secondary)] w-20">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading && items.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">加载中...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">暂无数据</td></tr>
            ) : (
              items.map((item) => (
                <tr key={item.revision_id} onClick={() => onOpenDetail(item.revision_id, item.code)} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer">
                  <td className="px-3 py-3 text-sm font-medium">
                    {item.code}
                    {(item.version_count ?? 0) > 1 && (
                      <span className="ml-1.5 text-xs text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded">
                        {item.version_count}个版本
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-sm">{item.name}</td>
                  <td className="px-2 py-3 text-sm text-[var(--ui-text-secondary)] text-center whitespace-nowrap">{formatDate(item.created_at, 'YYYY-MM-DD HH:mm')}</td>
                  <td className="px-2 py-3 text-sm font-mono text-center">{item.version}</td>
                  <td className="px-2 py-3 text-sm text-center">
                    <Badge status={item.status} />
                  </td>
                  <td className="px-2 py-3 text-sm text-center">
                    {item.check_out_user_name ? (
                      <span className="text-xs text-orange-600">{item.check_out_user_name}</span>
                    ) : (
                      <span className="text-xs text-[var(--ui-text-tertiary)]">—</span>
                    )}
                  </td>
                  <td className="px-2 py-3 text-sm text-center" onClick={(e) => e.stopPropagation()}>
                    {isAdmin() && (
                      <Button variant="danger" size="xs" onClick={(e) => { e.stopPropagation(); setDeleteId(item.revision_id); }}>删除</Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="sticky bottom-0 flex justify-center py-2 pointer-events-none">
          <div className="inline-flex items-center gap-3 text-sm text-[var(--ui-text-secondary)] bg-[var(--ui-bg-surface)] border border-[var(--ui-border)] rounded-full shadow-lg px-4 py-2 pointer-events-auto">
            共 <span className="font-medium">{total}</span> 条
            <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading}>上一页</Button>
            <span className="tabular-nums">第 {page} / {pageCount} 页</span>
            <Button variant="secondary" size="sm" onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page >= pageCount || loading}>下一页</Button>
          </div>
        </div>
      </div>

      <ConfigurationCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => { setCreateOpen(false); setPage(1); setRefreshToken(t => t + 1); }}
      />

      <ConfirmModal
        open={!!deleteId}
        title={deleteError ? "无法删除" : "删除构型项"}
        content={deleteError || "确认删除该构型项？此操作不可恢复。"}
        confirmText={deleteError ? "知道了" : "删除"}
        type="danger"
        onConfirm={deleteError ? () => { setDeleteId(null); setDeleteError(null); } : handleDelete}
        onCancel={() => { setDeleteId(null); setDeleteError(null); }}
      />

    </div>
  );
}

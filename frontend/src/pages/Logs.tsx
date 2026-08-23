import { useEffect, useState } from 'react';
import { logsApi } from '../services/api';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import type { BadgeTone } from '../constants/badges';
import type { OperationLog } from '../types';
import { formatDateTime } from '../utils/date';

const PAGE_SIZE = 20;

const actionTone = (action: string): BadgeTone => {
  if (action.includes('创建') || action.includes('create')) return 'green';
  if (action.includes('删除') || action.includes('delete')) return 'red';
  if (action.includes('登录') || action.includes('login')) return 'blue';
  return 'gray';
};

const ACTION_OPTIONS = [
  { value: '', label: '全部操作' },
  { value: 'create', label: '创建' },
  { value: 'update', label: '更新' },
  { value: 'delete', label: '删除' },
  { value: 'login', label: '登录' },
];

const TARGET_TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'part', label: '零件' },
  { value: 'assembly', label: '部件' },
  { value: 'document', label: '图文档' },
  { value: 'project', label: '项目' },
  { value: 'project_task', label: '任务' },
  { value: 'user', label: '用户' },
  { value: 'custom_field', label: '自定义字段' },
];

export default function Logs() {
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  // Filters
  const [filterUser, setFilterUser] = useState('');
  const [filterTargetType, setFilterTargetType] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  useEffect(() => {
    loadLogs();
  }, [page, filterUser, filterTargetType, filterAction, filterDateFrom, filterDateTo]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        skip: page * PAGE_SIZE,
        limit: PAGE_SIZE,
      };
      if (filterUser) params.user_id = filterUser;
      if (filterTargetType) params.target_type = filterTargetType;
      if (filterAction) params.action = filterAction;
      if (filterDateFrom) params.start_date = filterDateFrom;
      if (filterDateTo) params.end_date = filterDateTo;

      const response = await logsApi.list(params as any);
      setLogs(response.data.items || []);
      setTotal(response.data.total || 0);
    } catch (error) {
      console.error('加载日志失败', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    loadLogs();
  };

  const handleReset = () => {
    setFilterUser('');
    setFilterTargetType('');
    setFilterAction('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setPage(0);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>

      {/* Filters */}
      <form onSubmit={handleSearch} className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] p-4 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs text-[var(--ui-text-secondary)] mb-1">用户ID</label>
            <Input
              type="text"
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              placeholder="用户ID"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--ui-text-secondary)] mb-1">对象类型</label>
            <Select
              value={filterTargetType}
              onChange={(e) => setFilterTargetType(e.target.value)}
            >
              {TARGET_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-xs text-[var(--ui-text-secondary)] mb-1">操作类型</label>
            <Select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
            >
              {ACTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-xs text-[var(--ui-text-secondary)] mb-1">开始日期</label>
            <Input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--ui-text-secondary)] mb-1">结束日期</label>
            <Input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={handleReset}
          >
            重置
          </Button>
          <Button
            type="submit"
            size="md"
          >
            搜索
          </Button>
        </div>
      </form>

      {/* Table */}
      <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-hidden">
        <table className="w-full">
          <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)]">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">时间</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">用户</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">操作</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">对象类型</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">对象ID</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">详情</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">加载中...</td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">
                  暂无数据
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-[var(--ui-bg-hover)]">
                  <td className="px-4 py-3 text-sm text-[var(--ui-text-secondary)] whitespace-nowrap">
                    {formatDateTime(log.created_at)}
                  </td>
                  <td className="px-4 py-3 text-sm">{log.username}</td>
                  <td className="px-4 py-3 text-sm">
                    <Badge tone={actionTone(log.action)} label={log.action} />
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--ui-text-secondary)]">
                    {TARGET_TYPE_OPTIONS.find(t => t.value === log.target_type)?.label || log.target_type}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--ui-text-secondary)] font-mono text-xs">{log.target_id}</td>
                  <td className="px-4 py-3 text-sm text-[var(--ui-text-secondary)] max-w-xs truncate" title={log.detail || ''}>
                    {log.detail || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--ui-text-secondary)]">{log.ip || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-[var(--ui-border)] flex items-center justify-between">
            <div className="text-sm text-[var(--ui-text-secondary)]">
              共 {total} 条记录，第 {page + 1} / {totalPages} 页
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPage(0)} disabled={page === 0}>
                首页
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPage(page - 1)} disabled={page === 0}>
                上一页
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1}>
                下一页
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>
                末页
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
import { useEffect, useState } from 'react';
import { logsApi } from '../services/api';
import type { OperationLog } from '../types';

const PAGE_SIZE = 20;

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
      <form onSubmit={handleSearch} className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">用户ID</label>
            <input
              type="text"
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
              placeholder="用户ID"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">对象类型</label>
            <select
              value={filterTargetType}
              onChange={(e) => setFilterTargetType(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
            >
              {TARGET_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">操作类型</label>
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
            >
              {ACTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">开始日期</label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">结束日期</label>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            重置
          </button>
          <button
            type="submit"
            className="px-4 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            搜索
          </button>
        </div>
      </form>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">时间</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">用户</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">操作</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">对象类型</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">对象ID</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">详情</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">加载中...</td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  暂无数据
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                    {log.created?.slice(0, 19).replace('T', ' ') || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm">{log.username}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${
                      log.action.includes('创建') || log.action.includes('create')
                        ? 'bg-green-100 text-green-800'
                        : log.action.includes('删除') || log.action.includes('delete')
                        ? 'bg-red-100 text-red-800'
                        : log.action.includes('登录') || log.action.includes('login')
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {TARGET_TYPE_OPTIONS.find(t => t.value === log.target_type)?.label || log.target_type}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono text-xs">{log.target_id}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate" title={log.detail || ''}>
                    {log.detail || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{log.ip || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              共 {total} 条记录，第 {page + 1} / {totalPages} 页
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(0)}
                disabled={page === 0}
                className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                首页
              </button>
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 0}
                className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                上一页
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                下一页
              </button>
              <button
                onClick={() => setPage(totalPages - 1)}
                disabled={page >= totalPages - 1}
                className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                末页
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
import { useState, useEffect } from 'react';
import api from '../services/api';
import { isAdmin } from '../stores/auth';
import { ConfirmModal } from '../components/Modal';

interface TableStats {
  count: number;
  earliest: string | null;
  latest: string | null;
}

interface SoftDeletedStats {
  [table: string]: TableStats;
}

const TABLE_LABELS: Record<string, string> = {
  parts: '零件',
  assemblies: '部件',
  documents: '图文档',
  bom_items: 'BOM 关系',
  ecrs: 'ECR 变更请求',
  ecos: 'ECO 变更指令',
  configuration_items: '构型项',
};

export default function DataManagement() {
  const [stats, setStats] = useState<SoftDeletedStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [beforeDate, setBeforeDate] = useState('');
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/admin/soft-deleted-stats');
      setStats(res.data);
      // 默认选中所有有数据的表
      const tables = new Set<string>();
      for (const [key, val] of Object.entries(res.data as SoftDeletedStats)) {
        if (val.count > 0) tables.add(key);
      }
      setSelectedTables(tables);
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (!isAdmin()) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        仅管理员可访问数据管理功能
      </div>
    );
  }

  const toggleTable = (table: string) => {
    setSelectedTables(prev => {
      const next = new Set(prev);
      if (next.has(table)) next.delete(table); else next.add(table);
      return next;
    });
  };

  const setPresetDate = (days: number | null) => {
    if (days === null) {
      setBeforeDate(''); // 全部清理
    } else {
      const d = new Date();
      d.setDate(d.getDate() - days);
      setBeforeDate(d.toISOString().split('T')[0]);
    }
  };

  const getPresetDateStr = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  };

  const handlePurge = async () => {
    setPurging(true);
    setPurgeResult(null);
    try {
      const res = await api.post('/admin/purge-soft-deleted', {
        tables: Array.from(selectedTables),
        before_date: beforeDate || undefined,
        confirm: true,
      });
      const skipped: Record<string, string> = res.data.skipped || {};
      const skippedNote = Object.keys(skipped).length > 0
        ? `；跳过 ${Object.entries(skipped).map(([t, r]) => `${t}（${r}）`).join('、')}`
        : '';
      setPurgeResult(`成功清理 ${res.data.total} 条记录${skippedNote}`);
      fetchStats();
    } catch (e: any) {
      setPurgeResult(`清理失败: ${e.response?.data?.detail || e.message}`);
    } finally {
      setPurging(false);
      setPurgeConfirmOpen(false);
    }
  };

  const totalDeleted = stats
    ? Object.values(stats).reduce((sum, s) => sum + s.count, 0)
    : 0;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h2 className="text-xl font-semibold mb-6">数据管理</h2>

      {loading && (
        <div className="text-gray-400 text-center py-8">加载中...</div>
      )}

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded mb-4">{error}</div>
      )}

      {stats && (
        <>
          {/* 统计概览 */}
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-6">
            <div className="text-sm text-blue-700">
              当前软删除记录总计: <span className="font-bold text-lg">{totalDeleted}</span> 条
            </div>
          </div>

          {/* 分表统计 */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-6">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">表名</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">数量</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">最早删除时间</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">最近删除时间</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(stats).map(([table, s]) => (
                  <tr key={table} className="border-b last:border-b-0 hover:bg-gray-50">
                    <td className="px-4 py-3">{TABLE_LABELS[table] || table}</td>
                    <td className={`px-4 py-3 text-right ${s.count > 0 ? 'text-orange-600 font-medium' : 'text-gray-400'}`}>
                      {s.count}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {s.earliest ? new Date(s.earliest).toLocaleString('zh-CN') : '--'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {s.latest ? new Date(s.latest).toLocaleString('zh-CN') : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 清理操作区 */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h3 className="font-medium mb-4">清理软删除数据</h3>
            <p className="text-sm text-gray-500 mb-4">
              选择要清理的表和日期范围。清理操作不可逆，建议先备份数据库。
            </p>

            {/* 表选择 */}
            <div className="mb-4">
              <div className="text-sm text-gray-600 mb-2">选择要清理的表:</div>
              <div className="flex flex-wrap gap-2">
                {Object.keys(TABLE_LABELS).map(table => (
                  <label
                    key={table}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm cursor-pointer border transition-colors ${
                      selectedTables.has(table)
                        ? 'border-blue-400 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTables.has(table)}
                      onChange={() => toggleTable(table)}
                      className="sr-only"
                    />
                    {TABLE_LABELS[table]}
                  </label>
                ))}
              </div>
            </div>

            {/* 日期选择 */}
            <div className="mb-4">
              <div className="text-sm text-gray-600 mb-2">清理此日期之前的数据（可选）:</div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <button onClick={() => setPresetDate(null)} className={`px-3 py-1 rounded text-xs border transition-colors ${!beforeDate ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  全部清理
                </button>
                <button onClick={() => setPresetDate(30)} className={`px-3 py-1 rounded text-xs border transition-colors ${beforeDate === getPresetDateStr(30) ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  清理30天前
                </button>
                <button onClick={() => setPresetDate(90)} className={`px-3 py-1 rounded text-xs border transition-colors ${beforeDate === getPresetDateStr(90) ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  清理90天前
                </button>
                <button onClick={() => setPresetDate(180)} className={`px-3 py-1 rounded text-xs border transition-colors ${beforeDate === getPresetDateStr(180) ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                  清理180天前
                </button>
              </div>
              <input
                type="date"
                value={beforeDate}
                onChange={(e) => setBeforeDate(e.target.value)}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm"
              />
              {!beforeDate && (
                <span className="text-xs text-gray-400 ml-2">留空则清理所有软删除数据</span>
              )}
            </div>

            {purgeResult && (
              <div className={`text-sm p-3 rounded mb-4 ${
                purgeResult.includes('失败') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'
              }`}>
                {purgeResult}
              </div>
            )}

            <button
              onClick={() => setPurgeConfirmOpen(true)}
              disabled={selectedTables.size === 0 || purging}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-40 text-sm"
            >
              执行清理
            </button>
          </div>

          <ConfirmModal
            open={purgeConfirmOpen}
            title="确认清理"
            content={`将永久删除 ${Array.from(selectedTables).map(t => TABLE_LABELS[t]).join('、')} 的软删除数据。此操作不可逆，确认继续？`}
            confirmText="确认清理"
            cancelText="取消"
            type="danger"
            onConfirm={handlePurge}
            onCancel={() => setPurgeConfirmOpen(false)}
          />
        </>
      )}
    </div>
  );
}

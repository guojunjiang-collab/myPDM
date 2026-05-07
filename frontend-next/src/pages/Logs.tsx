import { useEffect, useState } from 'react';
import { logsApi } from '../services/api';
import type { OperationLog } from '../types';

export default function Logs() {
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    try {
      const response = await logsApi.list();
      setLogs(response.data.items || []);
    } catch (error) {
      console.error('加载日志失败', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-gray-500">加载中...</div>;
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">操作日志</h2>
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
            {logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  暂无数据
                </td>
              </tr>
            ) : (
              logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {log.created?.slice(0, 19) || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm">{log.username}</td>
                  <td className="px-4 py-3 text-sm">{log.action}</td>
                  <td className="px-4 py-3 text-sm">{log.target_type}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{log.target_id}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{log.detail || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{log.ip || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
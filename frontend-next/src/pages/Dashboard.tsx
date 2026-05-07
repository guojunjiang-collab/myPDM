import { useEffect, useState } from 'react';
import { dashboardApi } from '../services/api';
import type { DashboardStats } from '../types';

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const response = await dashboardApi.getStats();
      setStats(response.data);
    } catch (error) {
      console.error('加载统计数据失败', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-gray-500">加载中...</div>;
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">仪表盘</h2>
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="零件总数" value={stats?.total_parts ?? 0} color="blue" />
        <StatCard label="部件总数" value={stats?.total_assemblies ?? 0} color="green" />
        <StatCard label="图文档总数" value={stats?.total_documents ?? 0} color="orange" />
        <StatCard label="用户总数" value={stats?.total_users ?? 0} color="purple" />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'blue' | 'green' | 'orange' | 'purple';
}) {
  const colorClasses = {
    blue: 'bg-blue-50 border-blue-200 text-blue-600',
    green: 'bg-green-50 border-green-200 text-green-600',
    orange: 'bg-orange-50 border-orange-200 text-orange-600',
    purple: 'bg-purple-50 border-purple-200 text-purple-600',
  };

  return (
    <div
      className={`p-6 rounded-lg border ${colorClasses[color]} transition-all hover:shadow-md`}
    >
      <p className="text-sm opacity-75">{label}</p>
      <p className="text-3xl font-semibold mt-1">{value}</p>
    </div>
  );
}
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
      
      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="零件总数" value={stats?.total_parts ?? 0} icon="🔧" color="blue" />
        <StatCard label="部件总数" value={stats?.total_assemblies ?? 0} icon="📦" color="green" />
        <StatCard label="图文档总数" value={stats?.total_documents ?? 0} icon="📄" color="orange" />
        <StatCard label="用户总数" value={stats?.total_users ?? 0} icon="👥" color="purple" />
      </div>

      {/* 快捷操作 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h3 className="text-lg font-medium mb-4">快捷操作</h3>
        <div className="grid grid-cols-4 gap-4">
          <QuickAction icon="🔧" label="新增零件" href="/parts" color="bg-blue-50" />
          <QuickAction icon="📦" label="新增部件" href="/components" color="bg-green-50" />
          <QuickAction icon="📄" label="新增图文档" href="/documents" color="bg-orange-50" />
          <QuickAction icon="📋" label="BOM管理" href="/bom" color="bg-purple-50" />
        </div>
      </div>

      {/* 最近活动 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-medium mb-4">系统概览</h3>
        <div className="grid grid-cols-2 gap-6">
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500 mb-1">零件状态分布</p>
            <div className="flex gap-2 items-center">
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden flex">
                <div className="bg-blue-500" style={{ width: '30%' }} />
                <div className="bg-green-500" style={{ width: '40%' }} />
                <div className="bg-orange-500" style={{ width: '20%' }} />
                <div className="bg-red-500" style={{ width: '10%' }} />
              </div>
            </div>
            <div className="flex gap-4 mt-2 text-xs text-gray-500">
              <span>● 草稿 30%</span>
              <span>● 发布 40%</span>
              <span>● 冻结 20%</span>
              <span>● 作废 10%</span>
            </div>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500 mb-1">系统健康状态</p>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-green-500 rounded-full"></span>
              <span className="text-lg font-medium text-green-600">运行正常</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">所有服务正常</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: string;
  color: 'blue' | 'green' | 'orange' | 'purple';
}) {
  const colorClasses = {
    blue: 'bg-blue-50 border-blue-200 text-blue-600',
    green: 'bg-green-50 border-green-200 text-green-600',
    orange: 'bg-orange-50 border-orange-200 text-orange-600',
    purple: 'bg-purple-50 border-purple-200 text-purple-600',
  };

  return (
    <div className={`p-6 rounded-lg border ${colorClasses[color]} transition-all hover:shadow-md`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm opacity-75">{label}</p>
          <p className="text-3xl font-semibold mt-1">{value}</p>
        </div>
        <span className="text-3xl">{icon}</span>
      </div>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  href,
  color,
}: {
  icon: string;
  label: string;
  href: string;
  color: string;
}) {
  return (
    <a
      href={href}
      className={`flex items-center gap-3 p-4 rounded-lg ${color} hover:shadow-md transition-all`}
    >
      <span className="text-2xl">{icon}</span>
      <span className="font-medium text-gray-700">{label}</span>
    </a>
  );
}
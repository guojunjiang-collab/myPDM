import { useEffect, useState, useMemo } from 'react';
import { useDataStore } from '../stores/data';
import { usersApi } from '../services/api';
import type { User } from '../types';

type EntityStatus = 'draft' | 'frozen' | 'released' | 'obsolete';

interface StatusCounts {
  total: number;
  draft: number;
  frozen: number;
  released: number;
  obsolete: number;
}

function countByStatus<T extends { status: EntityStatus }>(items: T[]): StatusCounts {
  const counts: StatusCounts = { total: 0, draft: 0, frozen: 0, released: 0, obsolete: 0 };
  for (const item of items) {
    counts.total++;
    counts[item.status]++;
  }
  return counts;
}

const STATUS_COLORS: Record<string, string> = {
  total: 'text-gray-900',
  draft: 'text-blue-600',
  frozen: 'text-orange-500',
  released: 'text-green-600',
  obsolete: 'text-red-500',
};

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  frozen: '冻结',
  released: '发布',
  obsolete: '作废',
};

interface RoleCounts {
  total: number;
  admin: number;
  engineer: number;
  production: number;
  guest: number;
}

function countByRole(users: User[]): RoleCounts {
  const counts: RoleCounts = { total: 0, admin: 0, engineer: 0, production: 0, guest: 0 };
  for (const u of users) {
    counts.total++;
    const role = u.role as keyof Omit<RoleCounts, 'total'>;
    if (role in counts) {
      counts[role]++;
    }
  }
  return counts;
}

const ROLE_COLORS: Record<string, string> = {
  total: 'text-gray-900',
  admin: 'text-red-600',
  engineer: 'text-blue-600',
  production: 'text-green-600',
  guest: 'text-gray-500',
};

const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  engineer: '工程师',
  production: '生产人员',
  guest: '访客',
};

/* ---- hook: fetch users once ---- */
function useUserList(): User[] {
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await usersApi.list({ page_size: 10000 });
        const data = res.data;
        const list: User[] = Array.isArray(data) ? data : (data?.items ?? []);
        if (!cancelled) setUsers(list);
      } catch {
        // silent — show 0
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return users;
}

export default function Dashboard() {
  const parts = useDataStore((s) => s.parts);
  const assemblies = useDataStore((s) => s.assemblies);
  const documents = useDataStore((s) => s.documents);

  const users = useUserList();

  const partsCounts = useMemo(() => countByStatus(parts), [parts]);
  const assembliesCounts = useMemo(() => countByStatus(assemblies), [assemblies]);
  const documentsCounts = useMemo(() => countByStatus(documents), [documents]);
  const usersCounts = useMemo(() => countByRole(users), [users]);

  const hasData = parts.length > 0 || assemblies.length > 0 || documents.length > 0;

  return (
    <div>

      {!hasData && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 text-sm">
          当前无本地缓存数据，请先在对应页面检出数据。统计数据将自动从本地缓存计算。
        </div>
      )}

      <div className="space-y-4">
        <StatusCard title="零件统计" icon="🔧" counts={partsCounts} colorMap={STATUS_COLORS} labelMap={STATUS_LABELS} />
        <StatusCard title="部件统计" icon="📦" counts={assembliesCounts} colorMap={STATUS_COLORS} labelMap={STATUS_LABELS} />
        <StatusCard title="图文档统计" icon="📄" counts={documentsCounts} colorMap={STATUS_COLORS} labelMap={STATUS_LABELS} />

        <RoleCard counts={usersCounts} />

        {/* 快捷操作 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-medium mb-4">快捷操作</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <QuickAction icon="🔧" label="新增零件" href="/parts" color="bg-blue-50" />
            <QuickAction icon="📦" label="新增部件" href="/components" color="bg-green-50" />
            <QuickAction icon="📄" label="新增图文档" href="/documents" color="bg-orange-50" />
            <QuickAction icon="📋" label="BOM管理" href="/bom" color="bg-purple-50" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Sub-components ---- */

function StatusCard({
  title,
  icon,
  counts,
  colorMap,
  labelMap,
}: {
  title: string;
  icon: string;
  counts: StatusCounts;
  colorMap: Record<string, string>;
  labelMap: Record<string, string>;
}) {
  const items = [
    { key: 'total', label: '总数', value: counts.total, color: colorMap['total'] },
    { key: 'draft', label: labelMap['draft'], value: counts.draft, color: colorMap['draft'] },
    { key: 'frozen', label: labelMap['frozen'], value: counts.frozen, color: colorMap['frozen'] },
    { key: 'released', label: labelMap['released'], value: counts.released, color: colorMap['released'] },
    { key: 'obsolete', label: labelMap['obsolete'], value: counts.obsolete, color: colorMap['obsolete'] },
  ];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">{icon}</span>
        <h3 className="text-lg font-medium text-gray-800">{title}</h3>
      </div>
      <div className="grid grid-cols-5 gap-4">
        {items.map((item) => (
          <div key={item.key} className="text-center p-3 bg-gray-50 rounded-lg">
            <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
            <p className="text-xs text-gray-500 mt-1">{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoleCard({ counts }: { counts: RoleCounts }) {
  const items = [
    { key: 'total', label: '总用户数', value: counts.total, color: ROLE_COLORS['total'] },
    { key: 'admin', label: ROLE_LABELS['admin'], value: counts.admin, color: ROLE_COLORS['admin'] },
    { key: 'engineer', label: ROLE_LABELS['engineer'], value: counts.engineer, color: ROLE_COLORS['engineer'] },
    { key: 'production', label: ROLE_LABELS['production'], value: counts.production, color: ROLE_COLORS['production'] },
    { key: 'guest', label: ROLE_LABELS['guest'], value: counts.guest, color: ROLE_COLORS['guest'] },
  ];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">👥</span>
        <h3 className="text-lg font-medium text-gray-800">用户统计</h3>
      </div>
      <div className="grid grid-cols-5 gap-4">
        {items.map((item) => (
          <div key={item.key} className="text-center p-3 bg-gray-50 rounded-lg">
            <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
            <p className="text-xs text-gray-500 mt-1">{item.label}</p>
          </div>
        ))}
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

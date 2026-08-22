import { useEffect, useMemo, useState } from 'react';
import { usersApi } from '../../services/api';
import { can } from '../../stores/auth';
import EmptyState from '../components/EmptyState';
import { useDebounced } from '../../hooks/useDebounced';

/**
 * 移动端用户管理（只读列表 + admin 重置密码）：
 * - GET /api/users/ 拉取用户（limit=100），搜索/角色前端本地过滤
 * - 重置密码：与桌面一致 PUT /users/{id} { password: '123456' }
 */

const ROLE_LABEL: Record<string, string> = {
  admin: '管理员',
  engineer: '工程师',
  production: '生产',
  guest: '访客',
  unverified: '待审批',
};

const ROLE_FILTERS = [
  { key: '', label: '全部' },
  { key: 'admin', label: '管理员' },
  { key: 'engineer', label: '工程师' },
  { key: 'production', label: '生产' },
  { key: 'guest', label: '访客' },
];

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  active: { label: '正常', cls: 'bg-green-100 text-green-800' },
  disabled: { label: '停用', cls: 'bg-gray-100 text-gray-500' },
};

interface UserRow {
  id: string;
  username: string;
  real_name?: string;
  role?: string;
  status?: string;
  created_at?: string;
}

function fmtDate(v?: string): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('zh-CN');
}

export default function UsersListPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [roleFilter, setRoleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const canReset = can('users:update');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    usersApi
      .list({ limit: 100 })
      .then((res) => {
        if (!alive) return;
        setUsers(((res.data?.items ?? res.data ?? []) as UserRow[]) || []);
        setError(false);
      })
      .catch(() => {
        if (alive) {
          setUsers([]);
          setError(true);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const kw = debounced.trim().toLowerCase();
    return users.filter(
      (u) =>
        (!roleFilter || u.role === roleFilter) &&
        (!kw ||
          (u.username || '').toLowerCase().includes(kw) ||
          (u.real_name || '').toLowerCase().includes(kw)),
    );
  }, [users, debounced, roleFilter]);

  const onResetPassword = (u: UserRow) => {
    if (!window.confirm(`确定将用户「${u.real_name || u.username}」的密码重置为 123456 吗？`)) return;
    usersApi
      .update(u.id, { password: '123456' })
      .then(() => window.alert('密码已重置为 123456'))
      .catch(() => window.alert('重置密码失败'));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 bg-gray-50 px-3 pt-2 pb-1 z-10">
        <input
          className="w-full h-11 px-4 rounded-lg bg-white border border-gray-200 text-base"
          placeholder="搜索姓名/用户名..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex items-center gap-2 mt-2">
          {ROLE_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setRoleFilter(f.key)}
              className={`min-h-10 px-3 rounded-lg text-xs ${roleFilter === f.key ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
      {!loading && error && <p className="text-center text-xs text-red-400 py-3">加载失败，请稍后重试</p>}
      {!loading && !error && filtered.length === 0 && <EmptyState text="未找到用户" />}

      {!loading && !error && filtered.length > 0 && (
        <div className="p-3 flex flex-col gap-2 overflow-y-auto">
          {filtered.map((u) => (
            <div key={u.id} className="bg-white rounded-lg px-4 py-3 shadow-sm flex items-center gap-3">
              <span className="shrink-0 w-10 h-10 rounded-full bg-primary-600 text-white flex items-center justify-center text-base">
                {u.real_name?.[0] ?? u.username?.[0] ?? '?'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">
                    {u.real_name || u.username}
                  </span>
                  <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-lg bg-gray-100 text-gray-600">
                    {ROLE_LABEL[u.role ?? ''] ?? u.role}
                  </span>
                  <span
                    className={`shrink-0 text-xs px-1.5 py-0.5 rounded-lg ${STATUS_MAP[u.status ?? '']?.cls ?? 'bg-gray-100 text-gray-500'}`}
                  >
                    {STATUS_MAP[u.status ?? '']?.label ?? u.status}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5 truncate">
                  {u.username}
                  {u.created_at ? ` · ${fmtDate(u.created_at)}` : ''}
                </div>
              </div>
              {canReset && (
                <button
                  onClick={() => onResetPassword(u)}
                  className="shrink-0 min-h-10 px-3 rounded-lg text-xs text-orange-600 border border-orange-200 bg-orange-50"
                >
                  重置密码
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

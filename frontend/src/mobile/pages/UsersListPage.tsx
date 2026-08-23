import { useEffect, useMemo, useState } from 'react';
import { userGroupsApi, usersApi } from '../../services/api';
import { can } from '../../stores/auth';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import TreeToggle from '../../components/ui/TreeToggle';
import EmptyState from '../components/EmptyState';
import { useDebounced } from '../../hooks/useDebounced';

/**
 * 移动端用户管理（三 Tab：全部用户 / 用户组 / 待审批）：
 * - 全部用户、用户组：只读（搜索/角色筛选/成员查看）
 * - 待审批：管理员可"通过"（设为工程师）或"拒绝"（删除）
 */

const ROLE_LABEL: Record<string, string> = {
  admin: '管理员',
  engineer: '工程师',
  production: '生产人员',
  guest: '访客',
  unverified: '未验证',
};

const ROLE_FILTERS = [
  { key: '', label: '全部' },
  { key: 'admin', label: '管理员' },
  { key: 'engineer', label: '工程师' },
  { key: 'production', label: '生产人员' },
  { key: 'guest', label: '访客' },
];

const TABS = [
  { key: 'users', label: '全部用户' },
  { key: 'groups', label: '用户组' },
  { key: 'pending', label: '待审批' },
];

interface UserRow {
  id: string;
  username: string;
  real_name?: string;
  role?: string;
  status?: string;
  created_at?: string;
}

interface GroupRow {
  id: string;
  name: string;
  description?: string;
  member_count?: number;
  created_at?: string;
}

function fmtDate(v?: string): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('zh-CN');
}

/** 用户卡片（头像 + 姓名 + 角色/状态徽标 + 用户名；右侧可选操作区） */
function UserCard({
  u,
  actions,
}: {
  u: UserRow;
  actions?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg px-4 py-3 shadow-sm flex items-center gap-3">
      <span className="shrink-0 w-10 h-10 rounded-full bg-primary-600 text-white flex items-center justify-center text-base">
        {u.real_name?.[0] ?? u.username?.[0] ?? '?'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">
            {u.real_name || u.username}
          </span>
          {u.role && <Badge status={u.role} domain="role" />}
          {u.status && <Badge status={u.status} domain="user" />}
        </div>
        <div className="text-xs text-gray-500 mt-0.5 truncate">
          {u.username}
          {u.created_at ? ` · ${fmtDate(u.created_at)}` : ''}
        </div>
      </div>
      {actions}
    </div>
  );
}

export default function UsersListPage() {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // 全部用户 Tab：搜索 + 角色筛选（本地过滤）
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [roleFilter, setRoleFilter] = useState('');

  // 用户组 Tab：组列表 + 展开成员（懒加载）
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [membersByGroup, setMembersByGroup] = useState<Record<string, string[]>>({});

  const canManage = can('users:update') && can('users:delete');

  const loadUsers = () => {
    setLoading(true);
    usersApi
      .list({ limit: 100 })
      .then((res) => {
        setUsers(((res.data?.items ?? res.data ?? []) as UserRow[]) || []);
        setError(false);
      })
      .catch(() => {
        setUsers([]);
        setError(true);
      })
      .finally(() => setLoading(false));
  };

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

  // 用户组：切到该 Tab 时加载
  useEffect(() => {
    let alive = true;
    if (activeTab !== 'groups') return;
    setGroupsLoading(true);
    setGroupsError(false);
    userGroupsApi
      .list()
      .then((res) => {
        if (alive) setGroups(((res.data ?? []) as GroupRow[]) || []);
      })
      .catch(() => {
        if (alive) {
          setGroups([]);
          setGroupsError(true);
        }
      })
      .finally(() => {
        if (alive) setGroupsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeTab]);

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const toggleGroup = (gid: string) => {
    if (expandedGroup === gid) {
      setExpandedGroup(null);
      return;
    }
    setExpandedGroup(gid);
    if (!membersByGroup[gid]) {
      userGroupsApi
        .getMembers(gid)
        .then((res) => {
          setMembersByGroup((prev) => ({ ...prev, [gid]: ((res.data as { user_ids?: string[] })?.user_ids ?? []) as string[] }));
        })
        .catch(() => {
          setMembersByGroup((prev) => ({ ...prev, [gid]: [] }));
        });
    }
  };

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

  const pending = useMemo(() => users.filter((u) => u.role === 'unverified'), [users]);

  // 待审批角色选择面板
  const [choosingRole, setChoosingRole] = useState<UserRow | null>(null);

  const onApprove = (u: UserRow, role: string) => {
    usersApi
      .update(u.id, { role })
      .then(() => {
        window.alert(`已通过，「${u.real_name || u.username}」升级为${ROLE_LABEL[role] ?? role}`);
        setChoosingRole(null);
        loadUsers();
      })
      .catch(() => window.alert('操作失败，请稍后重试'));
  };

  const onReject = (u: UserRow) => {
    if (!window.confirm(`确定拒绝并删除「${u.real_name || u.username}」的账号？`)) return;
    usersApi
      .delete(u.id)
      .then(() => {
        window.alert('已拒绝并删除账号');
        loadUsers();
      })
      .catch(() => window.alert('操作失败，请稍后重试'));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab 切换 */}
      <div className="sticky top-0 bg-gray-50 px-2 pt-2 pb-1 z-10">
        <div className="flex bg-white rounded-lg border border-gray-200 overflow-hidden">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex-1 min-h-10 text-xs whitespace-nowrap ${
                activeTab === t.key ? 'bg-[var(--ui-btn-primary-bg)] text-white font-medium' : 'text-gray-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {activeTab === 'users' && (
          <>
            <input
              className="w-full h-11 px-4 mt-2 rounded-lg bg-white border border-gray-200 text-base"
              placeholder="搜索姓名/用户名..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="flex items-center gap-2 mt-2">
              {ROLE_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setRoleFilter(f.key)}
                  className={`min-h-10 px-3 rounded-lg text-xs ${roleFilter === f.key ? 'bg-[var(--ui-btn-primary-bg)] text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Tab1 全部用户（只读） */}
      {activeTab === 'users' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
          {!loading && error && <p className="text-center text-xs text-red-400 py-3">加载失败，请稍后重试</p>}
          {!loading && !error && filtered.length === 0 && <EmptyState text="未找到用户" />}
          {!loading && !error && filtered.length > 0 && (
            <div className="p-3 flex flex-col gap-2">
              {filtered.map((u) => (
                <UserCard key={u.id} u={u} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab2 用户组（只读） */}
      {activeTab === 'groups' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {groupsLoading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
          {!groupsLoading && groupsError && (
            <p className="text-center text-xs text-red-400 py-3">加载失败，请稍后重试</p>
          )}
          {!groupsLoading && !groupsError && groups.length === 0 && <EmptyState text="暂无用户组" />}
          {!groupsLoading && !groupsError && groups.length > 0 && (
            <div className="p-3 flex flex-col gap-2">
              {groups.map((g) => (
                <div key={g.id} className="bg-white rounded-lg shadow-sm overflow-hidden">
                  <div className="w-full flex items-center gap-2 px-4 py-3 min-h-12">
                    <TreeToggle
                      expanded={expandedGroup === g.id}
                      onClick={() => toggleGroup(g.id)}
                      size="sm"
                      title={expandedGroup === g.id ? '折叠' : '展开'}
                    />
                    <button
                      onClick={() => toggleGroup(g.id)}
                      className="flex-1 min-w-0 text-left flex items-center gap-2"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-gray-800 truncate">{g.name}</span>
                        {g.description && (
                          <span className="block text-xs text-gray-500 truncate mt-0.5">{g.description}</span>
                        )}
                      </span>
                      <Badge tone="gray" label={`${g.member_count ?? 0} 人`} size="xs" />
                    </button>
                  </div>
                  {expandedGroup === g.id && (
                    <div className="border-t border-gray-100 px-4 py-2 flex flex-col">
                      {!membersByGroup[g.id] ? (
                        <p className="text-xs text-gray-400 py-2">加载中...</p>
                      ) : membersByGroup[g.id].length === 0 ? (
                        <p className="text-xs text-gray-400 py-2">暂无成员</p>
                      ) : (
                        membersByGroup[g.id].map((uid) => {
                          const m = userById.get(uid);
                          return (
                            <div key={uid} className="py-2 border-b border-gray-50 last:border-b-0 flex items-center gap-2">
                              <span className="shrink-0 w-7 h-7 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs">
                                {m?.real_name?.[0] ?? m?.username?.[0] ?? '?'}
                              </span>
                              <span className="text-sm text-gray-800 truncate">{m?.real_name || m?.username || uid}</span>
                              {m?.real_name && m.username !== m.real_name && (
                                <span className="text-xs text-gray-400 truncate">{m.username}</span>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab3 待审批 */}
      {activeTab === 'pending' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
          {!loading && error && <p className="text-center text-xs text-red-400 py-3">加载失败，请稍后重试</p>}
          {!loading && !error && pending.length === 0 && <EmptyState text="暂无待审批账号" />}
          {!loading && !error && pending.length > 0 && (
            <div className="p-3 flex flex-col gap-2">
              {pending.map((u) => (
                <UserCard
                  key={u.id}
                  u={u}
                  actions={
                    canManage ? (
                      <div className="shrink-0 flex gap-2">
                        <Button
                          onClick={() => setChoosingRole(u)}
                          variant="success"
                          size="xs"
                          className="min-h-10 px-3 rounded-lg"
                        >
                          通过
                        </Button>
                        <Button
                          onClick={() => onReject(u)}
                          variant="danger"
                          size="xs"
                          className="min-h-10 px-3 rounded-lg"
                        >
                          拒绝
                        </Button>
                      </div>
                    ) : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 待审批：选择角色面板 */}
      {choosingRole && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-8"
          onClick={() => setChoosingRole(null)}
        >
          <div
            className="bg-white rounded-lg w-72 p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-medium text-gray-900 mb-1">
              审批通过「{choosingRole.real_name || choosingRole.username}」
            </div>
            <div className="text-xs text-gray-500 mb-3">选择分配的角色：</div>
            <div className="flex flex-col gap-2">
              {(['engineer', 'production', 'guest'] as const).map((r) => (
                <Button
                  key={r}
                  onClick={() => onApprove(choosingRole, r)}
                  variant="primary"
                  size="touch"
                  className="w-full"
                >
                  {ROLE_LABEL[r]}
                </Button>
              ))}
              <Button
                onClick={() => setChoosingRole(null)}
                variant="ghost"
                size="touch"
                className="w-full"
              >
                取消
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

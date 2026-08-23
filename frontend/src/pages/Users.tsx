import { useEffect, useState } from 'react';
import { usersApi, userGroupsApi } from '../services/api';
import type { User } from '../types';
import { isAdmin, can } from '../stores/auth';
import { Modal, ConfirmModal } from '../components/Modal';
import { toast } from '../components/Toast';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
import FormField from '../components/ui/FormField';
import Alert from '../components/ui/Alert';
import { useTableSort } from '../hooks/useTableSort';
import { formatDateTime } from '../utils/date';

interface UserFormData {
  username: string;
  real_name: string;
  role: string;
  department: string;
  phone: string;
  status: string;
  password: string;
}

const initialFormData: UserFormData = {
  username: '',
  real_name: '',
  role: 'engineer',
  department: '',
  phone: '',
  status: 'active',
  password: '',
};

const RoleTag = ({ role }: { role: string }) => <Badge status={role} domain="role" />;
const StatusTag = ({ status }: { status: string }) => <Badge status={status} domain="user" />;

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<UserFormData>(initialFormData);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'groups'>('all');
  const [groups, setGroups] = useState<Array<{ id: string; name: string; description?: string; member_count: number }>>([]);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<{ id: string; name: string; description?: string } | null>(null);
  const [groupForm, setGroupForm] = useState<{ name: string; description: string }>({ name: '', description: '' });
  const [memberSelectedIds, setMemberSelectedIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [userGroupIds, setUserGroupIds] = useState<string[]>([]);
  const [viewingGroupId, setViewingGroupId] = useState<string | null>(null);
  const [viewingGroupMembers, setViewingGroupMembers] = useState<string[]>([]);

  const { sortedData, handleSort, getSortIcon } = useTableSort<User>(users);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const res = await usersApi.list();
      const data = res.data;
      setUsers(Array.isArray(data) ? data : (data as any)?.items || []);
    } catch {
      /* handled silently */
    } finally {
      setLoading(false);
    }
  };

  const [unverifiedUsers, setUnverifiedUsers] = useState<User[]>([]);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const loadUnverifiedUsers = async () => {
    try {
      const res = await usersApi.list({ role: 'unverified', limit: 100 });
      const data = res.data;
      setUnverifiedUsers(Array.isArray(data) ? data : (data as any)?.items || []);
    } catch {
      /* handled silently */
    }
  };

  const handleApprove = async (userId: string, newRole: string) => {
    setApprovingId(userId);
    try {
      await usersApi.update(userId, { role: newRole });
      await loadUnverifiedUsers();
    } catch {
      /* handled silently */
    } finally {
      setApprovingId(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'pending') loadUnverifiedUsers();
  }, [activeTab]);

  const loadGroups = async () => {
    const res = await userGroupsApi.list();
    setGroups(Array.isArray(res.data) ? res.data : []);
  };

  useEffect(() => {
    if (activeTab === 'groups') loadGroups();
  }, [activeTab]);

  const handleAdd = () => {
    setEditingUser(null);
    setFormData(initialFormData);
    setSaveError(null);
    setUserGroupIds([]);
    setModalOpen(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      real_name: user.real_name,
      role: user.role,
      department: user.department || '',
      phone: user.phone || '',
      status: user.status,
      password: '',
    });
    setSaveError(null);
    usersApi.getGroups(user.id).then((gr) => setUserGroupIds((gr.data?.group_ids || []).map(String))).catch(() => {});
    loadGroups();
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);

    try {
      let savedId = editingUser?.id || '';
      if (editingUser) {
        const data: Record<string, unknown> = {
          real_name: formData.real_name,
          role: formData.role,
          department: formData.department || undefined,
          phone: formData.phone || undefined,
          status: formData.status,
        };
        if (formData.password) {
          data.password = formData.password;
        }
        await usersApi.update(editingUser.id, data);
      } else {
        const res = await usersApi.create({
          username: formData.username,
          real_name: formData.real_name,
          role: formData.role,
          department: formData.department || undefined,
          phone: formData.phone || undefined,
          status: formData.status,
          password: formData.password,
        });
        savedId = (res.data as any)?.id || '';
      }
      if (savedId) {
        await usersApi.setGroups(savedId, userGroupIds);
      }
      setModalOpen(false);
      await loadUsers();
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      setSaveError(
        typeof detail === 'string' ? detail : (editingUser ? '更新失败，请重试' : '创建失败，请检查数据'),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await usersApi.delete(deleteId);
      setDeleteId(null);
      await loadUsers();
    } catch {
      toast.error('删除失败');
    }
  };

  const handleResetPassword = async () => {
    if (!resetId) return;
    try {
      await usersApi.update(resetId, { password: '123456' });
      setResetId(null);
    } catch {
      toast.error('重置密码失败');
    }
  };

  // 保存用户组 loading/错误（阶段2c 补缺口）
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const saveGroup = async () => {
    setGroupSaving(true); setGroupError(null);
    try {
      let groupId = editingGroup?.id || '';
      if (editingGroup) {
        await userGroupsApi.update(editingGroup.id, groupForm);
      } else {
        const res = await userGroupsApi.create(groupForm);
        groupId = (res.data as any)?.id || '';
      }
      if (groupId) {
        await userGroupsApi.setMembers(groupId, memberSelectedIds);
      }
      setGroupModalOpen(false);
      await loadGroups();
    } catch (err: any) {
      setGroupError(err?.response?.data?.detail || '保存失败，请重试');
    } finally {
      setGroupSaving(false);
    }
  };

  // 删除用户组确认（状态驱动 ConfirmModal）
  const [confirmGroupId, setConfirmGroupId] = useState<string | null>(null);
  const removeGroup = (id: string) => setConfirmGroupId(id);

  const viewGroupDetail = async (groupId: string) => {
    setViewingGroupId(groupId);
    try {
      const res = await userGroupsApi.getMembers(groupId);
      setViewingGroupMembers((res.data?.user_ids || []).map(String));
    } catch {
      setViewingGroupMembers([]);
    }
  };

  /* 前端搜索过滤 */
  const displayData = (() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return sortedData;
    return sortedData.filter(
      (u) =>
        u.username.toLowerCase().includes(keyword) ||
        u.real_name.toLowerCase().includes(keyword) ||
        (u.department || '').toLowerCase().includes(keyword),
    );
  })();

  return (
    <div>
      {/* Tab 切换栏 */}
      <div className="flex gap-2 mb-4 border-b border-[var(--ui-border)]">
        <button
          className={`px-4 h-[var(--ui-control-h)] inline-flex items-center -mb-px border-b-2 text-sm ${activeTab === 'all' ? 'border-primary-600 text-primary-700 font-medium' : 'border-transparent text-[var(--ui-text-secondary)]'}`}
          onClick={() => setActiveTab('all')}
        >全部用户</button>
        {can('user_groups:read' as any) && (
          <button
            className={`px-4 h-[var(--ui-control-h)] inline-flex items-center -mb-px border-b-2 text-sm ${activeTab === 'groups' ? 'border-primary-600 text-primary-700 font-medium' : 'border-transparent text-[var(--ui-text-secondary)]'}`}
            onClick={() => setActiveTab('groups')}
          >用户组</button>
        )}
        {isAdmin() && (
          <button
            className={`px-4 h-[var(--ui-control-h)] inline-flex items-center -mb-px border-b-2 text-sm ${activeTab === 'pending' ? 'border-primary-600 text-primary-700 font-medium' : 'border-transparent text-[var(--ui-text-secondary)]'}`}
            onClick={() => setActiveTab('pending')}
          >
            待审批
            {unverifiedUsers.length > 0 && (
              <span className="ml-1.5"><Badge size="xs" tone="amber" label={unverifiedUsers.length} /></span>
            )}
          </button>
        )}
      </div>

      {/* 用户 Tab */}
      {activeTab === 'all' && (
        <>
      {/* 头部：搜索 + 新增用户 */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <Input
          type="text"
          placeholder="搜索用户名/姓名/部门..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        {isAdmin() && (
          <Button onClick={handleAdd}>
            + 新增用户
          </Button>
        )}
      </div>

      {/* 列表 */}
      <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-hidden">
        <table className="w-full">
          <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)]">
            <tr>
              <th onClick={() => handleSort('username' as keyof User)} className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none">用户名 {getSortIcon('username' as keyof User)}</th>
              <th onClick={() => handleSort('real_name' as keyof User)} className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none">姓名 {getSortIcon('real_name' as keyof User)}</th>
              <th onClick={() => handleSort('role' as keyof User)} className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none">角色 {getSortIcon('role' as keyof User)}</th>
              <th onClick={() => handleSort('department' as keyof User)} className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none">部门 {getSortIcon('department' as keyof User)}</th>
              <th onClick={() => handleSort('status' as keyof User)} className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none">状态 {getSortIcon('status' as keyof User)}</th>
              <th onClick={() => handleSort('created_at' as keyof User)} className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none">创建时间 {getSortIcon('created_at' as keyof User)}</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-[var(--ui-text-secondary)]">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">加载中...</td></tr>
            ) : displayData.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">暂无数据</td></tr>
            ) : (
              displayData.map((user) => (
                <tr key={user.id} className="hover:bg-[var(--ui-bg-hover)]">
                  <td className="px-4 py-3 text-sm font-medium">{user.username}</td>
                  <td className="px-4 py-3 text-sm">{user.real_name}</td>
                  <td className="px-4 py-3">
                    <RoleTag role={user.role} />
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--ui-text-secondary)]">{user.department || '-'}</td>
                  <td className="px-4 py-3">
                    <StatusTag status={user.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--ui-text-secondary)]">{formatDateTime(user.created_at)}</td>
                <td className="px-4 py-3 text-right">
                    {isAdmin() && (
                      <>
                        <Button variant="link" size="xs" className="mr-2" onClick={() => handleEdit(user)}>编辑</Button>
                        <Button variant="link" size="xs" className="mr-2" type="button" onClick={() => setResetId(user.id)}>重置密码</Button>
                        <Button variant="danger" size="xs" type="button" onClick={() => setDeleteId(user.id)}>删除</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 新增/编辑弹窗 */}
      <Modal open={modalOpen} title={editingUser ? '编辑用户' : '新增用户'} onClose={() => setModalOpen(false)} width="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 用户名（仅新增） */}
          {!editingUser && (
            <FormField label="用户名" required>
              <Input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                required
                minLength={3}
                maxLength={64}
                placeholder="3-64个字符"
              />
            </FormField>
          )}

          {editingUser && (
            <FormField label="用户名">
              <Input type="text" value={formData.username} disabled />
            </FormField>
          )}

          {/* 姓名 + 角色 */}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="姓名" required>
              <Input
                type="text"
                value={formData.real_name}
                onChange={(e) => setFormData({ ...formData, real_name: e.target.value })}
                required
              />
            </FormField>
            <FormField label="角色" required>
              <Select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
              >
                <option value="admin">管理员</option>
                <option value="engineer">工程师</option>
                <option value="production">生产人员</option>
                <option value="guest">访客</option>
              </Select>
            </FormField>
          </div>

          {/* 部门 + 电话 */}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="部门">
              <Input
                type="text"
                value={formData.department}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
              />
            </FormField>
            <FormField label="电话">
              <Input
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </FormField>
          </div>

          {/* 状态（仅编辑） */}
          {editingUser && (
            <FormField label="状态">
              <Select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              >
                <option value="active">正常</option>
                <option value="disabled">禁用</option>
              </Select>
            </FormField>
          )}

          {/* 所属组 */}
          {isAdmin() && (
            <FormField label="所属组">
              <div className="max-h-32 overflow-auto border border-[var(--ui-border)] rounded p-2">
                {groups.length === 0 && <span className="text-[var(--ui-text-tertiary)] text-sm">暂无用户组</span>}
                {groups.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 py-0.5">
                    <input
                      type="checkbox"
                      checked={userGroupIds.includes(String(g.id))}
                      onChange={(e) => setUserGroupIds((prev) =>
                        e.target.checked ? [...prev, String(g.id)] : prev.filter((x) => x !== String(g.id)))}
                    />
                    <span className="text-sm">{g.name}</span>
                  </label>
                ))}
              </div>
            </FormField>
          )}

          {/* 密码 */}
          <FormField label="密码" required={!editingUser}>
            <Input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              minLength={6}
              placeholder={editingUser ? '留空则不修改密码' : '至少6个字符'}
              {...((!editingUser) ? { required: true } : {})}
            />
          </FormField>

          {saveError && (
            <Alert tone="danger">{saveError}</Alert>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" onClick={() => setModalOpen(false)} variant="secondary">取消</Button>
            <Button type="submit" disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* 删除确认 */}
      <ConfirmModal
        open={!!deleteId}
        title="确认删除"
        content="确定要删除该用户吗？此操作不可撤销。"
        confirmText="删除"
        cancelText="取消"
        type="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />

      <ConfirmModal
        open={!!resetId}
        title="重置密码"
        content="确定要将该用户密码重置为 123456 吗？该用户下次登录时必须重新设置密码。"
        confirmText="确认重置"
        cancelText="取消"
        type="danger"
        onConfirm={handleResetPassword}
        onCancel={() => setResetId(null)}
      />

      {/* 删除用户组确认 */}
      <ConfirmModal
        open={!!confirmGroupId}
        title="确认删除"
        content="确定删除该用户组？文档将恢复为全员可访问。"
        confirmText="删除"
        cancelText="取消"
        type="danger"
        onConfirm={async () => {
          if (!confirmGroupId) return;
          try {
            await userGroupsApi.delete(confirmGroupId);
            await loadGroups();
          } catch (e: any) {
            toast.error(e?.response?.data?.detail || '删除用户组失败');
          }
          setConfirmGroupId(null);
        }}
        onCancel={() => setConfirmGroupId(null)}
      />
        </>
      )}

      {/* 待审批 Tab */}
      {activeTab === 'pending' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-700">
              待审批用户 ({unverifiedUsers.length})
            </h2>
          </div>
          {unverifiedUsers.length === 0 ? (
            <div className="text-center py-16 text-[var(--ui-text-tertiary)]">
              <div className="text-4xl mb-3">&#x2705;</div>
              <p>暂无待审批用户</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b bg-[var(--ui-bg-subtle)] text-left text-sm text-[var(--ui-text-secondary)]">
                  <th className="px-4 py-2.5">用户名</th>
                  <th className="px-4 py-2.5">姓名</th>
                  <th className="px-4 py-2.5">申请时间</th>
                  <th className="px-4 py-2.5">操作</th>
                </tr>
              </thead>
              <tbody>
                {unverifiedUsers.map((u) => (
                  <tr key={u.id} className="border-b hover:bg-[var(--ui-bg-hover)] text-sm">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{u.username}</td>
                    <td className="px-4 py-2.5 text-[var(--ui-text-secondary)]">{u.real_name || '-'}</td>
                    <td className="px-4 py-2.5 text-[var(--ui-text-secondary)]">{u.created_at?.slice(0, 10) || '-'}</td>
                    <td className="px-4 py-2.5">
                      {approvingId === u.id ? (
                        <span className="text-[var(--ui-text-tertiary)] text-xs">处理中...</span>
                      ) : (
                        <Select
                          size="xs"
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) handleApprove(u.id, e.target.value);
                          }}
                          className="cursor-pointer select-none whitespace-nowrap"
                        >
                          <option value="" disabled>审批</option>
                          <option value="engineer">工程师</option>
                          <option value="production">生产人员</option>
                          <option value="guest">访客</option>
                        </Select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 用户组 Tab */}
      {activeTab === 'groups' && (
        <div>
          <div className="flex justify-end mb-3">
            {isAdmin() && (
              <Button size="sm"
                onClick={() => { setEditingGroup(null); setGroupForm({ name: '', description: '' }); setMemberSelectedIds([]); setMemberSearch(''); setGroupModalOpen(true); }}
              >新建用户组</Button>
            )}
          </div>
          <table className="min-w-full divide-y divide-gray-200 bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)]">
            <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)]"><tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">名称</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">描述</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">成员数</th>
              {isAdmin() && <th className="px-4 py-3 text-left text-sm font-medium text-[var(--ui-text-secondary)]">操作</th>}
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {groups.map((g) => (
                <tr key={g.id} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer" onClick={() => viewGroupDetail(g.id)}>
                  <td className="px-4 py-2 text-sm font-medium">{g.name}</td>
                  <td className="px-4 py-2 text-sm text-[var(--ui-text-secondary)]">{g.description || '-'}</td>
                  <td className="px-4 py-2 text-sm">{g.member_count}</td>
                  {isAdmin() && (
                    <td className="px-4 py-2 text-sm space-x-2" onClick={(e) => e.stopPropagation()}>
                      <Button variant="link" size="xs" onClick={async () => { setEditingGroup(g); setGroupForm({ name: g.name, description: g.description || '' }); setMemberSearch(''); const res = await userGroupsApi.getMembers(g.id); setMemberSelectedIds((res.data?.user_ids || []).map(String)); setGroupModalOpen(true); }}>编辑</Button>
                      <Button variant="danger" size="xs" onClick={() => removeGroup(g.id)}>删除</Button>
                    </td>
                  )}
                </tr>
              ))}
              {groups.length === 0 && (
                <tr><td colSpan={isAdmin() ? 4 : 3} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">暂无用户组</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 组编辑弹窗 */}
      <Modal open={groupModalOpen} title={editingGroup ? '编辑用户组' : '新建用户组'} onClose={() => { setGroupModalOpen(false); setGroupError(null); }} width="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="名称" required card>
              <Input
                type="text"
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                size="xs"
                required
                maxLength={64}
              />
            </FormField>
            <FormField label="描述" card>
              <Input
                type="text"
                value={groupForm.description}
                onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
                size="xs"
                maxLength={255}
              />
            </FormField>
          </div>
          {groupError && <Alert tone="danger">{groupError}</Alert>}
          <div className="border-t pt-3">
            <h4 className="text-[var(--ui-text-secondary)] font-semibold text-sm mb-2">成员</h4>
            <Input
              type="text"
              placeholder="搜索用户..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="mb-2"
            />
            <div className="max-h-52 overflow-auto border border-[var(--ui-border)] rounded-lg">
              {users.filter((u) => {
                if (!memberSearch.trim()) return true;
                const kw = memberSearch.trim().toLowerCase();
                return u.real_name.toLowerCase().includes(kw) || u.username.toLowerCase().includes(kw);
              }).length === 0 ? (
                <div className="text-sm text-[var(--ui-text-tertiary)] py-4 text-center">无匹配用户</div>
              ) : (
                users.filter((u) => {
                  if (!memberSearch.trim()) return true;
                  const kw = memberSearch.trim().toLowerCase();
                  return u.real_name.toLowerCase().includes(kw) || u.username.toLowerCase().includes(kw);
                }).map((u) => (
                  <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--ui-bg-hover)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={memberSelectedIds.includes(String(u.id))}
                      onChange={(e) => setMemberSelectedIds((prev) =>
                        e.target.checked ? [...prev, String(u.id)] : prev.filter((x) => x !== String(u.id)))}
                    />
                    <span className="text-sm">{u.real_name}（{u.username}）<span className="text-[var(--ui-text-tertiary)] ml-1">{u.role}</span></span>
                  </label>
                ))
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" onClick={() => { setGroupModalOpen(false); setGroupError(null); }} variant="secondary" disabled={groupSaving}>取消</Button>
            <Button type="button" onClick={saveGroup} disabled={groupSaving}>{groupSaving ? '保存中...' : '保存'}</Button>
          </div>
        </div>
      </Modal>

      {/* 用户组详情弹窗 */}
      {viewingGroupId && (() => {
        const g = groups.find((g) => g.id === viewingGroupId);
        const memberUsers = users.filter((u) => viewingGroupMembers.includes(String(u.id)));
        return (
          <Modal open={!!viewingGroupId} title="用户组详情" onClose={() => setViewingGroupId(null)} width="md">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
                  <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">名称</div>
                  <div className="text-sm font-medium">{g?.name || '-'}</div>
                </div>
                <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
                  <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">成员数</div>
                  <div className="text-sm font-medium">{viewingGroupMembers.length}</div>
                </div>
                <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)] col-span-2">
                  <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">描述</div>
                  <div className="text-sm">{g?.description || '-'}</div>
                </div>
              </div>
              <div className="border-t pt-3">
                <h4 className="text-[var(--ui-text-secondary)] font-semibold text-sm mb-2">成员列表</h4>
                {memberUsers.length === 0 ? (
                  <div className="text-sm text-[var(--ui-text-tertiary)] py-4 text-center border border-dashed border-gray-300 rounded-lg">暂无成员</div>
                ) : (
                  <table className="w-full text-sm border rounded-lg overflow-hidden">
                    <thead className="bg-[var(--ui-bg-subtle)] border-b">
                      <tr>
                        <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">姓名</th>
                        <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">用户名</th>
                        <th className="px-3 py-2 text-left text-[var(--ui-text-secondary)] font-medium">角色</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {memberUsers.map((u) => (
                        <tr key={u.id}>
                          <td className="px-3 py-2">{u.real_name}</td>
                          <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{u.username}</td>
                          <td className="px-3 py-2"><RoleTag role={u.role} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
            <div className="flex justify-end pt-4 border-t mt-4">
              <Button type="button" onClick={() => setViewingGroupId(null)} variant="secondary">关闭</Button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

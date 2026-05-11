import { useEffect, useState } from 'react';
import { usersApi } from '../services/api';
import type { User } from '../types';
import { isAdmin } from '../stores/auth';
import { Modal, ConfirmModal } from '../components/Modal';
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

const roleTag = (role: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    admin: { label: '管理员', cls: 'bg-red-100 text-red-800' },
    engineer: { label: '工程师', cls: 'bg-blue-100 text-blue-800' },
    production: { label: '生产人员', cls: 'bg-green-100 text-green-800' },
    guest: { label: '访客', cls: 'bg-gray-100 text-gray-800' },
  };
  return map[role] || { label: role, cls: 'bg-gray-100 text-gray-800' };
};

const statusTag = (s: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: '正常', cls: 'bg-green-100 text-green-800' },
    disabled: { label: '禁用', cls: 'bg-red-100 text-red-800' },
  };
  return map[s] || { label: s, cls: 'bg-gray-100 text-gray-800' };
};

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

  const handleAdd = () => {
    setEditingUser(null);
    setFormData(initialFormData);
    setSaveError(null);
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
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);

    try {
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
        await usersApi.create({
          username: formData.username,
          real_name: formData.real_name,
          role: formData.role,
          department: formData.department || undefined,
          phone: formData.phone || undefined,
          status: formData.status,
          password: formData.password,
        });
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
      alert('删除失败');
    }
  };

  const handleResetPassword = async () => {
    if (!resetId) return;
    try {
      await usersApi.update(resetId, { password: '123456' });
      setResetId(null);
    } catch {
      alert('重置密码失败');
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
      {/* 头部 */}
      <div className="flex items-center justify-end mb-4">
        {isAdmin() && (
          <button onClick={handleAdd} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
            + 新增用户
          </button>
        )}
      </div>

      {/* 搜索 */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="搜索用户名/姓名/部门..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 w-full max-w-md"
        />
      </div>

      {/* 列表 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th onClick={() => handleSort('username' as keyof User)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">用户名 {getSortIcon('username' as keyof User)}</th>
              <th onClick={() => handleSort('real_name' as keyof User)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">姓名 {getSortIcon('real_name' as keyof User)}</th>
              <th onClick={() => handleSort('role' as keyof User)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">角色 {getSortIcon('role' as keyof User)}</th>
              <th onClick={() => handleSort('department' as keyof User)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">部门 {getSortIcon('department' as keyof User)}</th>
              <th onClick={() => handleSort('status' as keyof User)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">状态 {getSortIcon('status' as keyof User)}</th>
              <th onClick={() => handleSort('created_at' as keyof User)} className="px-4 py-3 text-left text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">创建时间 {getSortIcon('created_at' as keyof User)}</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : displayData.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">暂无数据</td></tr>
            ) : (
              displayData.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">{user.username}</td>
                  <td className="px-4 py-3 text-sm">{user.real_name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${roleTag(user.role).cls}`}>
                      {roleTag(user.role).label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{user.department || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${statusTag(user.status).cls}`}>
                      {statusTag(user.status).label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{formatDateTime(user.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {isAdmin() && (
                      <>
                        <button onClick={() => handleEdit(user)} className="text-primary-600 hover:text-primary-800 mr-2">编辑</button>
                        <button type="button" onClick={() => setResetId(user.id)} className="text-orange-600 hover:text-orange-800 mr-2">重置密码</button>
                        <button type="button" onClick={() => setDeleteId(user.id)} className="text-red-600 hover:text-red-800">删除</button>
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">用户名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
                minLength={3}
                maxLength={64}
                placeholder="3-64个字符"
              />
              {editingUser && (
                <p className="text-xs text-gray-400 mt-1">用户名不可修改</p>
              )}
            </div>
          )}

          {editingUser && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
              <input type="text" value={formData.username} disabled className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500" />
            </div>
          )}

          {/* 姓名 + 角色 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">姓名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.real_name}
                onChange={(e) => setFormData({ ...formData, real_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">角色 <span className="text-red-500">*</span></label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="admin">管理员</option>
                <option value="engineer">工程师</option>
                <option value="production">生产人员</option>
                <option value="guest">访客</option>
              </select>
            </div>
          </div>

          {/* 部门 + 电话 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">部门</label>
              <input
                type="text"
                value={formData.department}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">电话</label>
              <input
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          {/* 状态（仅编辑） */}
          {editingUser && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="active">正常</option>
                <option value="disabled">禁用</option>
              </select>
            </div>
          )}

          {/* 密码 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              密码 {editingUser ? '' : <span className="text-red-500">*</span>}
            </label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              minLength={6}
              placeholder={editingUser ? '留空则不修改密码' : '至少6个字符'}
              {...((!editingUser) ? { required: true } : {})}
            />
          </div>

          {saveError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
              {saveError}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
              {saving ? '保存中...' : '保存'}
            </button>
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
        content="确定要将该用户密码重置为 123456 吗？"
        confirmText="确认重置"
        cancelText="取消"
        type="danger"
        onConfirm={handleResetPassword}
        onCancel={() => setResetId(null)}
      />
    </div>
  );
}

import { useEffect, useState } from 'react';
import { usersApi } from '../services/api';
import type { User } from '../types';
import { isAdmin } from '../stores/auth';
import { Modal, ConfirmModal } from '../components/Modal';

interface UserFormData {
  username: string;
  real_name: string;
  role: string;
  department: string;
  phone: string;
  password: string;
}

const initialFormData: UserFormData = {
  username: '',
  real_name: '',
  role: 'engineer',
  department: '',
  phone: '',
  password: '',
};

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<UserFormData>(initialFormData);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    loadUsers();
  }, [search]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await usersApi.list({ search });
      setUsers(response.data.items || []);
    } catch (error) {
      console.error('加载用户失败', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setEditingUser(null);
    setFormData(initialFormData);
    setModalOpen(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      real_name: user.real_name,
      role: user.role,
      department: user.dept || '',
      phone: user.phone || '',
      password: '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const data: Record<string, unknown> = {
      real_name: formData.real_name,
      role: formData.role,
      department: formData.department || undefined,
      phone: formData.phone || undefined,
    };

    if (!editingUser) {
      data.username = formData.username;
      data.password = formData.password;
    }

    try {
      if (editingUser) {
        await usersApi.update(editingUser.id, data);
      } else {
        await usersApi.create(data);
      }
      setModalOpen(false);
      loadUsers();
    } catch (error) {
      alert(editingUser ? '更新失败' : '创建失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await usersApi.delete(deleteId);
      setDeleteId(null);
      loadUsers();
    } catch (error) {
      alert('删除失败');
    }
  };

  const getRoleTag = (role: string) => {
    const tags: Record<string, { label: string; class: string }> = {
      admin: { label: '管理员', class: 'bg-red-100 text-red-800' },
      engineer: { label: '工程师', class: 'bg-blue-100 text-blue-800' },
      production: { label: '生产人员', class: 'bg-green-100 text-green-800' },
      guest: { label: '访客', class: 'bg-gray-100 text-gray-800' },
    };
    return tags[role] || { label: role, class: 'bg-gray-100 text-gray-800' };
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">用户管理</h2>
        {isAdmin() && (
          <button onClick={handleAdd} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
            + 新增用户
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="搜索用户名/姓名..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 flex-1"
        />
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">用户名</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">姓名</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">角色</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">部门</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">状态</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">创建时间</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">加载中...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">暂无数据</td></tr>
            ) : (
              users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">{user.username}</td>
                  <td className="px-4 py-3 text-sm">{user.real_name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${getRoleTag(user.role).class}`}>
                      {getRoleTag(user.role).label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{user.dept || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${user.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {user.status === 'active' ? '正常' : '禁用'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{user.created?.slice(0, 10) || '-'}</td>
                  <td className="px-4 py-3 text-right">
                    {isAdmin() && (
                      <>
                        <button onClick={() => handleEdit(user)} className="text-primary-600 hover:text-primary-800 mr-3">编辑</button>
                        <button onClick={() => setDeleteId(user.id)} className="text-red-600 hover:text-red-800">删除</button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalOpen}
        title={editingUser ? '编辑用户' : '新增用户'}
        onClose={() => setModalOpen(false)}
        width="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {!editingUser && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">用户名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
          )}

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

          {!editingUser && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">密码 <span className="text-red-500">*</span></label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
                minLength={6}
              />
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
    </div>
  );
}
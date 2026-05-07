import { useEffect, useState } from 'react';
import { usersApi } from '../services/api';
import type { User } from '../types';

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadUsers();
  }, [search]);

  const loadUsers = async () => {
    try {
      const response = await usersApi.list({ search });
      setUsers(response.data.items || []);
    } catch (error) {
      console.error('加载用户失败', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除该用户吗？')) return;
    try {
      await usersApi.delete(id);
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

  if (loading) {
    return <div className="text-gray-500">加载中...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">用户管理</h2>
        <button className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">
          新增用户
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="搜索用户名/姓名..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
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
            {users.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  暂无数据
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm">{user.username}</td>
                  <td className="px-4 py-3 text-sm">{user.real_name}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 text-xs rounded-full ${
                        getRoleTag(user.role).class
                      }`}
                    >
                      {getRoleTag(user.role).label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">{user.dept || '-'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 text-xs rounded-full ${
                        user.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {user.status === 'active' ? '正常' : '禁用'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {user.created?.slice(0, 10) || '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button className="text-primary-600 hover:text-primary-800 mr-2">
                      编辑
                    </button>
                    <button
                      className="text-red-600 hover:text-red-800"
                      onClick={() => handleDelete(user.id)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
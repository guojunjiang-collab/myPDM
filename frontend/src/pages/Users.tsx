import { useEffect, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { usersApi, userGroupsApi } from '../services/api';
import type { User } from '../types';
import { isAdmin, can } from '../stores/auth';
import { Modal, ConfirmModal } from '../components/Modal';
import { useTableSort } from '../hooks/useTableSort';
import { formatDateTime } from '../utils/date';
import { previewUsersImport, executeUsersImport } from '../services/importExport';

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
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<'users' | 'groups'>('users');
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

  const loadGroups = async () => {
    const res = await userGroupsApi.list();
    setGroups(Array.isArray(res.data) ? res.data : []);
  };

  useEffect(() => {
    if (activeTab === 'groups') loadGroups();
  }, [activeTab]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await usersApi.list();
      const data = res.data;
      const list: User[] = Array.isArray(data) ? data : (data as any)?.items || [];
      if (list.length === 0) {
        alert('无用户数据可导出');
        return;
      }

      const rows = list.map((u) => ({
        '用户名': u.username,
        '姓名': u.real_name,
        '角色': (() => { const m: Record<string, string> = { admin: '管理员', engineer: '工程师', production: '生产人员', guest: '访客' }; return m[u.role] || u.role; })(),
        '部门': u.department || '',
        '电话': u.phone || '',
        '状态': u.status === 'active' ? '启用' : '禁用',
        '创建时间': u.created_at || '',
        '更新时间': u.updated_at || '',
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 8 }, { wch: 20 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, ws, '用户清单');
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '用户清单.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e?.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportStatus('正在分析...');
    try {
      const preview = await previewUsersImport(file);
      const validCount = preview.rows.filter((r) => r.status !== '错误').length;
      const errorCount = preview.rows.length - validCount;
      let msg = `共 ${preview.rows.length} 条：新增 ${preview.rows.filter((r) => r.status === '新增').length} 条，更新 ${preview.rows.filter((r) => r.status === '更新').length} 条`;
      if (errorCount > 0) msg += `，${errorCount} 条错误`;
      if (!confirm(`${msg}\n\n确认执行导入？`)) {
        setImporting(false);
        setImportStatus('');
        e.target.value = '';
        return;
      }
      setImportStatus('正在导入...');
      await executeUsersImport(preview);
      setImportStatus('导入完成');
      await loadUsers();
    } catch (err: any) {
      alert(err?.message || '导入失败');
      setImportStatus('');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

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

  const saveGroup = async () => {
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
  };

  const removeGroup = async (id: string) => {
    if (!window.confirm('确定删除该用户组？文档将恢复为全员可访问。')) return;
    await userGroupsApi.delete(id);
    await loadGroups();
  };

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
      <div className="flex gap-2 mb-4 border-b border-gray-200">
        <button
          className={`px-4 py-2 -mb-px border-b-2 ${activeTab === 'users' ? 'border-primary-600 text-primary-700 font-medium' : 'border-transparent text-gray-500'}`}
          onClick={() => setActiveTab('users')}
        >用户</button>
        {can('user_groups:read' as any) && (
          <button
            className={`px-4 py-2 -mb-px border-b-2 ${activeTab === 'groups' ? 'border-primary-600 text-primary-700 font-medium' : 'border-transparent text-gray-500'}`}
            onClick={() => setActiveTab('groups')}
          >用户组</button>
        )}
      </div>

      {/* 用户 Tab */}
      {activeTab === 'users' && (
        <>
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        {/* 导入导出（仅管理员） */}
        {isAdmin() && (
          <div className="flex gap-2">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="px-4 py-2 border border-green-600 text-green-600 rounded-lg hover:bg-green-50 disabled:opacity-50"
            >
              {exporting ? '导出中...' : '导出用户'}
            </button>
            <button
              onClick={handleImportClick}
              disabled={importing}
              className="px-4 py-2 border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50"
            >
              {importing ? (importStatus || '导入中...') : '导入用户'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              onChange={handleImportFile}
              className="hidden"
            />
          </div>
        )}
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

          {/* 所属组 */}
          {isAdmin() && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">所属组</label>
              <div className="max-h-32 overflow-auto border border-gray-200 rounded p-2">
                {groups.length === 0 && <span className="text-gray-400 text-sm">暂无用户组</span>}
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
        </>
      )}

      {/* 用户组 Tab */}
      {activeTab === 'groups' && (
        <div>
          <div className="flex justify-end mb-3">
            {isAdmin() && (
              <button
                className="px-3 py-1.5 bg-primary-600 text-white rounded hover:bg-primary-700"
                onClick={() => { setEditingGroup(null); setGroupForm({ name: '', description: '' }); setMemberSelectedIds([]); setMemberSearch(''); setGroupModalOpen(true); }}
              >新建用户组</button>
            )}
          </div>
          <table className="min-w-full divide-y divide-gray-200 bg-white rounded-lg border border-gray-200">
            <thead className="bg-gray-50 border-b border-gray-200"><tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">名称</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">描述</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">成员数</th>
              {isAdmin() && <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">操作</th>}
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {groups.map((g) => (
                <tr key={g.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => viewGroupDetail(g.id)}>
                  <td className="px-4 py-2 text-sm font-medium">{g.name}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{g.description || '-'}</td>
                  <td className="px-4 py-2 text-sm">{g.member_count}</td>
                  {isAdmin() && (
                    <td className="px-4 py-2 text-sm space-x-2" onClick={(e) => e.stopPropagation()}>
                      <button className="text-primary-600 hover:underline" onClick={async () => { setEditingGroup(g); setGroupForm({ name: g.name, description: g.description || '' }); setMemberSearch(''); const res = await userGroupsApi.getMembers(g.id); setMemberSelectedIds((res.data?.user_ids || []).map(String)); setGroupModalOpen(true); }}>编辑</button>
                      <button className="text-red-600 hover:underline" onClick={() => removeGroup(g.id)}>删除</button>
                    </td>
                  )}
                </tr>
              ))}
              {groups.length === 0 && (
                <tr><td colSpan={isAdmin() ? 4 : 3} className="px-4 py-8 text-center text-gray-500">暂无用户组</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 组编辑弹窗 */}
      <Modal open={groupModalOpen} title={editingGroup ? '编辑用户组' : '新建用户组'} onClose={() => setGroupModalOpen(false)} width="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">名称 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
                maxLength={64}
              />
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">描述</label>
              <input
                type="text"
                value={groupForm.description}
                onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
                className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                maxLength={255}
              />
            </div>
          </div>
          <div className="border-t pt-3">
            <h4 className="text-sm font-medium text-gray-700 mb-2">成员</h4>
            <input
              type="text"
              placeholder="搜索用户..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 mb-2 text-sm"
            />
            <div className="max-h-52 overflow-auto border border-gray-200 rounded-lg">
              {users.filter((u) => {
                if (!memberSearch.trim()) return true;
                const kw = memberSearch.trim().toLowerCase();
                return u.real_name.toLowerCase().includes(kw) || u.username.toLowerCase().includes(kw);
              }).length === 0 ? (
                <div className="text-sm text-gray-400 py-4 text-center">无匹配用户</div>
              ) : (
                users.filter((u) => {
                  if (!memberSearch.trim()) return true;
                  const kw = memberSearch.trim().toLowerCase();
                  return u.real_name.toLowerCase().includes(kw) || u.username.toLowerCase().includes(kw);
                }).map((u) => (
                  <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={memberSelectedIds.includes(String(u.id))}
                      onChange={(e) => setMemberSelectedIds((prev) =>
                        e.target.checked ? [...prev, String(u.id)] : prev.filter((x) => x !== String(u.id)))}
                    />
                    <span className="text-sm">{u.real_name}（{u.username}）<span className="text-gray-400 ml-1">{u.role}</span></span>
                  </label>
                ))
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <button type="button" onClick={() => setGroupModalOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
            <button type="button" onClick={saveGroup} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">保存</button>
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
                <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                  <div className="text-xs text-gray-500 mb-0.5">名称</div>
                  <div className="text-sm font-medium">{g?.name || '-'}</div>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                  <div className="text-xs text-gray-500 mb-0.5">成员数</div>
                  <div className="text-sm font-medium">{viewingGroupMembers.length}</div>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 col-span-2">
                  <div className="text-xs text-gray-500 mb-0.5">描述</div>
                  <div className="text-sm">{g?.description || '-'}</div>
                </div>
              </div>
              <div className="border-t pt-3">
                <h4 className="text-sm font-medium text-gray-700 mb-2">成员列表</h4>
                {memberUsers.length === 0 ? (
                  <div className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-300 rounded-lg">暂无成员</div>
                ) : (
                  <table className="w-full text-sm border rounded-lg overflow-hidden">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">姓名</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">用户名</th>
                        <th className="px-3 py-2 text-left text-gray-500 font-medium">角色</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {memberUsers.map((u) => (
                        <tr key={u.id}>
                          <td className="px-3 py-2">{u.real_name}</td>
                          <td className="px-3 py-2 text-gray-500">{u.username}</td>
                          <td className="px-3 py-2"><span className={`px-2 py-0.5 text-xs rounded-full ${roleTag(u.role).cls}`}>{roleTag(u.role).label}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
            <div className="flex justify-end pt-4 border-t mt-4">
              <button type="button" onClick={() => setViewingGroupId(null)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">关闭</button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

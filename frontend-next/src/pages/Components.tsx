import { useEffect, useState } from 'react';
import { assembliesApi } from '../services/api';
import type { Assembly } from '../types';
import { canEdit, isAdmin } from '../stores/auth';
import { Modal, ConfirmModal } from '../components/Modal';

interface AssemblyFormData {
  code: string;
  name: string;
  spec: string;
  version: string;
  remark: string;
}

const initialFormData: AssemblyFormData = {
  code: '',
  name: '',
  spec: '',
  version: 'V1.0',
  remark: '',
};

export default function Components() {
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingAssembly, setEditingAssembly] = useState<Assembly | null>(null);
  const [formData, setFormData] = useState<AssemblyFormData>(initialFormData);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    loadAssemblies();
  }, [search, status]);

  const loadAssemblies = async () => {
    try {
      setLoading(true);
      const response = await assembliesApi.list({ search, status });
      setAssemblies(response.data.items || []);
    } catch (error) {
      console.error('加载部件失败', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setEditingAssembly(null);
    setFormData(initialFormData);
    setModalOpen(true);
  };

  const handleEdit = (assembly: Assembly) => {
    setEditingAssembly(assembly);
    setFormData({
      code: assembly.code,
      name: assembly.name,
      spec: assembly.spec || '',
      version: (assembly as any).version || 'V1.0',
      remark: assembly.remark || '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const data = {
      code: formData.code,
      name: formData.name,
      spec: formData.spec || undefined,
      version: formData.version || undefined,
      remark: formData.remark || undefined,
    };

    try {
      if (editingAssembly) {
        await assembliesApi.update(editingAssembly.id, data);
      } else {
        await assembliesApi.create(data);
      }
      setModalOpen(false);
      loadAssemblies();
    } catch (error) {
      alert(editingAssembly ? '更新失败' : '创建失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await assembliesApi.delete(deleteId);
      setDeleteId(null);
      loadAssemblies();
    } catch (error) {
      alert('删除失败');
    }
  };

  const getStatusTag = (s: string) => {
    const tags: Record<string, { label: string; class: string }> = {
      draft: { label: '草稿', class: 'bg-blue-100 text-blue-800' },
      frozen: { label: '冻结', class: 'bg-orange-100 text-orange-800' },
      released: { label: '发布', class: 'bg-green-100 text-green-800' },
      obsolete: { label: '作废', class: 'bg-red-100 text-red-800' },
    };
    return tags[s] || { label: s, class: 'bg-gray-100 text-gray-800' };
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">部件管理</h2>
        {canEdit() && (
          <button
            onClick={handleAdd}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            + 新增部件
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="搜索件号/中文名称..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 flex-1"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="frozen">冻结</option>
          <option value="released">发布</option>
          <option value="obsolete">作废</option>
        </select>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">件号</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">中文名称</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">规格型号</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">版本</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">状态</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">创建时间</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">加载中...</td>
              </tr>
            ) : assemblies.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">暂无数据</td>
              </tr>
            ) : (
              assemblies.map((assembly) => (
                <tr key={assembly.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium">{assembly.code}</td>
                  <td className="px-4 py-3 text-sm">{assembly.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{assembly.spec || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{(assembly as any).version || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${getStatusTag(assembly.status).class}`}>
                      {getStatusTag(assembly.status).label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{assembly.created?.slice(0, 10) || '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleEdit(assembly)} className="text-primary-600 hover:text-primary-800 mr-3">编辑</button>
                    {isAdmin() && (
                      <button onClick={() => setDeleteId(assembly.id)} className="text-red-600 hover:text-red-800">删除</button>
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
        title={editingAssembly ? '编辑部件' : '新增部件'}
        onClose={() => setModalOpen(false)}
        width="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">件号 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">中文名称 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">规格型号</label>
              <input
                type="text"
                value={formData.spec}
                onChange={(e) => setFormData({ ...formData, spec: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">版本</label>
              <input
                type="text"
                value={formData.version}
                onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="如: V1.0, V2.0"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <textarea
              value={formData.remark}
              onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

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
        content="确定要删除该部件吗？此操作不可撤销。"
        confirmText="删除"
        cancelText="取消"
        type="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
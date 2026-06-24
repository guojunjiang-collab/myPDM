import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../../stores/project';
import { projectApi } from '../../services/projectApi';
import { can } from '../../stores/auth';
import { Modal } from '../../components/Modal';
import { toast } from '../../components/Toast';
import type { ProjectStatus } from '../../types/project';

const STATUSES: ProjectStatus[] = ['进行中', '已完成', '已暂停', '已归档'];
const STATUS_CLASS: Record<ProjectStatus, string> = {
  进行中: 'bg-blue-50 text-blue-700',
  已完成: 'bg-green-50 text-green-700',
  已暂停: 'bg-amber-50 text-amber-700',
  已归档: 'bg-gray-100 text-gray-600',
};

export default function Projects() {
  const navigate = useNavigate();
  const { projects, loadProjects, loading } = useProjectStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', planned_start: '', planned_end: '', description: '' });

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const filtered = projects.filter((p) =>
    (!search || p.name.includes(search) || p.code.includes(search)) &&
    (!statusFilter || p.status === statusFilter)
  );

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error('请填写项目名称'); return; }
    try {
      await projectApi.createProject(form);
      toast.success('项目已创建');
      setCreateOpen(false);
      setForm({ name: '', planned_start: '', planned_end: '', description: '' });
      loadProjects();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '创建失败');
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-xl font-semibold">项目管理</h1>
        <div className="flex-1" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索编号/名称"
               className="px-3 py-2 border border-gray-300 rounded-lg" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg">
          <option value="">全部状态</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {can('project:create') && (
          <button onClick={() => setCreateOpen(true)}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">+ 新建项目</button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium">编号</th>
              <th className="text-left px-4 py-2 font-medium">名称</th>
              <th className="text-left px-4 py-2 font-medium">负责人</th>
              <th className="text-left px-4 py-2 font-medium">状态</th>
              <th className="text-left px-4 py-2 font-medium">计划起止</th>
              <th className="text-left px-4 py-2 font-medium">成员</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
                  className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer">
                <td className="px-4 py-2">{p.code}</td>
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2">{p.owner_name}</td>
                <td className="px-4 py-2"><span className={`text-xs px-2 py-0.5 rounded ${STATUS_CLASS[p.status]}`}>{p.status}</span></td>
                <td className="px-4 py-2 text-gray-500">{p.planned_start || '—'} ~ {p.planned_end || '—'}</td>
                <td className="px-4 py-2 text-gray-500">{p.member_count ?? 0}</td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">暂无项目</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={createOpen} title="新建项目" onClose={() => setCreateOpen(false)} width="lg">
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">项目名称 *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                   className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">计划开始</label>
              <input type="date" value={form.planned_start} onChange={(e) => setForm({ ...form, planned_start: e.target.value })}
                     className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">计划完成</label>
              <input type="date" value={form.planned_end} onChange={(e) => setForm({ ...form, planned_end: e.target.value })}
                     className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">描述</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg" rows={3} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setCreateOpen(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
            <button onClick={handleCreate} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">创建</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

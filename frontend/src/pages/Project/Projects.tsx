import { useEffect, useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProjectStore } from '../../stores/project';
import { projectApi } from '../../services/projectApi';
import { usersApi } from '../../services/api';
import { can } from '../../stores/auth';
import { Modal, ConfirmModal } from '../../components/Modal';
import { toast } from '../../components/Toast';
import MemberManageModal from './MemberManageModal';
import TaskEditModal from './TaskEditModal';
import type { Project, ProjectStatus, ProjectTask, TaskStatus } from '../../types/project';

const STATUSES: ProjectStatus[] = ['待启动', '进行中', '已完成', '已暂停', '已归档'];
const STATUS_CLASS: Record<ProjectStatus, string> = {
  待启动: 'bg-gray-100 text-gray-500',
  进行中: 'bg-blue-100 text-blue-800',
  已完成: 'bg-green-100 text-green-800',
  已暂停: 'bg-amber-100 text-amber-800',
  已归档: 'bg-gray-100 text-gray-600',
};
const TYPE_ICON: Record<string, string> = { 任务: '📋', 里程碑: '🏁', 评审: '🔎' };
const TASK_STATUS_CLASS: Record<TaskStatus, string> = {
  未开始: 'bg-gray-100 text-gray-600',
  进行中: 'bg-blue-50 text-blue-700',
  已完成: 'bg-green-50 text-green-700',
  挂起: 'bg-amber-50 text-amber-700',
};

function isOverdue(t: ProjectTask): boolean {
  if (!t.planned_end || t.status === '已完成') return false;
  return t.planned_end < new Date().toISOString().slice(0, 10);
}

type TabKey = 'summary' | 'detail' | 'view';

export default function Projects() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') as TabKey) || 'summary';
  const selectedProjectId = searchParams.get('project');
  const setTab = (t: TabKey, projectId?: string) => {
    const params = new URLSearchParams();
    if (t !== 'summary') params.set('tab', t);
    if (projectId) params.set('project', projectId);
    setSearchParams(params, { replace: true });
  };

  const { projects, currentProject, loadProjects, loadProject, tasks, loadTasks, loading } = useProjectStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [form, setForm] = useState({ name: '', planned_start: '', planned_end: '', description: '', status: '进行中' as ProjectStatus, owner_id: '' });
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [allUsers, setAllUsers] = useState<{ id: string; real_name: string; username: string }[]>([]);

  // Detail tab state
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [memberOpen, setMemberOpen] = useState(false);
  const [editTask, setEditTask] = useState<ProjectTask | null>(null);
  const [editParentId, setEditParentId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [delTask, setDelTask] = useState<ProjectTask | null>(null);
  const [taskStatusFilter, setTaskStatusFilter] = useState('');

  useEffect(() => { loadProjects(); }, [loadProjects]);

  useEffect(() => {
    if (selectedProjectId && (tab === 'detail' || tab === 'view')) {
      loadProject(selectedProjectId);
      loadTasks(selectedProjectId);
    }
  }, [selectedProjectId, tab, loadProject, loadTasks]);

  const filtered = projects.filter((p) =>
    (!search || p.name.includes(search) || p.code.includes(search)) &&
    (!statusFilter || p.status === statusFilter)
  );

  const handleOpenCreate = () => {
    setEditingProject(null);
    setForm({ name: '', planned_start: '', planned_end: '', description: '', status: '进行中', owner_id: '' });
    setCreateOpen(true);
  };

  const handleOpenEdit = async (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProject(p);
    setForm({
      name: p.name,
      planned_start: p.planned_start || '',
      planned_end: p.planned_end || '',
      description: p.description || '',
      status: p.status,
      owner_id: p.owner_id,
    });
    try {
      const r = await usersApi.list();
      setAllUsers((r.data as any).items || r.data || []);
    } catch { setAllUsers([]); }
    setCreateOpen(true);
  };

  const handleDeleteClick = (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteProjectId(p.id);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteProjectId) return;
    try {
      await projectApi.deleteProject(deleteProjectId);
      toast.success('项目已删除');
      setDeleteProjectId(null);
      loadProjects();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '删除失败');
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('请填写项目名称'); return; }
    setSaving(true);
    try {
      if (editingProject) {
        await projectApi.updateProject(editingProject.id, {
          name: form.name,
          status: form.status,
          owner_id: form.owner_id || undefined,
          planned_start: form.planned_start || undefined,
          planned_end: form.planned_end || undefined,
          description: form.description || undefined,
        });
        toast.success('项目已更新');
      } else {
        await projectApi.createProject(form);
        toast.success('项目已创建');
      }
      setCreateOpen(false);
      setEditingProject(null);
      setForm({ name: '', planned_start: '', planned_end: '', description: '', status: '进行中', owner_id: '' });
      loadProjects();
      if (editingProject && selectedProjectId === editingProject.id) {
        loadProject(selectedProjectId);
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || (editingProject ? '更新失败' : '创建失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleSelectProject = (projectId: string) => {
    setExpanded(new Set());
    setEditTask(null);
    setEditOpen(false);
    setTab('detail', projectId);
  };

  // ---- Detail tab actions ----
  const reload = useCallback(() => {
    if (selectedProjectId) loadTasks(selectedProjectId);
  }, [selectedProjectId, loadTasks]);

  const isManager = useMemo(() => can('project.task:create'), []);

  const toggle = (tid: string) => {
    const next = new Set(expanded);
    next.has(tid) ? next.delete(tid) : next.add(tid);
    setExpanded(next);
  };

  const openCreate = (parentId: string | null) => {
    setEditTask(null); setEditParentId(parentId); setEditOpen(true);
  };
  const openEdit = (t: ProjectTask) => {
    setEditTask(t); setEditParentId(null); setEditOpen(true);
  };

  const confirmDelete = async () => {
    if (!selectedProjectId || !delTask) return;
    await projectApi.deleteTask(selectedProjectId, delTask.id);
    setDelTask(null);
    reload();
  };

  const renderRow = (t: ProjectTask, depth: number): JSX.Element[] => {
    if (taskStatusFilter && t.status !== taskStatusFilter) {
      return (t.children || []).flatMap((c) => renderRow(c, depth));
    }
    const hasChildren = (t.children?.length || 0) > 0;
    const isOpen = expanded.has(t.id);
    const overdue = isOverdue(t);
    const rows: JSX.Element[] = [
      <tr key={t.id} onClick={() => openEdit(t)}
          className={`${overdue ? 'bg-red-50' : 'hover:bg-gray-50'} cursor-pointer`}>
        <td className="px-4 py-2 text-sm text-gray-500 font-mono" onClick={(e) => e.stopPropagation()}>
          <span style={{ paddingLeft: depth * 20 }} className="inline-flex items-center gap-1">
            {hasChildren ? (
              <button onClick={() => toggle(t.id)} className="text-gray-400 w-4 shrink-0">{isOpen ? '▾' : '▸'}</button>
            ) : <span className="inline-block w-4 shrink-0" />}
            <span>{t.code}</span>
          </span>
        </td>
        <td className="px-4 py-2">
          <span className="inline-flex items-center gap-1">
            <span>{TYPE_ICON[t.task_type]}</span>
            <span className="font-medium">{t.name}</span>
            {overdue && <span className="text-xs text-red-600">⚠ 逾期</span>}
          </span>
        </td>
        <td className="px-2 py-2 text-sm">{t.assignee_name || '—'}</td>
        <td className="px-2 py-2">
          <span className={`px-2 py-0.5 text-xs rounded-full ${TASK_STATUS_CLASS[t.status]}`}>{t.status}</span>
        </td>
        <td className="px-2 py-2 text-sm">{t.priority}</td>
        <td className="px-2 py-2 text-sm text-gray-500">{t.planned_end || '—'}</td>
        <td className="px-4 py-2 text-right text-gray-400" onClick={(e) => e.stopPropagation()}>
          {(t.link_count ?? 0) > 0 && <span className="mr-2">🔗 {t.link_count}</span>}
          {isManager && <button onClick={() => openCreate(t.id)} className="text-primary-600 text-sm mr-2">+子</button>}
          {can('project.task:delete') && <button onClick={() => setDelTask(t)} className="text-red-600 text-sm">删除</button>}
        </td>
      </tr>,
    ];
    if (hasChildren && isOpen) {
      for (const c of t.children!) rows.push(...renderRow(c, depth + 1));
    }
    return rows;
  };

  // ---- Render ----
  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-4 shrink-0 border-b">
        {(['summary', 'detail', 'view'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k, k === tab ? selectedProjectId || undefined : selectedProjectId || undefined)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === k
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {{ summary: '项目汇总', detail: '项目详情', view: '项目视图' }[k]}
          </button>
        ))}
        <div className="flex-1" />
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {tab === 'summary' && (
          <div className="h-full flex flex-col">
            <div className="flex items-center gap-2 mb-4 shrink-0">
              <input
                type="text"
                placeholder="搜索编号/名称..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-44 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                <option value="">全部状态</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <div className="flex-1" />
              {can('project:create') && (
                <button onClick={handleOpenCreate}
                        className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">
                  + 新建项目
                </button>
              )}
            </div>

            <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 select-none whitespace-nowrap">编号</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 select-none whitespace-nowrap">名称</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 select-none whitespace-nowrap">负责人</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 select-none whitespace-nowrap">状态</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 select-none whitespace-nowrap">计划起止</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 select-none whitespace-nowrap">成员</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-500 select-none whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500">加载中...</td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-500">暂无项目</td>
                    </tr>
                  ) : (
                    filtered.map((p) => (
                      <tr key={p.id} onClick={() => handleSelectProject(p.id)}
                          className="hover:bg-gray-50 cursor-pointer">
                        <td className="px-4 py-3 text-sm font-medium">{p.code}</td>
                        <td className="px-4 py-3 text-sm">{p.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{p.owner_name}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-xs rounded-full ${STATUS_CLASS[p.status]}`}>{p.status}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">{p.planned_start || '—'} ~ {p.planned_end || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{p.member_count ?? 0}</td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          {can('project:update') && (
                            <button onClick={(e) => handleOpenEdit(p, e)} className="text-primary-600 hover:text-primary-800 text-sm mr-3">编辑</button>
                          )}
                          {can('project:delete') && (
                            <button onClick={(e) => handleDeleteClick(p, e)} className="text-red-600 hover:text-red-800 text-sm">删除</button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <Modal open={createOpen} title={editingProject ? '编辑项目' : '新建项目'} onClose={() => { setCreateOpen(false); setEditingProject(null); }} width="lg">
              <div className="space-y-4 max-h-[75vh] overflow-y-auto px-1">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <label className="block text-xs text-gray-500 mb-0.5">项目名称 <span className="text-red-500">*</span></label>
                    <input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                      required
                    />
                  </div>
                  {editingProject && (
                    <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                      <label className="block text-xs text-gray-500 mb-0.5">状态</label>
                      <select
                        value={form.status}
                        onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}
                        className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  )}
                  {editingProject && (
                    <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                      <label className="block text-xs text-gray-500 mb-0.5">负责人</label>
                      <select
                        value={form.owner_id}
                        onChange={(e) => setForm({ ...form, owner_id: e.target.value })}
                        className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                      >
                        {allUsers.map((u) => <option key={u.id} value={u.id}>{u.real_name} ({u.username})</option>)}
                      </select>
                    </div>
                  )}
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <label className="block text-xs text-gray-500 mb-0.5">计划开始</label>
                    <input
                      type="date"
                      value={form.planned_start}
                      onChange={(e) => setForm({ ...form, planned_start: e.target.value })}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <label className="block text-xs text-gray-500 mb-0.5">计划完成</label>
                    <input
                      type="date"
                      value={form.planned_end}
                      onChange={(e) => setForm({ ...form, planned_end: e.target.value })}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div className="col-span-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                    <label className="block text-xs text-gray-500 mb-0.5">描述</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                      rows={3}
                      placeholder="可选"
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t mt-4">
                <button onClick={() => { setCreateOpen(false); setEditingProject(null); }} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
                <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
                  {saving ? '保存中...' : (editingProject ? '保存' : '创建')}
                </button>
              </div>
            </Modal>

            <ConfirmModal
              open={!!deleteProjectId}
              title="确认删除"
              content="确定要删除该项目吗？此操作不可撤销。"
              confirmText="删除"
              cancelText="取消"
              type="danger"
              onConfirm={handleDeleteConfirm}
              onCancel={() => setDeleteProjectId(null)}
            />
          </div>
        )}

        {tab === 'detail' && (
          <div className="h-full flex flex-col">
            {!currentProject || currentProject.id !== selectedProjectId ? (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                {selectedProjectId ? '加载中...' : '请从项目汇总中选择一个项目'}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-4 shrink-0 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                  <span className="font-semibold">{currentProject.code} · {currentProject.name}</span>
                  <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_CLASS[currentProject.status]}`}>{currentProject.status}</span>
                  <span className="text-sm text-gray-500">负责人 {currentProject.owner_name}</span>
                  <div className="flex-1" />
                  <button onClick={() => setMemberOpen(true)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-white">成员管理</button>
                </div>

                <div className="flex items-center gap-2 mb-3 shrink-0">
                  {isManager && (
                    <button onClick={() => openCreate(null)} className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700">+ 新建顶层任务</button>
                  )}
                  <div className="flex-1" />
                  <select value={taskStatusFilter} onChange={(e) => setTaskStatusFilter(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">
                    <option value="">全部状态</option>
                    {(['未开始', '进行中', '已完成', '挂起'] as TaskStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                      <tr>
                        <th className="text-left px-4 py-3 text-sm font-medium text-gray-500 w-32">编号</th>
                        <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">任务名称</th>
                        <th className="text-left px-2 py-3 text-sm font-medium text-gray-500">负责人</th>
                        <th className="text-left px-2 py-3 text-sm font-medium text-gray-500">状态</th>
                        <th className="text-left px-2 py-3 text-sm font-medium text-gray-500">优先级</th>
                        <th className="text-left px-2 py-3 text-sm font-medium text-gray-500">计划完成</th>
                        <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">关联/操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {tasks.flatMap((t) => renderRow(t, 0))}
                      {tasks.length === 0 && (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">暂无任务</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <MemberManageModal open={memberOpen} projectId={selectedProjectId!} ownerId={currentProject.owner_id} onClose={() => setMemberOpen(false)} />
                <TaskEditModal open={editOpen} projectId={selectedProjectId!} task={editTask} parentId={editParentId}
                               onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); reload(); }} />
                <ConfirmModal open={!!delTask} content={`确认删除任务"${delTask?.name}"及其所有子任务?`}
                              onConfirm={confirmDelete} onCancel={() => setDelTask(null)} />
              </>
            )}
          </div>
        )}

        {tab === 'view' && (
          <div className="h-full flex items-center justify-center text-gray-400">
            项目视图 — 甘特图等功能即将上线
          </div>
        )}
      </div>
    </div>
  );
}

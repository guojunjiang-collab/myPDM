import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useProjectStore } from '../../stores/project';
import { projectApi } from '../../services/projectApi';
import { can } from '../../stores/auth';
import { ConfirmModal } from '../../components/Modal';
import MemberManageModal from './MemberManageModal';
import TaskEditModal from './TaskEditModal';
import type { ProjectTask, TaskStatus } from '../../types/project';

const TYPE_ICON: Record<string, string> = { 任务: '📋', 里程碑: '🏁', 评审: '🔎' };
const STATUS_CLASS: Record<TaskStatus, string> = {
  未开始: 'bg-gray-100 text-gray-600',
  进行中: 'bg-blue-50 text-blue-700',
  已完成: 'bg-green-50 text-green-700',
  挂起: 'bg-amber-50 text-amber-700',
};

function isOverdue(t: ProjectTask): boolean {
  if (!t.planned_end || t.status === '已完成') return false;
  return t.planned_end < new Date().toISOString().slice(0, 10);
}

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const { currentProject, loadProject, tasks, loadTasks } = useProjectStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [memberOpen, setMemberOpen] = useState(false);
  const [editTask, setEditTask] = useState<ProjectTask | null>(null);
  const [editParentId, setEditParentId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [delTask, setDelTask] = useState<ProjectTask | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  const reload = () => { if (id) loadTasks(id); };
  useEffect(() => { if (id) { loadProject(id); loadTasks(id); } }, [id]);

  const isManager = useMemo(() => {
    if (!currentProject) return false;
    return can('project.task:create');
  }, [currentProject]);

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

  const changeStatus = async (t: ProjectTask, status: string) => {
    if (!id) return;
    await projectApi.updateTaskStatus(id, t.id, status);
    reload();
  };

  const confirmDelete = async () => {
    if (!id || !delTask) return;
    await projectApi.deleteTask(id, delTask.id);
    setDelTask(null);
    reload();
  };

  const renderRow = (t: ProjectTask, depth: number): JSX.Element[] => {
    if (statusFilter && t.status !== statusFilter) {
      return (t.children || []).flatMap((c) => renderRow(c, depth));
    }
    const hasChildren = (t.children?.length || 0) > 0;
    const isOpen = expanded.has(t.id);
    const overdue = isOverdue(t);
    const rows: JSX.Element[] = [
      <tr key={t.id} className={`border-t border-gray-100 ${overdue ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
        <td className="px-4 py-2">
          <span style={{ paddingLeft: depth * 20 }} className="inline-flex items-center gap-1">
            {hasChildren ? (
              <button onClick={() => toggle(t.id)} className="text-gray-400 w-4">{isOpen ? '▾' : '▸'}</button>
            ) : <span className="inline-block w-4" />}
            <span>{TYPE_ICON[t.task_type]}</span>
            <span className="font-medium">{t.name}</span>
            <span className="text-xs text-gray-400">{t.code}</span>
            {overdue && <span className="text-xs text-red-600">⚠ 逾期</span>}
          </span>
        </td>
        <td className="px-2 py-2">{t.assignee_name || '—'}</td>
        <td className="px-2 py-2">
          <select value={t.status} onChange={(e) => changeStatus(t, e.target.value)}
                  className={`text-xs px-2 py-0.5 rounded border-0 ${STATUS_CLASS[t.status]}`}>
            {(['未开始', '进行中', '已完成', '挂起'] as TaskStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </td>
        <td className="px-2 py-2">{t.priority}</td>
        <td className="px-2 py-2 text-gray-500">{t.planned_end || '—'}</td>
        <td className="px-4 py-2 text-right text-gray-400">
          {(t.link_count ?? 0) > 0 && <span className="mr-2">🔗 {t.link_count}</span>}
          {isManager && <button onClick={() => openCreate(t.id)} className="text-primary-600 text-sm mr-2">+子</button>}
          {isManager && <button onClick={() => openEdit(t)} className="text-gray-600 text-sm mr-2">编辑</button>}
          {can('project.task:delete') && <button onClick={() => setDelTask(t)} className="text-red-600 text-sm">删除</button>}
        </td>
      </tr>,
    ];
    if (hasChildren && isOpen) {
      for (const c of t.children!) rows.push(...renderRow(c, depth + 1));
    }
    return rows;
  };

  if (!currentProject) return <div className="p-6 text-gray-400">加载中…</div>;

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-4 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
        <span className="font-semibold">{currentProject.code} · {currentProject.name}</span>
        <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700">{currentProject.status}</span>
        <span className="text-sm text-gray-500">负责人 {currentProject.owner_name}</span>
        <div className="flex-1" />
        <button onClick={() => setMemberOpen(true)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-white">成员管理</button>
      </div>

      <div className="flex items-center gap-2 mb-3">
        {isManager && (
          <button onClick={() => openCreate(null)} className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700">+ 新建顶层任务</button>
        )}
        <div className="flex-1" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">
          <option value="">全部状态</option>
          {(['未开始', '进行中', '已完成', '挂起'] as TaskStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium">任务名称</th>
              <th className="text-left px-2 py-2 font-medium">负责人</th>
              <th className="text-left px-2 py-2 font-medium">状态</th>
              <th className="text-left px-2 py-2 font-medium">优先级</th>
              <th className="text-left px-2 py-2 font-medium">计划完成</th>
              <th className="text-right px-4 py-2 font-medium">关联/操作</th>
            </tr>
          </thead>
          <tbody>
            {tasks.flatMap((t) => renderRow(t, 0))}
            {tasks.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">暂无任务</td></tr>}
          </tbody>
        </table>
      </div>

      <MemberManageModal open={memberOpen} projectId={id!} ownerId={currentProject.owner_id} onClose={() => setMemberOpen(false)} />
      <TaskEditModal open={editOpen} projectId={id!} task={editTask} parentId={editParentId}
                     onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); reload(); }} />
      <ConfirmModal open={!!delTask} content={`确认删除任务"${delTask?.name}"及其所有子任务?`}
                    onConfirm={confirmDelete} onCancel={() => setDelTask(null)} />
    </div>
  );
}

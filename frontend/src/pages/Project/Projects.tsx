import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useProjectStore } from '../../stores/project';
import { projectApi } from '../../services/projectApi';
import { usersApi } from '../../services/api';
import { can } from '../../stores/auth';
import { Modal, ConfirmModal } from '../../components/Modal';
import { toast } from '../../components/Toast';
import { useHeaderTabs } from '../../hooks/useHeaderTabs';
import MemberManageModal from './MemberManageModal';
import TaskEditModal from './TaskEditModal';
import GanttView from './gantt/GanttView';
import { TaskCodeCell, TaskNameCell, TaskAssigneeCell } from './TaskRowCells';
import { CODE_W, ASSIGNEE_W, LEFT_W } from './gantt/ganttUtils';
import type { Project, ProjectStatus, ProjectTask, TaskStatus, TaskLink, TaskComment } from '../../types/project';

const STATUSES: ProjectStatus[] = ['待启动', '进行中', '已完成', '已暂停', '已归档'];
const STATUS_CLASS: Record<ProjectStatus, string> = {
  待启动: 'bg-gray-100 text-gray-500',
  进行中: 'bg-blue-100 text-blue-800',
  已完成: 'bg-green-100 text-green-800',
  已暂停: 'bg-amber-100 text-amber-800',
  已归档: 'bg-gray-100 text-gray-600',
};
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

type TabKey = 'summary' | 'detail';

const tabs: { key: TabKey; label: string }[] = [
  { key: 'summary', label: '项目汇总' },
  { key: 'detail', label: '项目详情' },
];

export default function Projects() {
  const [tab, setTabState] = useState<TabKey>('summary');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const handleTabChange = useCallback((t: TabKey) => {
    setTabState(t);
    if (t === 'summary') setSelectedProjectId(null);
  }, []);
  useHeaderTabs(tabs, tab, handleTabChange);

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
  const [ganttKey, setGanttKey] = useState(0);   // 改任务后强制甘特重载
  const [viewMode, setViewMode] = useState<'table' | 'gantt'>('table');
  const [ganttScale, setGanttScale] = useState<'day' | 'week' | 'month'>('day');
  const [autoScheduleKey, setAutoScheduleKey] = useState(0);
  const [delTask, setDelTask] = useState<ProjectTask | null>(null);
  const [taskStatusFilter, setTaskStatusFilter] = useState('');
  const [taskSearch, setTaskSearch] = useState('');
  const [taskLinks, setTaskLinks] = useState<Record<string, TaskLink[]>>({});
  const [taskComments, setTaskComments] = useState<Record<string, TaskComment[]>>({});
  const [dragTask, setDragTask] = useState<ProjectTask | null>(null);
  const [dragOver, setDragOver] = useState<{ taskId: string; position: 'above' | 'below' | 'into' } | null>(null);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (expandTimerRef.current) clearTimeout(expandTimerRef.current); };
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  useEffect(() => {
    if (selectedProjectId && tab === 'detail') {
      loadProject(selectedProjectId);
      loadTasks(selectedProjectId);
    }
  }, [selectedProjectId, tab, loadProject, loadTasks]);

  const collectTaskIds = useCallback((ts: ProjectTask[]): string[] => {
    const ids: string[] = [];
    const walk = (t: ProjectTask) => { ids.push(t.id); (t.children || []).forEach(walk); };
    ts.forEach(walk);
    return ids;
  }, []);

  useEffect(() => {
    if (!selectedProjectId || tasks.length === 0) return;
    const ids = collectTaskIds(tasks);
    Promise.all([
      ...ids.map((tid) =>
        projectApi.listLinks(selectedProjectId, tid)
          .then((r) => ({ tid, data: (r.data as any).items || [] }))
          .catch(() => ({ tid, data: [] }))
      ),
      ...ids.map((tid) =>
        projectApi.listComments(selectedProjectId, tid)
          .then((r) => ({ tid, data: (r.data as any).items || [] }))
          .catch(() => ({ tid, data: [] }))
      ),
    ]).then((results) => {
      const links: Record<string, TaskLink[]> = {};
      const comments: Record<string, TaskComment[]> = {};
      for (const r of results) {
        const arr = r.data as any[];
        if (arr.length > 0 && 'entity_type' in (arr[0] || {})) {
          links[r.tid] = arr;
        } else if (arr.length > 0 && 'content' in (arr[0] || {})) {
          comments[r.tid] = arr;
        }
      }
      setTaskLinks(links);
      setTaskComments(comments);
    });
  }, [tasks, selectedProjectId, collectTaskIds]);

  useEffect(() => {
    if (!taskSearch) return;
    const links = taskLinks;
    const comments = taskComments;
    const match = (t: ProjectTask): boolean => {
      if (taskStatusFilter && t.status !== taskStatusFilter) return false;
      if (t.name.includes(taskSearch) || t.code.includes(taskSearch)) return true;
      if (t.description && t.description.includes(taskSearch)) return true;
      const ls = links[t.id] || [];
      if (ls.some((l: TaskLink) =>
        (l.entity_code && l.entity_code.includes(taskSearch)) ||
        (l.entity_name && l.entity_name.includes(taskSearch))
      )) return true;
      const cs = comments[t.id] || [];
      if (cs.some((c: TaskComment) => c.content.includes(taskSearch))) return true;
      return false;
    };
    const collectAncestors = (t: ProjectTask, ids: Set<string>): boolean => {
      if (match(t)) { ids.add(t.id); return true; }
      let childMatch = false;
      for (const c of t.children || []) {
        if (collectAncestors(c, ids)) { ids.add(t.id); childMatch = true; }
      }
      return childMatch;
    };
    const ids = new Set<string>();
    for (const t of tasks) {
      collectAncestors(t, ids);
    }
    setExpanded((prev) => new Set([...prev, ...ids]));
  }, [taskSearch, taskStatusFilter, tasks, taskLinks, taskComments]);

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
    setTabState('detail');
    setSelectedProjectId(projectId);
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

  // ---- Drag & Drop ----
  const expandNode = useCallback((tid: string) => {
    if (!expanded.has(tid)) {
      const next = new Set(expanded);
      next.add(tid);
      setExpanded(next);
    }
  }, [expanded]);

  const handleDragStart = (t: ProjectTask, e: React.DragEvent) => {
    setDragTask(t);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', t.id);
    (e.currentTarget as HTMLElement).classList.add('opacity-40');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDragTask(null);
    setDragOver(null);
    (e.currentTarget as HTMLElement).classList.remove('opacity-40');
    if (expandTimerRef.current) { clearTimeout(expandTimerRef.current); expandTimerRef.current = null; }
  };

  const handleDragOver = (t: ProjectTask, e: React.DragEvent) => {
    e.preventDefault();
    if (!dragTask || dragTask.id === t.id) return;
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const ratio = y / rect.height;

    if (ratio < 0.25) {
      setDragOver({ taskId: t.id, position: 'above' });
    } else if (ratio > 0.75) {
      setDragOver({ taskId: t.id, position: 'below' });
    } else {
      setDragOver({ taskId: t.id, position: 'into' });
      if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
      expandTimerRef.current = setTimeout(() => expandNode(t.id), 800);
    }
  };

  const handleDragLeave = () => {
    // dragOver is set immediately on dragOver event of next row; only clear on table-wide leave
  };

  const handleDrop = async (target: ProjectTask, e: React.DragEvent) => {
    e.preventDefault();
    if (!dragTask || !selectedProjectId || dragTask.id === target.id) return;
    if (expandTimerRef.current) { clearTimeout(expandTimerRef.current); expandTimerRef.current = null; }

    const pos = dragOver?.position || 'below';
    let newParentId: string | null = null;
    let newSortOrder: number;

    // Flatten visible tasks to compute sort_order
    const allVisible: ProjectTask[] = [];
    const flattenVisible = (nodes: ProjectTask[]) => {
      for (const n of nodes) {
        allVisible.push(n);
        if (expanded.has(n.id)) flattenVisible(n.children || []);
      }
    };
    flattenVisible(tasks);
    const targetIdx = allVisible.findIndex(n => n.id === target.id);

    if (pos === 'above') {
      newParentId = target.parent_id || null;
      newSortOrder = target.sort_order;
    } else if (pos === 'below') {
      newParentId = target.parent_id || null;
      newSortOrder = target.sort_order + 1;
    } else {
      newParentId = target.id;
      newSortOrder = (target.children || []).length;
    }

    try {
      await projectApi.reorderTask(selectedProjectId, {
        task_id: dragTask.id,
        new_parent_id: newParentId,
        new_sort_order: newSortOrder,
      });
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '排序失败');
    }

    setDragTask(null);
    setDragOver(null);
    reload();
  };

  const openCreate = (parentId: string | null) => {
    setEditTask(null); setEditParentId(parentId); setEditOpen(true);
  };
  const openEdit = (t: ProjectTask) => {
    setEditTask(t); setEditParentId(null); setEditOpen(true);
  };
  const findTaskById = (list: ProjectTask[], id: string): ProjectTask | null => {
    for (const t of list) {
      if (t.id === id) return t;
      const found = t.children ? findTaskById(t.children, id) : null;
      if (found) return found;
    }
    return null;
  };

  const confirmDelete = async () => {
    if (!selectedProjectId || !delTask) return;
    await projectApi.deleteTask(selectedProjectId, delTask.id);
    setDelTask(null);
    reload();
  };

  const taskMatchesSelf = useCallback((t: ProjectTask): boolean => {
    if (taskStatusFilter && t.status !== taskStatusFilter) return false;
    if (taskSearch) {
      if (t.name.includes(taskSearch) || t.code.includes(taskSearch)) return true;
      if (t.description && t.description.includes(taskSearch)) return true;
      const links = taskLinks[t.id] || [];
      if (links.some((l) =>
        (l.entity_code && l.entity_code.includes(taskSearch)) ||
        (l.entity_name && l.entity_name.includes(taskSearch))
      )) return true;
      const comments = taskComments[t.id] || [];
      if (comments.some((c) => c.content.includes(taskSearch))) return true;
      return false;
    }
    return true;
  }, [taskStatusFilter, taskSearch, taskLinks, taskComments]);

  const subtreeHasMatch = useCallback((t: ProjectTask): boolean => {
    if (taskMatchesSelf(t)) return true;
    return (t.children || []).some(c => subtreeHasMatch(c));
  }, [taskMatchesSelf]);

  const renderRow = (t: ProjectTask, depth: number): JSX.Element[] => {
    if (taskStatusFilter && t.status !== taskStatusFilter) {
      return (t.children || []).flatMap((c) => renderRow(c, depth));
    }
    if (taskSearch && !subtreeHasMatch(t)) {
      return [];
    }
    const hasChildren = (t.children?.length || 0) > 0;
    const isOpen = expanded.has(t.id);
    const overdue = isOverdue(t);
    const isDragAbove = dragOver?.taskId === t.id && dragOver?.position === 'above';
    const isDragBelow = dragOver?.taskId === t.id && dragOver?.position === 'below';
    const isDragInto = dragOver?.taskId === t.id && dragOver?.position === 'into';
    const isDragging = dragTask?.id === t.id;

    const rows: JSX.Element[] = [];

    if (isDragAbove) {
      rows.push(
        <tr key={t.id + '-above'} className="h-1">
          <td colSpan={8} className="p-0 border-0">
            <div className="h-1 bg-primary-500 rounded-full mx-1" />
          </td>
        </tr>
      );
    }

    rows.push(
      <tr
        key={t.id}
        draggable
        onDragStart={(e) => handleDragStart(t, e)}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => handleDragOver(t, e)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(t, e)}
        onClick={() => openEdit(t)}
        className={`${overdue ? 'bg-red-50' : 'hover:bg-gray-50'} cursor-pointer transition-colors ${
          isDragInto ? 'bg-blue-50 ring-2 ring-primary-300 ring-inset' : ''
        } ${isDragging ? 'opacity-40' : ''}`}
      >
        <td className="pl-2 pr-4 py-2" onClick={(e) => e.stopPropagation()} style={{ width: CODE_W }}>
          <TaskCodeCell code={t.code} depth={depth} hasChildren={hasChildren}
            isExpanded={isOpen} onToggle={() => toggle(t.id)} variant="table" />
        </td>
        <td className="px-1 py-2">
          <TaskNameCell name={t.name} taskType={t.task_type}
            isOverdue={overdue} variant="table" />
        </td>
        <td className="px-2 py-2" style={{ width: ASSIGNEE_W }}><TaskAssigneeCell assigneeName={t.assignee_name} variant="table" /></td>
        <td className="px-2 py-2">
          <span className={`px-2 py-0.5 text-xs rounded-full ${TASK_STATUS_CLASS[t.status]}`}>{t.status}</span>
        </td>
        <td className="px-2 py-2 text-sm">{t.priority}</td>
        <td className="px-2 py-2 text-sm text-gray-500">{t.planned_start || '—'}</td>
        <td className="px-2 py-2 text-sm text-gray-500">{t.planned_end || '—'}</td>
        <td className="px-4 py-2 text-right text-gray-400" onClick={(e) => e.stopPropagation()}>
          {(t.link_count ?? 0) > 0 && <span className="mr-2">🔗 {t.link_count}</span>}
          {isManager && <button onClick={() => openCreate(t.id)} className="text-primary-600 text-sm mr-2">+子</button>}
          {can('project.task:delete') && <button onClick={() => setDelTask(t)} className="text-red-600 text-sm">删除</button>}
        </td>
      </tr>
    );

    if (isDragBelow) {
      rows.push(
        <tr key={t.id + '-below'} className="h-1">
          <td colSpan={8} className="p-0 border-0">
            <div className="h-1 bg-primary-500 rounded-full mx-1" />
          </td>
        </tr>
      );
    }

    if (hasChildren && isOpen) {
      for (const c of t.children!) rows.push(...renderRow(c, depth + 1));
    }
    return rows;
  };

  // ---- Render ----
  return (
    <div className="h-full flex flex-col">
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
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-500 select-none whitespace-nowrap">编号</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-500 select-none whitespace-nowrap">名称</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-500 select-none whitespace-nowrap">负责人</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-500 select-none whitespace-nowrap">状态</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-500 select-none whitespace-nowrap">计划起止</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-500 select-none whitespace-nowrap">成员</th>
                    <th className="px-4 py-2 text-right text-sm font-medium text-gray-500 select-none whitespace-nowrap">操作</th>
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
                        <td className="px-4 py-2 text-sm font-medium">{p.code}</td>
                        <td className="px-4 py-2 text-sm">{p.name}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{p.owner_name}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-1 text-xs rounded-full ${STATUS_CLASS[p.status]}`}>{p.status}</span>
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500">{p.planned_start || '—'} ~ {p.planned_end || '—'}</td>
                        <td className="px-4 py-2 text-sm text-gray-500">{p.member_count ?? 0}</td>
                        <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
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
                <div className="flex items-center gap-3 mb-4 shrink-0 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2">
                  <span className="font-semibold">{currentProject.code} · {currentProject.name}</span>
                  <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_CLASS[currentProject.status]}`}>{currentProject.status}</span>
                  <span className="text-sm text-gray-500">负责人 {currentProject.owner_name}</span>
                  <div className="flex-1" />
                  <button onClick={() => setMemberOpen(true)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-white">成员管理</button>
                </div>

                <div className="flex items-center gap-2 mb-3 shrink-0">
                  <input
                    type="text"
                    placeholder="搜索任务..."
                    value={taskSearch}
                    onChange={(e) => setTaskSearch(e.target.value)}
                    className="w-44 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  <select value={taskStatusFilter} onChange={(e) => setTaskStatusFilter(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">
                    <option value="">全部状态</option>
                    {(['未开始', '进行中', '已完成', '挂起'] as TaskStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button onClick={() => {
                    const ids = new Set<string>();
                    const collect = (ts: ProjectTask[]) => { for (const t of ts) { if (t.children?.length) { ids.add(t.id); collect(t.children); } } };
                    collect(tasks);
                    setExpanded(ids);
                  }} className="px-2 py-1.5 text-xs rounded bg-white border border-gray-300 text-gray-600 hover:bg-gray-50">全部展开</button>
                  <button onClick={() => setExpanded(new Set())} className="px-2 py-1.5 text-xs rounded bg-white border border-gray-300 text-gray-600 hover:bg-gray-50">全部折叠</button>
                  {viewMode === 'table' ? (
                    <button onClick={() => setViewMode('gantt')} className="px-2 py-1.5 text-xs rounded bg-white border border-gray-300 text-gray-600 hover:bg-gray-50">甘特图</button>
                  ) : (
                    <button onClick={() => setViewMode('table')} className="px-2 py-1.5 text-xs rounded bg-white border border-gray-300 text-gray-600 hover:bg-gray-50">计划表</button>
                  )}
                  {viewMode === 'gantt' && (
                    <>
                      <span className="text-sm text-gray-400">视图:</span>
                      {(['day', 'week', 'month'] as const).map((s) => (
                        <button key={s} onClick={() => setGanttScale(s)}
                          className={`px-2 py-1.5 text-xs rounded ${ganttScale === s ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                          {s === 'day' ? '日' : s === 'week' ? '周' : '月'}
                        </button>
                      ))}
                      {can('project.task:depend') && (
                        <button onClick={() => setAutoScheduleKey((k) => k + 1)} className="px-2 py-1.5 text-xs rounded bg-primary-600 text-white hover:bg-primary-700">刷新排期</button>
                      )}
                    </>
                  )}
                  <div className="flex-1" />
                  {isManager && (
                    <button onClick={() => openCreate(null)} className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700">+ 新建顶层任务</button>
                  )}
                </div>

                {viewMode === 'table' ? (
                  <div className="bg-white rounded-lg border border-gray-200 overflow-y-auto flex-1 min-h-0"
                       onDragLeave={() => { setDragOver(null); if (expandTimerRef.current) { clearTimeout(expandTimerRef.current); expandTimerRef.current = null; } }}>
                    <table className="w-full text-sm table-fixed">
                      <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                        <tr>
                          <th className="text-left pl-2 pr-4 py-2 text-sm font-medium text-gray-500 whitespace-nowrap" style={{ width: CODE_W }}>任务编号</th>
                          <th className="text-left px-1 py-2 text-sm font-medium text-gray-500" style={{ width: LEFT_W - CODE_W - ASSIGNEE_W }}>任务名称</th>
                          <th className="text-left px-2 py-2 text-sm font-medium text-gray-500" style={{ width: ASSIGNEE_W }}>负责人</th>
                          <th className="text-left px-2 py-2 text-sm font-medium text-gray-500">状态</th>
                          <th className="text-left px-2 py-2 text-sm font-medium text-gray-500">优先级</th>
                          <th className="text-left px-2 py-2 text-sm font-medium text-gray-500">计划开始</th>
                          <th className="text-left px-2 py-2 text-sm font-medium text-gray-500">计划完成</th>
                          <th className="text-right px-4 py-2 text-sm font-medium text-gray-500">关联/操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {currentProject && (
                          <>
                            <tr className="bg-gray-50">
                              <td className="pl-2 pr-4 py-2 whitespace-nowrap" style={{ width: CODE_W }}>
                                <span className="font-semibold">{currentProject.code}</span>
                              </td>
                              <td className="px-1 py-2">
                                <span className="inline-flex items-center gap-1">
                                  <span>📁</span>
                                  <span className="font-medium">{currentProject.name}</span>
                                </span>
                              </td>
                              <td className="px-2 py-2 text-sm" style={{ width: ASSIGNEE_W }}>{currentProject.owner_name}</td>
                              <td className="px-2 py-2">
                                <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_CLASS[currentProject.status]}`}>{currentProject.status}</span>
                              </td>
                              <td className="px-2 py-2 text-sm text-gray-400">—</td>
                              <td className="px-2 py-2 text-sm text-gray-500">{currentProject.planned_start || '—'}</td>
                              <td className="px-2 py-2 text-sm text-gray-500">{currentProject.planned_end || '—'}</td>
                              <td className="px-4 py-2 text-right text-gray-400">
                                <button onClick={() => setMemberOpen(true)} className="text-primary-600 text-sm mr-2">成员</button>
                                {can('project:update') && (
                                  <button onClick={(e) => handleOpenEdit(currentProject, e)} className="text-primary-600 text-sm">编辑</button>
                                )}
                              </td>
                            </tr>
                            {tasks.flatMap((t) => renderRow(t, 0))}
                            {tasks.length === 0 && (
                              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">暂无任务</td></tr>
                            )}
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0">
                    <GanttView
                      projectId={selectedProjectId!}
                      canEdit={can('project.task:depend')}
                      refreshKey={ganttKey}
                      project={currentProject ? { code: currentProject.code, name: currentProject.name, planned_start: currentProject.planned_start, planned_end: currentProject.planned_end, owner_name: currentProject.owner_name } : null}
                      expanded={expanded}
                      onExpandedChange={setExpanded}
                      scale={ganttScale}
                      onScaleChange={setGanttScale}
                      autoScheduleKey={autoScheduleKey}
                      onRowClick={(id) => { const t = findTaskById(tasks, id); if (t) openEdit(t); }}
                      onTaskUpdated={() => { loadTasks(selectedProjectId!); setGanttKey((k) => k + 1); }}
                    />
                  </div>
                )}

                <MemberManageModal open={memberOpen} projectId={selectedProjectId!} ownerId={currentProject.owner_id} onClose={() => setMemberOpen(false)} />
                <TaskEditModal open={editOpen} projectId={selectedProjectId!} task={editTask} parentId={editParentId}
                               onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); reload(); }} />
                <ConfirmModal open={!!delTask} content={`确认删除任务"${delTask?.name}"及其所有子任务?`}
                              onConfirm={confirmDelete} onCancel={() => setDelTask(null)} />
              </>
            )}
          </div>
        )}

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
  );
}

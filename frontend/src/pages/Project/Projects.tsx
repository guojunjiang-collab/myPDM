import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import SharedLeftPanel from './SharedLeftPanel';
import type { Project, ProjectStatus, ProjectTask, TaskStatus, TaskLink, TaskComment, GanttTask } from '../../types/project';

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
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingTaskIdRef = useRef<string | null>(null);
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
  const [hoveredId, setHoveredId] = useState<string | null>(null);
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

  // 从仪表盘"我的任务"跳转时，自动选中项目并打开任务编辑弹窗
  useEffect(() => {
    const pid = searchParams.get('project_id');
    const tid = searchParams.get('task_id');
    if (pid) {
      setSelectedProjectId(pid);
      setTabState('detail');
      if (tid) pendingTaskIdRef.current = tid;
      setSearchParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedProjectId && tab === 'detail') {
      loadProject(selectedProjectId);
      loadTasks(selectedProjectId);
    }
  }, [selectedProjectId, tab, loadProject, loadTasks]);

  // 任务加载完成后，如果 URL 携带了 task_id，自动打开编辑弹窗
  useEffect(() => {
    if (!pendingTaskIdRef.current || tasks.length === 0) return;
    const task = findTaskById(tasks, pendingTaskIdRef.current);
    if (task) {
      setEditTask(task);
      setEditParentId(null);
      setEditOpen(true);
      pendingTaskIdRef.current = null;
    }
  }, [tasks]);

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
    // 同时刷新任务表和甘特图(甘特按 refreshKey 重新拉取 /gantt 数据)
    if (selectedProjectId) { loadTasks(selectedProjectId); setGanttKey((k) => k + 1); }
  }, [selectedProjectId, loadTasks]);

  const isManager = useMemo(() => can('project.task:create'), []);

  const toggle = (tid: string) => {
    const next = new Set(expanded);
    next.has(tid) ? next.delete(tid) : next.add(tid);
    setExpanded(next);
  };

  // 将树形任务扁平化为 GanttTask[]，供 SharedLeftPanel 统一使用
  // 筛选匹配的任务ID集合(含匹配任务的祖先链,保持树结构完整)
  const filteredTaskIds = useMemo(() => {
    if (!taskStatusFilter && !taskSearch) return new Set<string>();
    const ids = new Set<string>();
    const match = (t: ProjectTask): boolean => {
      if (taskStatusFilter && t.status !== taskStatusFilter) return false;
      if (!taskSearch) return true;
      if (t.name.includes(taskSearch) || t.code.includes(taskSearch)) return true;
      if (t.description && t.description.includes(taskSearch)) return true;
      const links = taskLinks[t.id] || [];
      if (links.some((l: TaskLink) =>
        (l.entity_code && l.entity_code.includes(taskSearch)) ||
        (l.entity_name && l.entity_name.includes(taskSearch))
      )) return true;
      const comments = taskComments[t.id] || [];
      if (comments.some((c: TaskComment) => c.content.includes(taskSearch))) return true;
      return false;
    };
    const collectAncestors = (t: ProjectTask): boolean => {
      let childMatch = false;
      for (const c of t.children || []) {
        if (collectAncestors(c)) { ids.add(t.id); childMatch = true; }
      }
      if (match(t)) { ids.add(t.id); return true; }
      return childMatch;
    };
    for (const t of tasks) collectAncestors(t);
    return ids;
  }, [taskStatusFilter, taskSearch, tasks, taskLinks, taskComments]);

  const { flatTasks, childMap, visibleLeftTasks } = useMemo(() => {
    const flat: GanttTask[] = [];
    const cm: Record<string, GanttTask[]> = {};
    const walk = (ts: ProjectTask[], parentId: string | null, depth: number) => {
      for (const t of ts) {
        const gt: GanttTask = {
          id: t.id, parent_id: parentId, code: t.code, name: t.name,
          task_type: t.task_type, status: t.status as TaskStatus,
          assignee_name: t.assignee_name,
          planned_start: t.planned_start ?? null, planned_end: t.planned_end ?? null,
          duration_days: null, is_critical: false,
          is_overdue: isOverdue(t), sort_order: t.sort_order, depth,
        };
        flat.push(gt);
        if (!cm[parentId ?? '__root__']) cm[parentId ?? '__root__'] = [];
        cm[parentId ?? '__root__'].push(gt);
        if (t.children && t.children.length > 0) walk(t.children, t.id, depth + 1);
      }
    };
    walk(tasks, null, 0);
    const hasFilter = !!(taskStatusFilter || taskSearch);
    const vis: GanttTask[] = [];
    const walkVis = (task: GanttTask) => {
      // 有筛选时只显示匹配的任务(含祖先链),无筛选时按 expanded 展开
      if (hasFilter) {
        if (!filteredTaskIds.has(task.id)) return;
        vis.push(task);
        const children = cm[task.id];
        if (children) for (const ch of children) walkVis(ch);
      } else {
        vis.push(task);
        const children = cm[task.id];
        if (children && expanded.has(task.id)) for (const ch of children) walkVis(ch);
      }
    };
    (cm['__root__'] || []).forEach(walkVis);
    return { flatTasks: flat, childMap: cm, visibleLeftTasks: vis };
  }, [tasks, expanded, taskStatusFilter, taskSearch, filteredTaskIds]);

  // ProjectTask id → 对象映射,供右侧表格行渲染时查找
  const taskById = useMemo(() => {
    const m: Record<string, ProjectTask> = {};
    const walk = (ts: ProjectTask[]) => { for (const t of ts) { m[t.id] = t; if (t.children) walk(t.children); } };
    walk(tasks);
    return m;
  }, [tasks]);

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
                  {isManager && (
                    <button onClick={() => setMemberOpen(true)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm hover:bg-white">成员管理</button>
                  )}
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
                  {(() => {
                    // 合并展开/折叠为一个切换按钮:全部已展开时显示"全部折叠",否则显示"全部展开"
                    const allIds: string[] = [];
                    const collect = (ts: ProjectTask[]) => { for (const t of ts) { if (t.children?.length) { allIds.push(t.id); collect(t.children); } } };
                    collect(tasks);
                    const allExpanded = allIds.length > 0 && allIds.every((id) => expanded.has(id));
                    return (
                      <button onClick={() => setExpanded(allExpanded ? new Set() : new Set(allIds))}
                        className="px-2 py-1.5 text-sm rounded bg-white border border-gray-300 text-gray-600 hover:bg-gray-50">
                        {allExpanded ? '全部折叠' : '全部展开'}
                      </button>
                    );
                  })()}
                  {viewMode === 'table' ? (
                    <button onClick={() => setViewMode('gantt')} className="px-2 py-1.5 text-sm rounded bg-white border border-gray-300 text-gray-600 hover:bg-gray-50">甘特图</button>
                  ) : (
                    <button onClick={() => setViewMode('table')} className="px-2 py-1.5 text-sm rounded bg-white border border-gray-300 text-gray-600 hover:bg-gray-50">计划表</button>
                  )}
                  {viewMode === 'gantt' && (
                    <>
                      <span className="text-sm text-gray-400">视图:</span>
                      {(['day', 'week', 'month'] as const).map((s) => (
                        <button key={s} onClick={() => setGanttScale(s)}
                          className={`px-2 py-1.5 text-sm rounded ${ganttScale === s ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                          {s === 'day' ? '日' : s === 'week' ? '周' : '月'}
                        </button>
                      ))}
                      {can('project.task:depend') && (
                        <button onClick={() => setAutoScheduleKey((k) => k + 1)} className="px-2 py-1.5 text-sm rounded bg-primary-600 text-white hover:bg-primary-700">刷新排期</button>
                      )}
                    </>
                  )}
                  <div className="flex-1" />
                  {isManager && (
                    <button onClick={() => openCreate(null)} className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700">+ 新建顶层任务</button>
                  )}
                </div>

                <div className="border border-gray-200 rounded-lg overflow-hidden flex-1 min-h-0">
                  <div className="overflow-y-auto h-full bg-white" style={{ overflowX: 'hidden' }}
                       onMouseLeave={() => setHoveredId(null)}
                       onDragLeave={() => { setDragOver(null); if (expandTimerRef.current) { clearTimeout(expandTimerRef.current); expandTimerRef.current = null; } }}>
                    <div className="flex">
                      <SharedLeftPanel
                        tasks={visibleLeftTasks}
                        expanded={expanded}
                        childMap={childMap}
                        onToggle={toggle}
                        onRowClick={(id) => { const t = findTaskById(tasks, id); if (t) openEdit(t); }}
                        project={currentProject ? { code: currentProject.code, name: currentProject.name, status: currentProject.status, owner_name: currentProject.owner_name } : null}
                        hoveredId={hoveredId}
                        onHover={setHoveredId}
                      />
                      {viewMode === 'table' ? (
                        <div className="flex-1 bg-white">
                           <div className="bg-gray-50 border-b border-gray-200 flex items-center text-sm font-medium text-gray-500 sticky top-0 z-10" style={{ height: 36 }}>
                            <span className="px-2 shrink-0 truncate text-left" style={{ width: 64 }}>优先级</span>
                            <span className="px-2 shrink-0 truncate text-left" style={{ width: 100 }}>计划开始</span>
                            <span className="px-2 shrink-0 truncate text-left" style={{ width: 100 }}>计划完成</span>
                            <span className="px-2 flex-1 min-w-0 truncate text-left">描述</span>
                            <span className="shrink-0 px-4 text-right">关联/操作</span>
                          </div>
                          {currentProject && (
                            <>
                              <div className="flex items-center bg-gray-50 border-b border-gray-200 text-sm" style={{ height: 36 }}>
                                <span className="px-2 shrink-0 truncate text-gray-400" style={{ width: 64 }}>—</span>
                                <span className="px-2 shrink-0 truncate text-gray-500" style={{ width: 100 }}>{currentProject.planned_start || '—'}</span>
                                <span className="px-2 shrink-0 truncate text-gray-500" style={{ width: 100 }}>{currentProject.planned_end || '—'}</span>
                                <span className="px-2 flex-1 min-w-0 truncate text-gray-500" title={currentProject.description || undefined}>{currentProject.description || '—'}</span>
                                <div className="shrink-0 flex items-center justify-end px-4 text-gray-400">
                                  {isManager && (
                                    <button onClick={() => setMemberOpen(true)} className="text-primary-600 text-sm mr-2">成员</button>
                                  )}
                                  {can('project:update') && (
                                    <button onClick={(e) => handleOpenEdit(currentProject, e)} className="text-primary-600 text-sm">编辑</button>
                                  )}
                                </div>
                              </div>
                              {(() => {
                                const rightRows: JSX.Element[] = [];
                                for (const gt of visibleLeftTasks) {
                                  const t = taskById[gt.id];
                                  if (!t) continue;
                                  const overdue = isOverdue(t);
                                  const isDragAbove = dragOver?.taskId === t.id && dragOver?.position === 'above';
                                  const isDragBelow = dragOver?.taskId === t.id && dragOver?.position === 'below';
                                  const isDragInto = dragOver?.taskId === t.id && dragOver?.position === 'into';
                                  const isDragging = dragTask?.id === t.id;
                                  if (isDragAbove) rightRows.push(<div key={t.id + '-above'} className="h-1"><div className="h-1 bg-primary-500 rounded-full mx-1" /></div>);
                                  rightRows.push(
                                    <div key={t.id} draggable
                                      onDragStart={(e) => handleDragStart(t, e)} onDragEnd={handleDragEnd}
                                      onDragOver={(e) => handleDragOver(t, e)} onDragLeave={handleDragLeave}
                                      onDrop={(e) => handleDrop(t, e)}
                                      onClick={() => openEdit(t)}
                                      onMouseEnter={() => setHoveredId(t.id)}
                                      className={`flex items-center border-b border-gray-100 text-sm ${hoveredId === t.id ? 'bg-primary-50' : ''} ${overdue ? 'bg-red-50' : ''} cursor-pointer ${isDragInto ? 'bg-blue-50 ring-2 ring-primary-300 ring-inset' : ''} ${isDragging ? 'opacity-40' : ''}`}
                                      style={{ height: 36 }}>
                                      <span className="px-2 shrink-0 truncate" style={{ width: 64 }}>{t.priority}</span>
                                      <span className="px-2 shrink-0 truncate text-gray-500" style={{ width: 100 }}>{t.planned_start || '—'}</span>
                                      <span className="px-2 shrink-0 truncate text-gray-500" style={{ width: 100 }}>{t.planned_end || '—'}</span>
                                      <span className="px-2 flex-1 min-w-0 truncate text-gray-500" title={t.description || undefined}>{t.description || '—'}</span>
                                      <div className="shrink-0 flex items-center justify-end px-4 text-gray-400" onClick={(e) => e.stopPropagation()}>
                                        {(t.link_count ?? 0) > 0 && <span className="mr-2">🔗 {t.link_count}</span>}
                                        {isManager && <button onClick={() => openCreate(t.id)} className="text-primary-600 text-sm mr-2">+子</button>}
                                        {can('project.task:delete') && <button onClick={() => setDelTask(t)} className="text-red-600 text-sm">删除</button>}
                                      </div>
                                    </div>
                                  );
                                  if (isDragBelow) rightRows.push(<div key={t.id + '-below'} className="h-1"><div className="h-1 bg-primary-500 rounded-full mx-1" /></div>);
                                }
                                return <>{rightRows.length > 0 ? rightRows : tasks.length === 0 ? <div className="px-4 py-8 text-center text-gray-400">暂无任务</div> : <div className="px-4 py-8 text-center text-gray-400">无匹配任务</div>}</>;
                              })()}
                            </>
                          )}
                        </div>
                      ) : (
                        <GanttView
                          hideLeftPanel
                          hoveredId={hoveredId}
                          onHoverChange={setHoveredId}
                          filteredTaskIds={filteredTaskIds.size > 0 ? filteredTaskIds : null}
                          projectId={selectedProjectId!}
                          canEdit={can('project.task:depend')}
                          refreshKey={ganttKey}
                          project={currentProject ? { code: currentProject.code, name: currentProject.name, status: currentProject.status, planned_start: currentProject.planned_start, planned_end: currentProject.planned_end, owner_name: currentProject.owner_name } : null}
                          expanded={expanded}
                          onExpandedChange={setExpanded}
                          scale={ganttScale}
                          onScaleChange={setGanttScale}
                          autoScheduleKey={autoScheduleKey}
                          onRowClick={(id) => { const t = findTaskById(tasks, id); if (t) openEdit(t); }}
                          onTaskUpdated={() => { loadTasks(selectedProjectId!); setGanttKey((k) => k + 1); }}
                        />
                      )}
                    </div>
                  </div>
                </div>

                <MemberManageModal open={memberOpen} projectId={selectedProjectId!} ownerId={currentProject.owner_id}
                  onClose={() => setMemberOpen(false)}
                  onSaved={() => { loadProject(selectedProjectId!); loadTasks(selectedProjectId!); loadProjects(); }} />
                <TaskEditModal open={editOpen} projectId={selectedProjectId!} task={editTask} parentId={editParentId}
                               onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); reload(); }}
                               onRefresh={() => reload()} />
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

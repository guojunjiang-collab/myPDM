import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProjectStore } from '../../stores/project';
import { projectApi } from '../../services/projectApi';
import { usersApi } from '../../services/api';
import { can, useAuthStore } from '../../stores/auth';
import { Modal, ConfirmModal } from '../../components/Modal';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Textarea from '../../components/ui/Textarea';
import SortableTh from '../../components/ui/SortableTh';
import { toast } from '../../components/Toast';
import { useHeaderTabs } from '../../hooks/useHeaderTabs';
import { usePersistedTabState } from '../../hooks/usePersistedTabState';
import { useTableSort } from '../../hooks/useTableSort';
import MemberManageModal from './MemberManageModal';
import DeliverableModal from './DeliverableModal';
import TaskEditModal from './TaskEditModal';
import GanttView from './gantt/GanttView';
import SharedLeftPanel from './SharedLeftPanel';
import { LEFT_W } from './gantt/ganttUtils';
import type { Project, ProjectStatus, ProjectTask, TaskStatus, TaskLink, TaskComment, GanttTask } from '../../types/project';

const STATUSES: ProjectStatus[] = ['待启动', '进行中', '已完成', '已暂停', '已归档'];

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
  const [tab, setTabState] = usePersistedTabState<TabKey>('summary');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const handleTabChange = useCallback((t: TabKey) => {
    setTabState(t);
    if (t === 'summary') setSelectedProjectId(null);
  }, []);
  useHeaderTabs(tabs, tab, handleTabChange);

  const { projects, currentProject, loadProjects, loadProject, tasks, loadTasks, loading, patchTask } = useProjectStore();
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
  const [deliverableOpen, setDeliverableOpen] = useState(false);
  const [deliverableKey, setDeliverableKey] = useState(0);
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
  const [onlyMine, setOnlyMine] = useState(false);
  const myId = useAuthStore((s) => s.user?.id ?? null);
  const [taskSearch, setTaskSearch] = useState('');
  const [taskLinks, setTaskLinks] = useState<Record<string, TaskLink[]>>({});
  const [taskComments, setTaskComments] = useState<Record<string, TaskComment[]>>({});
  const [dragTask, setDragTask] = useState<ProjectTask | null>(null);
  const [dragOver, setDragOver] = useState<{ taskId: string; position: 'above' | 'below' | 'into' } | null>(null);
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedProjectIdRef = useRef<string | null>(null);
  useEffect(() => { selectedProjectIdRef.current = selectedProjectId; }, [selectedProjectId]);

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

  // 客户端排序（全量数据）
  const { sortedData: sortedProjects, sortField, sortDirection, handleSort } = useTableSort<Project>(filtered);

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
    useProjectStore.setState({ tasks: [] });
    setTabState('detail');
    setSelectedProjectId(projectId);
  };

  // ---- Detail tab actions ----
  const reload = useCallback(() => {
    // 同时刷新任务表和甘特图(甘特按 refreshKey 重新拉取 /gantt 数据)
    if (selectedProjectId) { loadTasks(selectedProjectId); setGanttKey((k) => k + 1); }
  }, [selectedProjectId, loadTasks]);

  // 系统角色 + 项目角色双层判定：两者都满足才显示管理类按钮，避免"看得见却 403"。
  // is_manager 由 GET /projects/{id} 返回（admin / owner / 经理成员）。
  const isManager = useMemo(
    () => can('project.task:create') && currentProject?.is_manager === true,
    [currentProject?.is_manager],
  );

  // 展开层级下拉的受控值:'collapsed'|'all'|数字字符串|'custom'（默认与 expanded 空集一致 = 全部折叠）
  const [expandSel, setExpandSel] = useState<string>('collapsed');

  const toggle = (tid: string) => {
    const next = new Set(expanded);
    next.has(tid) ? next.delete(tid) : next.add(tid);
    setExpanded(next);
    setExpandSel('custom');
  };

  // 任务树最大深度
  const maxTreeDepth = useMemo(() => {
    let max = 0;
    const walk = (ts: ProjectTask[], d: number) => {
      for (const t of ts) {
        if (d > max) max = d;
        if (t.children?.length) walk(t.children, d + 1);
      }
    };
    walk(tasks, 0);
    return max;
  }, [tasks]);

  // 收集 depth < k 且有子节点的任务ID
  const collectExpandableByDepth = useCallback((k: number): string[] => {
    const ids: string[] = [];
    const walk = (ts: ProjectTask[], d: number) => {
      for (const t of ts) {
        if (d < k && t.children?.length) ids.push(t.id);
        if (t.children?.length) walk(t.children, d + 1);
      }
    };
    walk(tasks, 0);
    return ids;
  }, [tasks]);

  const handleExpandChange = (value: string) => {
    setExpandSel(value);
    if (value === 'custom') return;
    if (value === 'all') {
      const allIds: string[] = [];
      const collect = (ts: ProjectTask[]) => {
        for (const t of ts) { if (t.children?.length) { allIds.push(t.id); collect(t.children); } }
      };
      collect(tasks);
      setExpanded(new Set(allIds));
    } else if (value === 'collapsed') {
      setExpanded(new Set());
    } else {
      setExpanded(new Set(collectExpandableByDepth(Number(value))));
    }
  };

  // 将树形任务扁平化为 GanttTask[]，供 SharedLeftPanel 统一使用
  // 筛选匹配的任务ID集合(含匹配任务的祖先链,保持树结构完整)
  const filteredTaskIds = useMemo(() => {
    if (!taskStatusFilter && !taskSearch && !onlyMine) return new Set<string>();
    const ids = new Set<string>();
    const match = (t: ProjectTask): boolean => {
      if (onlyMine && t.assignee_id !== myId) return false;
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
  }, [taskStatusFilter, taskSearch, onlyMine, myId, tasks, taskLinks, taskComments]);

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
    const hasFilter = !!(taskStatusFilter || taskSearch || onlyMine);
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
  }, [tasks, expanded, taskStatusFilter, taskSearch, onlyMine, filteredTaskIds]);

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
  // 交付物弹窗里点来源任务：不关闭交付物弹窗，直接在其上层打开任务编辑弹窗
  const handleOpenTaskFromDeliverable = useCallback((taskId: string) => {
    const t = findTaskById(tasks, taskId);
    if (!t) { toast.error('任务不存在或已被删除'); return; }
    setEditTask(t);
    setEditParentId(null);
    setEditOpen(true);
  }, [tasks]);

  const confirmDelete = async () => {
    if (!selectedProjectId || !delTask) return;
    await projectApi.deleteTask(selectedProjectId, delTask.id);
    setDelTask(null);
    reload();
  };

  const taskMatchesSelf = useCallback((t: ProjectTask): boolean => {
    if (onlyMine && t.assignee_id !== myId) return false;
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
  }, [taskStatusFilter, taskSearch, onlyMine, myId, taskLinks, taskComments]);

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
              <Input
                type="text"
                placeholder="搜索编号/名称..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 min-w-0"
              />
              <Select
                className="!w-auto"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">全部状态</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <div className="flex-1" />
              {can('project:create') && (
                <Button onClick={handleOpenCreate}>
                  + 新建项目
                </Button>
              )}
            </div>

            <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-y-auto flex-1 min-h-0">
              <table className="w-full">
                <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)] sticky top-0 z-10">
                  <tr>
                    <SortableTh sortKey="code" active={sortField === 'code'} direction={sortDirection} onSort={(k) => handleSort(k as keyof Project)} className="text-left">编号</SortableTh>
                    <SortableTh sortKey="name" active={sortField === 'name'} direction={sortDirection} onSort={(k) => handleSort(k as keyof Project)} className="text-left">名称</SortableTh>
                    <SortableTh sortKey="owner_name" active={sortField === 'owner_name'} direction={sortDirection} onSort={(k) => handleSort(k as keyof Project)} className="text-left">负责人</SortableTh>
                    <SortableTh sortKey="status" active={sortField === 'status'} direction={sortDirection} onSort={(k) => handleSort(k as keyof Project)} className="text-left">状态</SortableTh>
                    <SortableTh className="text-left">计划起止</SortableTh>
                    <SortableTh sortKey="member_count" active={sortField === 'member_count'} direction={sortDirection} onSort={(k) => handleSort(k as keyof Project)} className="text-left">成员</SortableTh>
                    <SortableTh align="right">操作</SortableTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">加载中...</td>
                    </tr>
                  ) : sortedProjects.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-[var(--ui-text-secondary)]">暂无项目</td>
                    </tr>
                  ) : (
                    sortedProjects.map((p) => (
                      <tr key={p.id} onClick={() => handleSelectProject(p.id)}
                          className="hover:bg-[var(--ui-bg-hover)] cursor-pointer">
                        <td className="px-4 py-2 text-sm font-medium">{p.code}</td>
                        <td className="px-4 py-2 text-sm">{p.name}</td>
                        <td className="px-4 py-2 text-sm text-[var(--ui-text-secondary)]">{p.owner_name}</td>
                        <td className="px-4 py-2">
                          <Badge status={p.status} domain="project" />
                        </td>
                        <td className="px-4 py-2 text-sm text-[var(--ui-text-secondary)]">{p.planned_start || '—'} ~ {p.planned_end || '—'}</td>
                        <td className="px-4 py-2 text-sm text-[var(--ui-text-secondary)]">{p.member_count ?? 0}</td>
                        <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          {can('project:update') && (
                            <Button variant="link" size="xs" className="mr-3" onClick={(e) => handleOpenEdit(p, e)}>编辑</Button>
                          )}
                          {can('project:delete') && (
                            <Button variant="danger" size="xs" onClick={(e) => handleDeleteClick(p, e)}>删除</Button>
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
              <div className="flex-1 flex items-center justify-center text-[var(--ui-text-tertiary)]">
                {selectedProjectId ? '加载中...' : '请从项目汇总中选择一个项目'}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-4 shrink-0 bg-[var(--ui-bg-subtle)] border border-[var(--ui-border)] rounded-lg px-4 py-2">
                  <span className="font-semibold">{currentProject.code} · {currentProject.name}</span>
                  <Badge status={currentProject.status} domain="project" />
                  <span className="text-sm text-[var(--ui-text-secondary)]">负责人 {currentProject.owner_name}</span>
                  <div className="flex-1" />
                  <Button variant="secondary" size="md" onClick={() => setDeliverableOpen(true)}>交付物汇总</Button>
                  {isManager && (
                    <Button variant="secondary" size="md" onClick={() => setMemberOpen(true)}>成员管理</Button>
                  )}
                </div>

                <div className="flex items-center gap-2 mb-3 shrink-0">
                  <Input
                    type="text"
                    placeholder="搜索任务..."
                    value={taskSearch}
                    onChange={(e) => setTaskSearch(e.target.value)}
                    className="!w-64 shrink-0"
                  />
                  <Select className="!w-auto" value={taskStatusFilter} onChange={(e) => setTaskStatusFilter(e.target.value)}>
                    <option value="">全部状态</option>
                    {(['未开始', '进行中', '已完成', '挂起'] as TaskStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                  <Button active={onlyMine} onClick={() => setOnlyMine((v) => !v)}>
                    只看我的任务
                  </Button>
                  {maxTreeDepth > 0 && (
                    <Select size="md" className="!w-auto"
                      value={expandSel}
                      onChange={(e) => handleExpandChange(e.target.value)}
                    >
                      <option value="collapsed">全部折叠</option>
                      {Array.from({ length: maxTreeDepth }, (_, i) => i + 1).map((k) => (
                        <option key={k} value={String(k)}>L{k}</option>
                      ))}
                      <option value="all">全部展开</option>
                      {expandSel === 'custom' && <option value="custom">自定义</option>}
                    </Select>
                  )}
                  {viewMode === 'table' ? (
                    <Button variant="secondary" size="md" onClick={() => setViewMode('gantt')}>甘特图</Button>
                  ) : (
                    <Button variant="secondary" size="md" onClick={() => setViewMode('table')}>计划表</Button>
                  )}
                  {viewMode === 'gantt' && (
                    <>
                      <span className="text-sm text-[var(--ui-text-tertiary)]">视图:</span>
                      {(['day', 'week', 'month'] as const).map((s) => (
                        <Button key={s} size="md" active={ganttScale === s} onClick={() => setGanttScale(s)}>
                          {s === 'day' ? '日' : s === 'week' ? '周' : '月'}
                        </Button>
                      ))}
                      {can('project.task:depend') && (
                        <Button size="md" onClick={() => setAutoScheduleKey((k) => k + 1)}>刷新排期</Button>
                      )}
                    </>
                  )}
                  <div className="flex-1" />
                  {isManager && (
                    <Button size="md" onClick={() => openCreate(null)}>+ 新建顶层任务</Button>
                  )}
                </div>

                <div className="border border-[var(--ui-border)] rounded-lg overflow-hidden flex-1 min-h-0">
                  {/* 双向滚动容器：左侧面板 sticky left-0 冻结（参考 CAD 工作台 BOM 匹配表的固定列+横向滚动设计），
                      空间不足时右侧计划表可横向滚动，操作列始终可查看 */}
                  <div className="overflow-auto h-full bg-[var(--ui-bg-surface)]"
                       onMouseLeave={() => setHoveredId(null)}
                       onDragLeave={() => { setDragOver(null); if (expandTimerRef.current) { clearTimeout(expandTimerRef.current); expandTimerRef.current = null; } }}>
                    <div className="flex">
                      <div className="sticky left-0 z-20 bg-[var(--ui-bg-surface)]" style={{ width: LEFT_W, flexShrink: 0 }}>
                        <SharedLeftPanel
                        tasks={visibleLeftTasks}
                        expanded={expanded}
                        childMap={childMap}
                        onToggle={toggle}
                        onRowClick={(id) => { const t = findTaskById(tasks, id); if (t) openEdit(t); }}
                        project={currentProject ? { code: currentProject.code, name: currentProject.name, status: currentProject.status, owner_name: currentProject.owner_name } : null}
                        hoveredId={hoveredId}
                        onHover={setHoveredId}
                        dragTask={dragTask}
                        dragOver={dragOver}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                      />
                      </div>
                      {viewMode === 'table' ? (
                        <div className="flex-1 min-w-0 bg-[var(--ui-bg-surface)]">
                           <div className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)] flex items-center text-sm font-medium text-[var(--ui-text-secondary)] sticky top-0 z-10" style={{ height: 36 }}>
                            <span className="px-2 shrink-0 truncate text-left" style={{ width: 64 }}>优先级</span>
                            <span className="px-2 shrink-0 truncate text-left" style={{ width: 100 }}>计划开始</span>
                            <span className="px-2 shrink-0 truncate text-left" style={{ width: 100 }}>计划完成</span>
                            <span className="px-2 flex-1 min-w-0 truncate text-left">描述</span>
                            <span className="shrink-0 px-4 text-right">关联/操作</span>
                          </div>
                          {currentProject && (
                            <>
                              <div className="flex items-center bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)] text-sm" style={{ height: 36 }}>
                                <span className="px-2 shrink-0 truncate text-[var(--ui-text-tertiary)]" style={{ width: 64 }}>—</span>
                                <span className="px-2 shrink-0 truncate text-[var(--ui-text-secondary)]" style={{ width: 100 }}>{currentProject.planned_start || '—'}</span>
                                <span className="px-2 shrink-0 truncate text-[var(--ui-text-secondary)]" style={{ width: 100 }}>{currentProject.planned_end || '—'}</span>
                                <span className="px-2 flex-1 min-w-0 truncate text-[var(--ui-text-secondary)]" title={currentProject.description || undefined}>{currentProject.description || '—'}</span>
                                <div className="shrink-0 flex items-center justify-end px-4 text-[var(--ui-text-tertiary)]">
                                  {isManager && (
                                    <Button variant="link" size="xs" className="mr-2" onClick={() => setMemberOpen(true)}>成员</Button>
                                  )}
                                  {can('project:update') && (
                                    <Button variant="link" size="xs" onClick={(e) => handleOpenEdit(currentProject, e)}>编辑</Button>
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
                                      className={`flex items-center border-b border-[var(--ui-border)] text-sm ${hoveredId === t.id ? 'bg-primary-50' : ''} ${overdue ? 'bg-red-50' : ''} cursor-pointer ${isDragInto ? 'bg-blue-50 ring-2 ring-primary-300 ring-inset' : ''} ${isDragging ? 'opacity-40' : ''}`}
                                      style={{ height: 36 }}>
                                      <span className="px-2 shrink-0 truncate" style={{ width: 64 }}>{t.priority}</span>
                                      <span className="px-2 shrink-0 truncate text-[var(--ui-text-secondary)]" style={{ width: 100 }}>{t.planned_start || '—'}</span>
                                      <span className="px-2 shrink-0 truncate text-[var(--ui-text-secondary)]" style={{ width: 100 }}>{t.planned_end || '—'}</span>
                                      <span className="px-2 flex-1 min-w-0 truncate text-[var(--ui-text-secondary)]" title={t.description || undefined}>{t.description || '—'}</span>
                                      <div className="shrink-0 flex items-center justify-end px-4 text-[var(--ui-text-tertiary)]" onClick={(e) => e.stopPropagation()}>
                                        {(t.link_count ?? 0) > 0 && <span className="mr-2">🔗 {t.link_count}</span>}
                                        {isManager && <Button variant="link" size="xs" className="mr-2" onClick={() => openCreate(t.id)}>+子</Button>}
                                        {can('project.task:delete') && <Button variant="danger" size="xs" onClick={() => setDelTask(t)}>删除</Button>}
                                      </div>
                                    </div>
                                  );
                                  if (isDragBelow) rightRows.push(<div key={t.id + '-below'} className="h-1"><div className="h-1 bg-primary-500 rounded-full mx-1" /></div>);
                                }
                                return <>{rightRows.length > 0 ? rightRows : tasks.length === 0 ? <div className="px-4 py-8 text-center text-[var(--ui-text-tertiary)]">暂无任务</div> : <div className="px-4 py-8 text-center text-[var(--ui-text-tertiary)]">无匹配任务</div>}</>;
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
                <DeliverableModal open={deliverableOpen} projectId={selectedProjectId!}
                  projectCode={currentProject.code} refreshKey={deliverableKey}
                  onClose={() => setDeliverableOpen(false)}
                  onOpenTask={handleOpenTaskFromDeliverable} />
                <TaskEditModal open={editOpen} projectId={selectedProjectId!} task={editTask} parentId={editParentId}
                               onClose={() => setEditOpen(false)}
                               onSaved={(saved) => {
                                 setEditOpen(false);
                                 // 项目详情下显示的全部任务信息原地刷新：
                                 // patchTask 立即本地更新（不闪屏）+ reload 全量重拉任务树（父级日期汇总/所有层级）+ 甘特图 + 交付物
                                 if (saved?.taskId) patchTask(saved.taskId, saved);
                                 reload();
                                 setDeliverableKey((k) => k + 1);
                               }}
                               onRefresh={(payload) => {
                                 // 弹窗内状态流转等：本地更新 + 全量校准（父级汇总等）
                                 if (payload?.taskId) patchTask(payload.taskId, payload);
                                 reload();
                               }} />
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
            <div className="col-span-2 bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">项目名称 <span className="text-red-500">*</span></label>
              <Input size="xs"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            {editingProject && (
              <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
                <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">状态</label>
                <Select size="xs"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
            )}
            {editingProject && (
              <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
                <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">负责人</label>
                <Select size="xs"
                  value={form.owner_id}
                  onChange={(e) => setForm({ ...form, owner_id: e.target.value })}
                >
                  {allUsers.map((u) => <option key={u.id} value={u.id}>{u.real_name} ({u.username})</option>)}
                </Select>
              </div>
            )}
            <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">计划开始</label>
              <Input size="xs"
                type="date"
                value={form.planned_start}
                onChange={(e) => setForm({ ...form, planned_start: e.target.value })}
              />
            </div>
            <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">计划完成</label>
              <Input size="xs"
                type="date"
                value={form.planned_end}
                onChange={(e) => setForm({ ...form, planned_end: e.target.value })}
              />
            </div>
            <div className="col-span-2 bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-[var(--ui-border)]">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">描述</label>
              <Textarea size="xs"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="resize-none"
                rows={3}
                placeholder="可选"
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-4 border-t mt-4">
          <Button variant="secondary" onClick={() => { setCreateOpen(false); setEditingProject(null); }}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : (editingProject ? '保存' : '创建')}
          </Button>
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

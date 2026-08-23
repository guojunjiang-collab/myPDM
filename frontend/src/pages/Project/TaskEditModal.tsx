import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { toast } from '../../components/Toast';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Textarea from '../../components/ui/Textarea';
import type { BadgeTone } from '../../constants/badges';
import { projectApi } from '../../services/projectApi';
import { partsApi, documentsApi, ecrApi, ecoApi, logsApi, customFieldsApi, mediaApi } from '../../services/api';
import { useDataStore } from '../../stores/data';
import type { CustomFieldDefinition, CustomFieldValue } from '../../types';
import ItemPicker, { StatusTag } from '../../components/ItemPicker';
import { previewAttachment } from '../../utils/attachmentPreview';
import ECPicker from '../../components/ECPicker';
import PartDetailModal from '../../components/PartDetailModal';
import DocumentDetailModal from '../../components/DocumentDetailModal';
import ConfigItemDetailModal from '../../components/Configuration/ConfigItemDetailModal';
import ArchiveTreeModal from '../../components/ArchiveTreeModal';
import { ECRDetailModal } from '../../components/ECR/ECRDetailModal';
import { ECODetailModal } from '../../components/ECO/ECODetailModal';
import type { ProjectTask, TaskType, TaskStatus, TaskPriority, TaskLink, TaskComment, TaskDependency, DepType } from '../../types/project';
import type { OperationLog } from '../../types';
import { formatDateTime } from '../../utils/date';
import { can } from '../../stores/auth';

interface Props {
  open: boolean;
  projectId: string;
  task: ProjectTask | null;
  parentId: string | null;
  onClose: () => void;
  onSaved: (savedPayload?: Record<string, any>) => void;
  /** 刷新父级数据但不关闭弹窗（状态动作按钮用）。传入本次更新的 payload 以便局部刷新。 */
  onRefresh?: (payload?: Record<string, any>) => void;
}

const TYPES: TaskType[] = ['任务', '里程碑', '评审'];
const STATUSES: TaskStatus[] = ['未开始', '进行中', '已完成', '挂起'];
const PRIORITIES: TaskPriority[] = ['高', '中', '低'];
const LINK_BADGE: Record<string, { tone: BadgeTone; label: string }> = {
  part: { tone: 'blue', label: '零件' },
  assembly: { tone: 'purple', label: '部件' },
  component: { tone: 'blue', label: '零部件' },
  config_item: { tone: 'green', label: '构型项' },
  ec: { tone: 'amber', label: 'EC' },
  document: { tone: 'gray', label: '图文档' },
};

const logActionTone = (action: string): BadgeTone => {
  if (action === '创建任务') return 'green';
  if (action === '删除任务') return 'red';
  if (action === '任务状态变更') return 'blue';
  return 'gray';
};

export default function TaskEditModal({ open, projectId, task, parentId, onClose, onSaved, onRefresh }: Props) {
  const empty = { name: '', task_type: '任务' as TaskType, assignee_id: '', status: '未开始' as TaskStatus,
    priority: '中' as TaskPriority, planned_start: '', planned_end: '', actual_start: '', actual_end: '', description: '' };
  const [form, setForm] = useState(empty);
  // 有子任务的任务：计划周期由其子任务统计（rollup）而来，编辑时不可手动修改
  const hasChildren = (task?.children?.length ?? 0) > 0;
  const [statusSaving, setStatusSaving] = useState(false);
  const [tab, setTab] = useState<'info' | 'links' | 'comments' | 'logs'>('info');
  const [taskLogs, setTaskLogs] = useState<OperationLog[]>([]);
  const [taskLogsLoading, setTaskLogsLoading] = useState(false);
  const [users, setUsers] = useState<{ id: string; real_name: string }[]>([]);
  const [links, setLinks] = useState<TaskLink[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [showECPicker, setShowECPicker] = useState(false);
  const [detailEntityId, setDetailEntityId] = useState<string | null>(null);
  const [detailEntityType, setDetailEntityType] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailCustomDefs, setDetailCustomDefs] = useState<CustomFieldDefinition[]>([]);
  const [detailCustomValues, setDetailCustomValues] = useState<Record<string, unknown>>({});
  const [detailDocId, setDetailDocId] = useState<string | null>(null);
  const [archivePreview, setArchivePreview] = useState<{ attId: string; fileName: string } | null>(null);
  const [ecView, setEcView] = useState<{ id: string; kind: 'ecr' | 'eco' } | null>(null);

  const canEditDeps = can('project.task:depend');
  const [deps, setDeps] = useState<TaskDependency[]>([]);
  const [allTasks, setAllTasks] = useState<{ id: string; code: string; name: string }[]>([]);
  const [depForm, setDepForm] = useState<{ other: string; role: 'pred' | 'succ'; type: DepType; lag: number }>(
    { other: '', role: 'pred', type: 'FS', lag: 0 });
  const [depTaskSearch, setDepTaskSearch] = useState('');
  const [taskDropOpen, setTaskDropOpen] = useState(false);
  const taskDropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (taskDropRef.current && !taskDropRef.current.contains(e.target as Node)) {
        setTaskDropOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadDeps = async () => {
    if (!projectId || !task?.id) return;
    const [dRes, tRes] = await Promise.all([
      projectApi.listDeps(projectId),
      projectApi.listTasks(projectId),
    ]);
    const mine = (dRes.data.items as TaskDependency[]).filter(
      (d) => d.predecessor_id === task.id || d.successor_id === task.id);
    setDeps(mine);
    const flat: { id: string; code: string; name: string }[] = [];
    const walk = (arr: any[]) => arr.forEach((t) => { if (t.id !== task!.id) flat.push({ id: t.id, code: t.code, name: t.name }); (t.children || []).forEach((c: any) => walk([c])); });
    walk(tRes.data.items || []);
    setAllTasks(flat);
  };

  useEffect(() => {
    if (!open) return;
    setTab('info');
    projectApi.listMembers(projectId).then((r) => {
      const members = (r.data.items || []).map((m: any) => ({ id: m.user_id, real_name: m.user_name }));
      setUsers(members);
    }).catch(() => setUsers([]));
    if (task) {
      setForm({
        name: task.name, task_type: task.task_type, assignee_id: task.assignee_id || '',
        status: task.status, priority: task.priority,
        planned_start: task.planned_start || '', planned_end: task.planned_end || '',
        actual_start: task.actual_start || '', actual_end: task.actual_end || '',
        description: task.description || '',
      });
      loadLinks(task.id);
      loadComments(task.id);
      loadDeps();
    } else {
      setForm(empty);
      setLinks([]); setComments([]); setDeps([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task]);

  const loadLinks = async (taskId: string) => {
    const r = await projectApi.listLinks(projectId, taskId);
    setLinks(r.data.items);
  };
  const loadComments = async (taskId: string) => {
    const r = await projectApi.listComments(projectId, taskId);
    setComments(r.data.items);
  };

  const handleSave = async () => {
    const payload: any = { ...form, parent_id: task ? undefined : parentId };
    // 补负责人显示名（项目详情任务表按 assignee_name 显示；清空负责人时置 null 及时刷新）
    const u = users.find((x) => x.id === payload.assignee_id);
    payload.assignee_name = u ? u.real_name : null;
    // 未填日期发送 null 而非空字符串,避免后端日期校验失败
    if (payload.planned_start === '') payload.planned_start = null;
    if (payload.planned_end === '') payload.planned_end = null;
    if (payload.actual_start === '') payload.actual_start = null;
    if (payload.actual_end === '') payload.actual_end = null;
    try {
      if (task) {
        // 有子任务：计划周期由子任务汇总，不提交手动修改（后端按子任务统计）
        if (hasChildren) {
          delete payload.planned_start;
          delete payload.planned_end;
        }
        await projectApi.updateTask(projectId, task.id, payload); onSaved({ taskId: task.id, ...payload });
      }
      else { await projectApi.createTask(projectId, payload); onSaved(); }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '保存失败');
    }
  };

  const handleStatusAction = async (newStatus: TaskStatus) => {
    if (!task) return;
    setStatusSaving(true);
    const today = new Date().toISOString().slice(0, 10);
    const payload: any = { status: newStatus };
    if (newStatus === '进行中' && task.status === '未开始') payload.actual_start = today;
    if (newStatus === '已完成') payload.actual_end = today;
    if (newStatus === '进行中' && (task.status === '挂起' || task.status === '已完成')) payload.actual_end = null;
    try {
      await projectApi.updateTask(projectId, task.id, payload);
      setForm({
        ...form,
        status: newStatus,
        actual_start: payload.actual_start ?? form.actual_start,
        actual_end: payload.actual_end !== undefined ? (payload.actual_end ?? '') : form.actual_end,
      });
      // 刷新父级（甘特/计划表）但不关闭弹窗，便于连续操作
      onRefresh?.({ ...payload, taskId: task.id });
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '操作失败');
    } finally {
      setStatusSaving(false);
    }
  };

  const ensureTaskId = (): string | null => {
    if (!task) { toast.error('请先保存任务,再添加关联对象/评论'); return null; }
    return task.id;
  };

  const addLinks = async (items: { entity_type: string; entity_id: string }[]) => {
    const tid = ensureTaskId(); if (!tid) return;
    for (const it of items) await projectApi.addLink(projectId, tid, it);
    loadLinks(tid);
  };
  const removeLink = async (linkId: string) => {
    const tid = ensureTaskId(); if (!tid) return;
    await projectApi.removeLink(projectId, tid, linkId);
    loadLinks(tid);
  };

  /** 与用户看板一致的预览：部件 → 装配体 3D；零件 → STP 附件 3D；图文档 → 附件预览 */
  const handleLinkPreview = async (l: TaskLink) => {
    if (l.entity_type === 'assembly') {
      window.open(`/stp-viewer?assembly=${l.entity_id}`, '_blank');
      return;
    }
    if (l.entity_type === 'part') {
      try {
        const res: any = await partsApi.listAttachments(l.entity_id);
        const atts: any[] = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : (res?.items || []));
        const stp = atts.find((a) => /\.(stp|step)$/i.test(a.file_name || ''));
        if (stp) {
          const mt = await mediaApi.token(stp.id, 'gltf');
          window.open(`/stp-viewer?id=${stp.id}&token=${encodeURIComponent(mt)}`, '_blank');
          return;
        }
      } catch { /* 提示 */ }
      toast.info('该零件生产附件无 STP 文件');
      return;
    }
    if (l.entity_type === 'document') {
      try {
        const res: any = await documentsApi.listAttachments(l.entity_id);
        const atts: any[] = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : (res?.items || []));
        const att = atts[0];
        if (att) {
          await previewAttachment(att.id, att.file_name || '', {
            onArchive: () => toast.info('压缩包附件请在图文档详情中查看'),
          });
          return;
        }
      } catch { /* 提示 */ }
      toast.info('该图文档暂无附件可预览');
    }
  };

  const submitComment = async () => {
    const tid = ensureTaskId(); if (!tid || !newComment.trim()) return;
    await projectApi.addComment(projectId, tid, newComment.trim());
    setNewComment('');
    loadComments(tid);
  };
  const removeComment = async (commentId: string) => {
    const tid = ensureTaskId(); if (!tid) return;
    await projectApi.deleteComment(projectId, tid, commentId);
    loadComments(tid);
  };

  /** 关联对象排序：类型/件号/名称/版本/状态 */
  const [linkSort, setLinkSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const toggleLinkSort = (key: string) => {
    setLinkSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };
  const sortedLinks = useMemo(() => {
    if (!linkSort) return links;
    const dir = linkSort.dir === 'asc' ? 1 : -1;
    return [...links].sort((a, b) => {
      const get = (l: TaskLink) => linkSort.key === 'entity_type' ? (LINK_BADGE[l.entity_type]?.label ?? l.entity_type) : ((l as any)[linkSort.key] ?? '');
      return String(get(a)).localeCompare(String(get(b)), 'zh') * dir;
    });
  }, [links, linkSort]);
  const LinkSortArrow = ({ k }: { k: string }) => (
    <span className="ml-0.5 text-[10px]">{linkSort?.key === k ? (linkSort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
  );

  const handleViewEntity = async (entityType: string, entityId: string) => {
    if (entityType === 'ec') {
      // 关联只存 entity_type='ec',先试 ECR,失败再试 ECO,以打开对应详情弹窗
      try {
        await ecrApi.get(entityId);
        setEcView({ id: entityId, kind: 'ecr' });
      } catch {
        try {
          await ecoApi.detail(entityId);
          setEcView({ id: entityId, kind: 'eco' });
        } catch {
          toast.error('无法打开该变更单(ECR/ECO 不存在或无权限)');
        }
      }
      return;
    }
    if (entityType === 'document') {
      setDetailDocId(entityId);
      return;
    }
    setDetailEntityId(entityId);
    setDetailEntityType(entityType);
    setDetailData(null);
    setDetailCustomDefs([]);
    setDetailCustomValues({});
    if (entityType === 'config_item') return;
    setDetailLoading(true);
    try {
      let res;
      const isPart = entityType === 'part' || entityType === 'assembly';
      if (isPart) res = await partsApi.getRevision(entityId);
      else if (entityType === 'document') res = await documentsApi.get(entityId);
      if (res) setDetailData(res);

      // 加载自定义字段定义和值
      const cfEntityType = isPart ? 'parts' : entityType;
      const allDefs: CustomFieldDefinition[] = useDataStore.getState().customFieldDefs;
      setDetailCustomDefs(allDefs.filter((d) => d.applies_to?.includes(cfEntityType)));
      const valRes = await customFieldsApi.getValues(cfEntityType, entityId);
      const vals: Record<string, unknown> = {};
      (valRes.data || []).forEach((v: CustomFieldValue) => { vals[v.field_id] = v.value; });
      setDetailCustomValues(vals);
    } catch {
      setDetailEntityId(null);
      setDetailEntityType(null);
    }
    setDetailLoading(false);
  };

  const loadTaskLogs = async () => {
    if (!task) return;
    setTaskLogsLoading(true);
    try {
      const r = await logsApi.list({ target_type: 'project_task', target_id: task.id, limit: 100 });
      setTaskLogs((r.data as any).items || r.data || []);
    } catch { setTaskLogs([]); }
    setTaskLogsLoading(false);
  };

  useEffect(() => {
    if (tab === 'logs' && task) loadTaskLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, task]);

  return (
    <Modal open={open} title={task ? '编辑任务' : '新建任务'} onClose={onClose} width="full">
      <div className="h-[50vh] flex flex-col">
        {/* === 核心信息区 === */}
        <div className="shrink-0 mb-3">
          <div className="grid grid-cols-6 gap-3">
            <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
              <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">编号</div>
              <div className="text-sm text-[var(--ui-text-primary)] font-medium font-mono py-1">{task?.code || '—'}</div>
            </div>
            <div className="col-span-2 bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">名称 <span className="text-red-500">*</span></label>
              <Input size="xs" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">类型</label>
              <Select size="xs" value={form.task_type} onChange={(e) => setForm({ ...form, task_type: e.target.value as TaskType })}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>
            <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">状态</label>
              <Badge status={form.status} domain="task" />
            </div>
            <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-[var(--ui-text-secondary)] mb-0.5">优先级</label>
              <Select size="xs" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            </div>
          </div>
        </div>

        {/* === TAB 区（编辑模式：显示 TAB，新建模式：直接显示表单） === */}
        {task ? (
          <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-hidden flex-1 min-h-0 flex flex-col">
            <div className="flex border-b border-[var(--ui-border)] shrink-0">
              {([['info', '基本信息'], ['links', '关联对象'], ['comments', '评论'], ['logs', '操作记录']] as [typeof tab, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    tab === key ? 'border-primary-600 text-primary-600' : 'border-transparent text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {tab === 'info' && (
                <div className="space-y-4">
                  {/* 负责人 */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">负责人</h4>
                    <div className="w-64">
                      <Select size="xs" value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}>
                        <option value="">未指派</option>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.real_name}</option>)}
                      </Select>
                    </div>
                  </div>

                  {/* 计划周期（四列卡片栅格） */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">计划周期</h4>
                    <div className="grid grid-cols-4 gap-3">
                      <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                        <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">
                          计划开始{hasChildren && <span className="text-primary-600 ml-1">（子任务汇总）</span>}
                        </div>
                        <Input size="xs" type="date" value={form.planned_start}
                               onChange={(e) => setForm({ ...form, planned_start: e.target.value })}
                               disabled={hasChildren}
                               title={hasChildren ? '有子任务，计划周期由子任务统计而来，不可手动修改' : undefined}
                               className="disabled:cursor-not-allowed disabled:text-[var(--ui-text-tertiary)]" />
                      </div>
                      <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                        <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">
                          计划完成{hasChildren && <span className="text-primary-600 ml-1">（子任务汇总）</span>}
                        </div>
                        <Input size="xs" type="date" value={form.planned_end}
                               onChange={(e) => setForm({ ...form, planned_end: e.target.value })}
                               disabled={hasChildren}
                               title={hasChildren ? '有子任务，计划周期由子任务统计而来，不可手动修改' : undefined}
                               className="disabled:cursor-not-allowed disabled:text-[var(--ui-text-tertiary)]" />
                      </div>
                      <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                        <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">实际开始</div>
                        <div className="text-sm text-[var(--ui-text-tertiary)] py-1">{form.actual_start || '—'}</div>
                      </div>
                      <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                        <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">实际完成</div>
                        <div className="text-sm text-[var(--ui-text-tertiary)] py-1">{form.actual_end || '—'}</div>
                      </div>
                    </div>
                  </div>

                  {/* 描述 */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">描述</h4>
                    <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                              className="resize-none"
                              rows={3} placeholder="可选" />
                  </div>

                  {/* 任务依赖 */}
                  {task?.id && (
                    <div>
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <h4 className="text-sm font-semibold text-gray-700">任务依赖</h4>
                        {canEditDeps && (
                          <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
                            <Select size="xs" value={depForm.role}
                              onChange={(e) => setDepForm({ ...depForm, role: e.target.value as 'pred' | 'succ' })}>
                              <option value="pred">本任务为前置 →</option>
                              <option value="succ">本任务为后置 ←</option>
                            </Select>
                            <div className="relative" ref={taskDropRef}>
                              <Input
                                size="xs"
                                type="text"
                                className="!w-48"
                                placeholder="搜索任务…"
                                value={depForm.other
                                  ? (allTasks.find(t => t.id === depForm.other)
                                      ? `${allTasks.find(t => t.id === depForm.other)!.code} ${allTasks.find(t => t.id === depForm.other)!.name}`
                                      : depTaskSearch)
                                  : depTaskSearch}
                                onChange={(e) => {
                                  setDepTaskSearch(e.target.value);
                                  setDepForm({ ...depForm, other: '' });
                                  setTaskDropOpen(true);
                                }}
                                onFocus={() => setTaskDropOpen(true)}
                              />
                              {taskDropOpen && (
                                <div className="absolute z-50 mt-1 w-72 bg-[var(--ui-bg-surface)] border border-[var(--ui-border)] rounded shadow-lg max-h-48 overflow-y-auto">
                                  {allTasks
                                    .filter(t => {
                                      const q = depTaskSearch.toLowerCase();
                                      return !q || t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q);
                                    })
                                    .map(t => (
                                      <div
                                        key={t.id}
                                        className="px-3 py-1.5 text-sm cursor-pointer hover:bg-primary-50 hover:text-primary-700"
                                        onMouseDown={() => {
                                          setDepForm({ ...depForm, other: t.id });
                                          setDepTaskSearch('');
                                          setTaskDropOpen(false);
                                        }}
                                      >
                                        <span className="font-mono text-xs text-[var(--ui-text-secondary)] mr-1">{t.code}</span>{t.name}
                                      </div>
                                    ))}
                                  {allTasks.filter(t => {
                                    const q = depTaskSearch.toLowerCase();
                                    return !q || t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q);
                                  }).length === 0 && (
                                    <div className="px-3 py-2 text-sm text-[var(--ui-text-tertiary)]">无匹配任务</div>
                                  )}
                                </div>
                              )}
                            </div>
                            <Select size="xs" value={depForm.type}
                              onChange={(e) => setDepForm({ ...depForm, type: e.target.value as DepType })}>
                              {(['FS', 'SS', 'FF', 'SF'] as DepType[]).map((t) => <option key={t} value={t}>{t}</option>)}
                            </Select>
                            <Input size="xs" type="number" className="!w-20" placeholder="lag" value={depForm.lag}
                              onChange={(e) => setDepForm({ ...depForm, lag: Number(e.target.value) })} />
                            <Button size="sm"
                              disabled={!depForm.other}
                              onClick={async () => {
                                const pred = depForm.role === 'pred' ? task.id : depForm.other;
                                const succ = depForm.role === 'pred' ? depForm.other : task.id;
                                try {
                                  await projectApi.addDep(projectId, { predecessor_id: pred, successor_id: succ, dep_type: depForm.type, lag_days: depForm.lag });
                                  setDepForm({ ...depForm, other: '', lag: 0 });
                                  setDepTaskSearch('');
                                  loadDeps();
                                } catch (err: any) {
                                  toast.error(err?.response?.data?.detail || '添加依赖失败');
                                }
                              }}>添加依赖</Button>
                          </div>
                        )}
                      </div>
                      <ul className="space-y-1 mb-2">
                        {deps.map((d) => {
                          const isPred = d.predecessor_id === task.id;
                          const otherId = isPred ? d.successor_id : d.predecessor_id;
                          const other = allTasks.find((t) => t.id === otherId);
                          return (
                            <li key={d.id} className="flex items-center gap-2 text-sm">
                              <Badge size="xs" tone={d.is_violation ? 'red' : 'gray'} label={d.dep_type} />
                              <span className="text-[var(--ui-text-secondary)]">{isPred ? '后置→' : '←前置'}</span>
                              <span className="truncate">{other ? `${other.code} ${other.name}` : otherId}</span>
                              {d.lag_days ? <span className="text-[var(--ui-text-tertiary)]">lag {d.lag_days}d</span> : null}
                              {canEditDeps && (
                                <Button variant="danger" size="xs" className="ml-auto" onClick={async () => { await projectApi.removeDep(projectId, d.id); loadDeps(); }}>删除</Button>
                              )}
                            </li>
                          );
                        })}
                        {deps.length === 0 && <li className="text-xs text-[var(--ui-text-tertiary)]">暂无依赖</li>}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {tab === 'links' && (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <h4 className="text-sm font-semibold text-gray-700">关联对象</h4>
                      <div className="ml-auto flex items-center gap-2">
                        <Button size="sm" onClick={() => setShowItemPicker(true)}>关联对象</Button>
                        <Button size="sm" onClick={() => setShowECPicker(true)}>关联变更</Button>
                      </div>
                    </div>
                    {links.length > 0 ? (
                      <div className="border border-[var(--ui-border)] rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)] sticky top-0 z-10">
                            <tr>
                              <th onClick={() => toggleLinkSort('entity_type')} className="text-center px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)] w-20 whitespace-nowrap cursor-pointer select-none">类型<LinkSortArrow k="entity_type" /></th>
                              <th onClick={() => toggleLinkSort('entity_code')} className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)] w-36 whitespace-nowrap cursor-pointer select-none">件号<LinkSortArrow k="entity_code" /></th>
                              <th onClick={() => toggleLinkSort('entity_name')} className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)] cursor-pointer select-none">名称<LinkSortArrow k="entity_name" /></th>
                              <th onClick={() => toggleLinkSort('entity_version')} className="text-center px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)] w-16 whitespace-nowrap cursor-pointer select-none">版本<LinkSortArrow k="entity_version" /></th>
                              <th onClick={() => toggleLinkSort('entity_status')} className="text-center px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)] w-20 whitespace-nowrap cursor-pointer select-none">状态<LinkSortArrow k="entity_status" /></th>
                              <th className="text-right px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)] w-40">操作</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {sortedLinks.map((l) => (
                              <tr key={l.id} className="hover:bg-[var(--ui-bg-hover)] cursor-pointer"
                                  onClick={() => {
                                    if (l.entity_type === 'part' || l.entity_type === 'assembly') {
                                      setDetailEntityId(l.entity_id);
                                      setDetailEntityType(l.entity_type);
                                      setDetailData({ master_id: (l as any).entity_master_id || '' });
                                    } else {
                                      handleViewEntity(l.entity_type, l.entity_id);
                                    }
                                  }}>
                                <td className="px-3 py-2 text-center whitespace-nowrap">
                                  <Badge size="xs" tone={LINK_BADGE[l.entity_type]?.tone ?? 'gray'} label={LINK_BADGE[l.entity_type]?.label ?? l.entity_type} />
                                </td>
                                <td className="px-3 py-2 font-mono text-gray-700 whitespace-nowrap">{l.entity_code || '—'}</td>
                                <td className="px-3 py-2 text-gray-700">{l.entity_name || '—'}</td>
                                <td className="px-3 py-2 text-gray-700 text-center whitespace-nowrap">{l.entity_version || '-'}</td>
                                <td className="px-3 py-2 text-center whitespace-nowrap">
                                  {l.entity_type === 'ec' || !l.entity_status
                                    ? <span className="text-[var(--ui-text-tertiary)]">-</span>
                                    : <StatusTag status={l.entity_status} />}
                                </td>
                                <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                  {(l.entity_type === 'part' || l.entity_type === 'assembly') && (
                                    <Button
                                      type="button"
                                      size="xs"
                                      className="mr-1"
                                      disabled={l.entity_type === 'assembly' ? false : !l.has_stp}
                                      title={l.entity_type === 'assembly' ? '装配体 3D 预览' : (l.has_stp ? '3D 预览' : '生产附件无 STP 文件')}
                                      onClick={() => handleLinkPreview(l)}
                                    >3D</Button>
                                  )}
                                  {l.entity_type === 'document' && (
                                    <Button
                                      type="button"
                                      size="xs"
                                      className="mr-1"
                                      disabled={!((l.attachment_count ?? 0) > 0)}
                                      title={((l.attachment_count ?? 0) > 0) ? '预览附件' : '暂无附件'}
                                      onClick={() => handleLinkPreview(l)}
                                    >预览</Button>
                                  )}
                                  <Button variant="danger" size="xs" onClick={() => removeLink(l.id)}>移除</Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--ui-text-tertiary)] py-4">暂无关联</div>
                    )}
                  </div>
                </div>
              )}

              {tab === 'comments' && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-gray-700">评论</h4>
                  <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
                    {comments.map((c) => (
                      <div key={c.id} className="flex gap-2 text-sm">
                        <div className="w-7 h-7 rounded-full bg-primary-50 text-primary-700 flex items-center justify-center text-xs shrink-0">
                          {c.user_name?.[0] || '?'}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{c.user_name}</span>
                            <span className="text-xs text-[var(--ui-text-tertiary)]">{formatDateTime(c.created_at)}</span>
                            <div className="flex-1" />
                            <Button variant="danger" size="xs" onClick={() => removeComment(c.id)}>删除</Button>
                          </div>
                          <div className="text-gray-700 whitespace-pre-wrap">{c.content}</div>
                        </div>
                      </div>
                    ))}
                    {comments.length === 0 && <div className="text-xs text-[var(--ui-text-tertiary)] py-4">暂无评论</div>}
                  </div>
                  <div className="flex gap-2">
                    <Input value={newComment} onChange={(e) => setNewComment(e.target.value)}
                           onKeyDown={(e) => { if (e.key === 'Enter') submitComment(); }}
                           placeholder="写评论…(项目成员均可评论)"
                           className="flex-1" />
                    <Button onClick={submitComment}>发送</Button>
                  </div>
                </div>
              )}

              {tab === 'logs' && (
                <div>
                  {taskLogsLoading ? (
                    <div className="text-center text-[var(--ui-text-tertiary)] py-8">加载中...</div>
                  ) : taskLogs.length === 0 ? (
                    <div className="text-center text-[var(--ui-text-tertiary)] py-8">暂无操作记录</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-[var(--ui-bg-subtle)] border-b sticky top-0 z-10">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)] whitespace-nowrap">时间</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)] whitespace-nowrap">用户</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)] whitespace-nowrap">操作</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-[var(--ui-text-secondary)]">详情</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {taskLogs.map((l) => (
                          <tr key={l.id}>
                            <td className="px-3 py-2 text-[var(--ui-text-secondary)] whitespace-nowrap">{formatDateTime(l.created_at)}</td>
                            <td className="px-3 py-2">{l.username}</td>
                            <td className="px-3 py-2">
                              <Badge tone={logActionTone(l.action)} label={l.action} />
                            </td>
                            <td className="px-3 py-2 text-[var(--ui-text-secondary)]">{l.detail || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
            {/* 负责人 */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">负责人</h4>
              <div className="w-64">
                <Select size="xs" value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}>
                  <option value="">未指派</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.real_name}</option>)}
                </Select>
              </div>
            </div>

            {/* 计划周期（四列卡片栅格） */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">计划周期</h4>
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                  <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">
                    计划开始{hasChildren && <span className="text-primary-600 ml-1">（子任务汇总）</span>}
                  </div>
                  <Input size="xs" type="date" value={form.planned_start} onChange={(e) => setForm({ ...form, planned_start: e.target.value })}
                         disabled={hasChildren}
                         title={hasChildren ? '有子任务，计划周期由子任务统计而来，不可手动修改' : undefined}
                         className="disabled:cursor-not-allowed disabled:text-[var(--ui-text-tertiary)]" />
                </div>
                <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                  <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">
                    计划完成{hasChildren && <span className="text-primary-600 ml-1">（子任务汇总）</span>}
                  </div>
                  <Input size="xs" type="date" value={form.planned_end} onChange={(e) => setForm({ ...form, planned_end: e.target.value })}
                         disabled={hasChildren}
                         title={hasChildren ? '有子任务，计划周期由子任务统计而来，不可手动修改' : undefined}
                         className="disabled:cursor-not-allowed disabled:text-[var(--ui-text-tertiary)]" />
                </div>
                <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                  <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">实际开始</div>
                  <div className="text-sm text-[var(--ui-text-tertiary)] py-1">—</div>
                </div>
                <div className="bg-[var(--ui-bg-subtle)] rounded-lg px-3 py-2 border border-gray-100">
                  <div className="text-xs text-[var(--ui-text-secondary)] mb-0.5">实际完成</div>
                  <div className="text-sm text-[var(--ui-text-tertiary)] py-1">—</div>
                </div>
              </div>
            </div>

            {/* 描述 */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">描述</h4>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                        className="resize-none"
                        rows={3} placeholder="可选" />
            </div>
          </div>
        )}

        {/* === 底部操作栏 === */}
        <div className="flex justify-between gap-2 border-t pt-3 mt-3 shrink-0">
          <div className="flex gap-2">
            {task && form.status === '未开始' && (
              <Button onClick={() => handleStatusAction('进行中')} disabled={statusSaving}>
                {statusSaving ? '...' : '▶ 开始任务'}
              </Button>
            )}
            {task && form.status === '进行中' && (
              <>
                <Button variant="dark" onClick={() => handleStatusAction('挂起')} disabled={statusSaving}>
                  {statusSaving ? '...' : '⏸ 暂停任务'}
                </Button>
                <Button variant="success" onClick={() => handleStatusAction('已完成')} disabled={statusSaving}>
                  {statusSaving ? '...' : '✓ 完成任务'}
                </Button>
              </>
            )}
            {task && form.status === '挂起' && (
              <Button onClick={() => handleStatusAction('进行中')} disabled={statusSaving}>
                {statusSaving ? '...' : '▶ 恢复任务'}
              </Button>
            )}
            {task && form.status === '已完成' && (
              <Button variant="dark" onClick={() => handleStatusAction('进行中')} disabled={statusSaving}>
                {statusSaving ? '...' : '↩ 退回'}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>取消</Button>
            <Button onClick={handleSave}>保存</Button>
          </div>
        </div>
      </div>

      {/* ===== 所有子 Modal 保持不变 ===== */}
      {detailEntityId && detailEntityType === 'config_item' && (
        <ConfigItemDetailModal
          open
          revisionId={detailEntityId}
          onClose={() => { setDetailEntityId(null); setDetailEntityType(null); }}
        />
      )}

      {ecView?.kind === 'ecr' && (
        <ECRDetailModal open ecrId={ecView.id} onClose={() => setEcView(null)} onSuccess={() => {}} />
      )}
      {ecView?.kind === 'eco' && (
        <ECODetailModal ecoId={ecView.id} onClose={() => setEcView(null)} onRefresh={() => {}} />
      )}

      {detailEntityId && (detailEntityType === 'part' || detailEntityType === 'assembly') && (
        <PartDetailModal
          masterId={detailData?.master_id || ''}
          revisionId={detailEntityId}
          open={!!detailEntityId}
          onClose={() => { setDetailEntityId(null); setDetailEntityType(null); setDetailData(null); }}
        />
      )}
      {detailDocId && (
        <DocumentDetailModal
          open={!!detailDocId}
          revisionId={detailDocId}
          onClose={() => setDetailDocId(null)}
          onSaved={() => {}}
        />
      )}

      {archivePreview && (
        <ArchiveTreeModal
          open={!!archivePreview}
          onClose={() => setArchivePreview(null)}
          attachmentId={archivePreview.attId}
          fileName={archivePreview.fileName}
        />
      )}

      {showItemPicker && (
        <ItemPicker
          open={showItemPicker}
          onClose={() => setShowItemPicker(false)}
          existingIds={new Set(links.map((l) => l.entity_id))}
          onConfirm={(items) => {
            addLinks(items.map((it) => ({
              entity_type: it.entity_type === 'component'
                ? (it.sub === 'assembly' ? 'assembly' : 'part')
                : it.entity_type === 'configuration' ? 'config_item' : it.entity_type,
              entity_id: it.entity_id,
            })));
            setShowItemPicker(false);
          }}
        />
      )}
      <ECPicker open={showECPicker} onClose={() => setShowECPicker(false)} onConfirm={(items) => addLinks(items)} />
    </Modal>
  );
}

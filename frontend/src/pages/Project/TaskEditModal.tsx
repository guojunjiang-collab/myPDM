import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { projectApi } from '../../services/projectApi';
import { usersApi, partsApi, documentsApi, ecrApi, ecoApi, logsApi, customFieldsApi } from '../../services/api';
import { useDataStore } from '../../stores/data';
import type { CustomFieldDefinition, CustomFieldValue } from '../../types';
import AssemblyPartPicker from '../../components/AssemblyPartPicker';
import DocumentPicker from '../../components/DocumentPicker';
import ConfigItemPicker from '../../components/Configuration/ConfigItemPicker';
import ECPicker from '../../components/ECPicker';
import PartDetailModal from '../../components/PartDetailModal';
import DocumentDetailModal from '../../components/DocumentDetailModal';
import ConfigurationDetailModal from '../../components/Configuration/ConfigurationDetailModal';
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
  onSaved: () => void;
  /** 刷新父级数据但不关闭弹窗（状态动作按钮用）。当前弹窗暂未使用，接受以兼容新版 Projects 调用。 */
  onRefresh?: () => void;
}

const TYPES: TaskType[] = ['任务', '里程碑', '评审'];
const STATUSES: TaskStatus[] = ['未开始', '进行中', '已完成', '挂起'];
const PRIORITIES: TaskPriority[] = ['高', '中', '低'];
const STATUS_CLASS: Record<string, string> = {
  未开始: 'bg-gray-100 text-gray-600',
  进行中: 'bg-blue-50 text-blue-700',
  已完成: 'bg-green-50 text-green-700',
  挂起: 'bg-amber-50 text-amber-700',
};
const LINK_LABEL: Record<string, string> = {
  part: '零部件', assembly: '零部件', component: '零部件', config_item: '构型项', ec: 'EC', document: '图文档',
};
const LINK_COLOR: Record<string, string> = {
  part: 'bg-primary-50 text-primary-700',
  assembly: 'bg-primary-50 text-primary-700',
  component: 'bg-primary-50 text-primary-700',
  config_item: 'bg-teal-50 text-teal-700',
  ec: 'bg-amber-50 text-amber-700',
  document: 'bg-blue-50 text-blue-700',
};

export default function TaskEditModal({ open, projectId, task, parentId, onClose, onSaved, onRefresh }: Props) {
  const empty = { name: '', task_type: '任务' as TaskType, assignee_id: '', status: '未开始' as TaskStatus,
    priority: '中' as TaskPriority, planned_start: '', planned_end: '', actual_start: '', actual_end: '', description: '' };
  const [form, setForm] = useState(empty);
  const [statusSaving, setStatusSaving] = useState(false);
  const [tab, setTab] = useState<'info' | 'links' | 'comments' | 'logs'>('info');
  const [taskLogs, setTaskLogs] = useState<OperationLog[]>([]);
  const [taskLogsLoading, setTaskLogsLoading] = useState(false);
  const [users, setUsers] = useState<{ id: string; real_name: string }[]>([]);
  const [links, setLinks] = useState<TaskLink[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [showPartPicker, setShowPartPicker] = useState(false);
  const [showDocPicker, setShowDocPicker] = useState(false);
  const [showECPicker, setShowECPicker] = useState(false);
  const [showConfigPicker, setShowConfigPicker] = useState(false);
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
    usersApi.list().then((r) => setUsers(r.data.items || r.data)).catch(() => setUsers([]));
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
    // 未填日期发送 null 而非空字符串,避免后端日期校验失败
    if (payload.planned_start === '') payload.planned_start = null;
    if (payload.planned_end === '') payload.planned_end = null;
    if (payload.actual_start === '') payload.actual_start = null;
    if (payload.actual_end === '') payload.actual_end = null;
    try {
      if (task) await projectApi.updateTask(projectId, task.id, payload);
      else await projectApi.createTask(projectId, payload);
      onSaved();
    } catch (err: any) {
      alert(err?.response?.data?.detail || '保存失败');
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
      onRefresh?.();
    } catch (err: any) {
      alert(err?.response?.data?.detail || '操作失败');
    } finally {
      setStatusSaving(false);
    }
  };

  const ensureTaskId = (): string | null => {
    if (!task) { alert('请先保存任务,再添加关联对象/评论'); return null; }
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
          alert('无法打开该变更单(ECR/ECO 不存在或无权限)');
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
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <div className="text-xs text-gray-500 mb-0.5">编号</div>
              <div className="text-sm text-gray-900 font-medium font-mono py-1">{task?.code || '—'}</div>
            </div>
            <div className="col-span-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">名称 <span className="text-red-500">*</span></label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                     className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">类型</label>
              <select value={form.task_type} onChange={(e) => setForm({ ...form, task_type: e.target.value as TaskType })}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">状态</label>
              <span className={`inline-block px-2 py-1 text-xs rounded-full ${STATUS_CLASS[form.status]}`}>{form.status}</span>
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">优先级</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* === TAB 区（编辑模式：显示 TAB，新建模式：直接显示表单） === */}
        {task ? (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex-1 min-h-0 flex flex-col">
            <div className="flex border-b border-gray-200 shrink-0">
              {([['info', '基本信息'], ['links', '关联对象'], ['comments', '评论'], ['logs', '操作记录']] as [typeof tab, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    tab === key ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
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
                      <select value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}
                              className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                        <option value="">未指派</option>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.real_name}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* 计划周期（四列卡片栅格） */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">计划周期</h4>
                    <div className="grid grid-cols-4 gap-3">
                      <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                        <div className="text-xs text-gray-500 mb-0.5">计划开始</div>
                        <input type="date" value={form.planned_start} onChange={(e) => setForm({ ...form, planned_start: e.target.value })}
                               className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" />
                      </div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                        <div className="text-xs text-gray-500 mb-0.5">计划完成</div>
                        <input type="date" value={form.planned_end} onChange={(e) => setForm({ ...form, planned_end: e.target.value })}
                               className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" />
                      </div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                        <div className="text-xs text-gray-500 mb-0.5">实际开始</div>
                        <div className="text-sm text-gray-400 py-1">{form.actual_start || '—'}</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                        <div className="text-xs text-gray-500 mb-0.5">实际完成</div>
                        <div className="text-sm text-gray-400 py-1">{form.actual_end || '—'}</div>
                      </div>
                    </div>
                  </div>

                  {/* 描述 */}
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">描述</h4>
                    <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                              className="w-full text-sm px-3 py-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                              rows={3} placeholder="可选" />
                  </div>

                  {/* 任务依赖 */}
                  {task?.id && (
                    <div>
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <h4 className="text-sm font-semibold text-gray-700">任务依赖</h4>
                        {canEditDeps && (
                          <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
                            <select className="border rounded px-2 py-1 text-sm" value={depForm.role}
                              onChange={(e) => setDepForm({ ...depForm, role: e.target.value as 'pred' | 'succ' })}>
                              <option value="pred">本任务为前置 →</option>
                              <option value="succ">本任务为后置 ←</option>
                            </select>
                            <div className="relative" ref={taskDropRef}>
                              <input
                                type="text"
                                className="border rounded px-2 py-1 text-sm w-48"
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
                                <div className="absolute z-50 mt-1 w-72 bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto">
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
                                        <span className="font-mono text-xs text-gray-500 mr-1">{t.code}</span>{t.name}
                                      </div>
                                    ))}
                                  {allTasks.filter(t => {
                                    const q = depTaskSearch.toLowerCase();
                                    return !q || t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q);
                                  }).length === 0 && (
                                    <div className="px-3 py-2 text-sm text-gray-400">无匹配任务</div>
                                  )}
                                </div>
                              )}
                            </div>
                            <select className="border rounded px-2 py-1 text-sm" value={depForm.type}
                              onChange={(e) => setDepForm({ ...depForm, type: e.target.value as DepType })}>
                              {(['FS', 'SS', 'FF', 'SF'] as DepType[]).map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <input type="number" className="border rounded px-2 py-1 text-sm w-20" placeholder="lag" value={depForm.lag}
                              onChange={(e) => setDepForm({ ...depForm, lag: Number(e.target.value) })} />
                            <button className="px-2 py-1 text-sm bg-primary-600 text-white rounded"
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
                                  alert(err?.response?.data?.detail || '添加依赖失败');
                                }
                              }}>添加依赖</button>
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
                              <span className={`px-1.5 py-0.5 rounded text-xs ${d.is_violation ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'}`}>{d.dep_type}</span>
                              <span className="text-gray-500">{isPred ? '后置→' : '←前置'}</span>
                              <span className="truncate">{other ? `${other.code} ${other.name}` : otherId}</span>
                              {d.lag_days ? <span className="text-gray-400">lag {d.lag_days}d</span> : null}
                              {canEditDeps && (
                                <button className="ml-auto text-xs text-red-500" onClick={async () => { await projectApi.removeDep(projectId, d.id); loadDeps(); }}>删除</button>
                              )}
                            </li>
                          );
                        })}
                        {deps.length === 0 && <li className="text-xs text-gray-400">暂无依赖</li>}
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
                        <button onClick={() => setShowPartPicker(true)} className="text-xs px-2 py-1 rounded bg-primary-50 text-primary-700 hover:bg-primary-100">零部件 +</button>
                        <button onClick={() => setShowConfigPicker(true)} className="text-xs px-2 py-1 rounded bg-teal-50 text-teal-700 hover:bg-teal-100">构型项 +</button>
                        <button onClick={() => setShowECPicker(true)} className="text-xs px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100">EC +</button>
                        <button onClick={() => setShowDocPicker(true)} className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100">图文档 +</button>
                      </div>
                    </div>
                    {links.length > 0 ? (
                      <div className="border border-gray-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                            <tr>
                              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 w-20 whitespace-nowrap">类型</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 w-36 whitespace-nowrap">件号</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">名称</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">规格/备注</th>
                              <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 w-12">操作</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {links.map((l) => (
                              <tr key={l.id} className="hover:bg-gray-50 cursor-pointer"
                                  onClick={() => {
                                    if (l.entity_type === 'part' || l.entity_type === 'assembly') {
                                      setDetailEntityId(l.entity_id);
                                      setDetailEntityType(l.entity_type);
                                      setDetailData({ master_id: (l as any).entity_master_id || '' });
                                    } else {
                                      handleViewEntity(l.entity_type, l.entity_id);
                                    }
                                  }}>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <span className={`text-xs px-1.5 py-0.5 rounded ${LINK_COLOR[l.entity_type] ?? 'bg-gray-100 text-gray-600'}`}>{LINK_LABEL[l.entity_type]}</span>
                                </td>
                                <td className="px-3 py-2 font-mono text-gray-700 whitespace-nowrap">{l.entity_code || '—'}</td>
                                <td className="px-3 py-2 text-gray-700">{l.entity_name || '—'}</td>
                                <td className="px-3 py-2 text-gray-500">{l.entity_spec || l.entity_remark || '—'}</td>
                                <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                                  <button onClick={() => removeLink(l.id)} className="text-gray-400 hover:text-red-600 text-sm">×</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400 py-4">暂无关联</div>
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
                            <span className="text-xs text-gray-400">{formatDateTime(c.created_at)}</span>
                            <div className="flex-1" />
                            <button onClick={() => removeComment(c.id)} className="text-xs text-gray-400 hover:text-red-600">删除</button>
                          </div>
                          <div className="text-gray-700 whitespace-pre-wrap">{c.content}</div>
                        </div>
                      </div>
                    ))}
                    {comments.length === 0 && <div className="text-xs text-gray-400 py-4">暂无评论</div>}
                  </div>
                  <div className="flex gap-2">
                    <input value={newComment} onChange={(e) => setNewComment(e.target.value)}
                           onKeyDown={(e) => { if (e.key === 'Enter') submitComment(); }}
                           placeholder="写评论…(项目成员均可评论)"
                           className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                    <button onClick={submitComment} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">发送</button>
                  </div>
                </div>
              )}

              {tab === 'logs' && (
                <div>
                  {taskLogsLoading ? (
                    <div className="text-center text-gray-400 py-8">加载中...</div>
                  ) : taskLogs.length === 0 ? (
                    <div className="text-center text-gray-400 py-8">暂无操作记录</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b sticky top-0 z-10">
                        <tr>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">时间</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">用户</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">操作</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">详情</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {taskLogs.map((l) => (
                          <tr key={l.id}>
                            <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{formatDateTime(l.created_at)}</td>
                            <td className="px-3 py-2">{l.username}</td>
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 text-xs rounded-full ${
                                l.action === '创建任务' ? 'bg-green-100 text-green-800' :
                                l.action === '删除任务' ? 'bg-red-100 text-red-800' :
                                l.action === '任务状态变更' ? 'bg-blue-100 text-blue-800' :
                                'bg-gray-100 text-gray-700'
                              }`}>{l.action}</span>
                            </td>
                            <td className="px-3 py-2 text-gray-500">{l.detail || '-'}</td>
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
                <select value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}
                        className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                  <option value="">未指派</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.real_name}</option>)}
                </select>
              </div>
            </div>

            {/* 计划周期（四列卡片栅格） */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">计划周期</h4>
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                  <div className="text-xs text-gray-500 mb-0.5">计划开始</div>
                  <input type="date" value={form.planned_start} onChange={(e) => setForm({ ...form, planned_start: e.target.value })}
                         className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                  <div className="text-xs text-gray-500 mb-0.5">计划完成</div>
                  <input type="date" value={form.planned_end} onChange={(e) => setForm({ ...form, planned_end: e.target.value })}
                         className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                  <div className="text-xs text-gray-500 mb-0.5">实际开始</div>
                  <div className="text-sm text-gray-400 py-1">—</div>
                </div>
                <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                  <div className="text-xs text-gray-500 mb-0.5">实际完成</div>
                  <div className="text-sm text-gray-400 py-1">—</div>
                </div>
              </div>
            </div>

            {/* 描述 */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">描述</h4>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                        rows={3} placeholder="可选" />
            </div>
          </div>
        )}

        {/* === 底部操作栏 === */}
        <div className="flex justify-between gap-2 border-t pt-3 mt-3 shrink-0">
          <div className="flex gap-2">
            {task && form.status === '未开始' && (
              <button onClick={() => handleStatusAction('进行中')} disabled={statusSaving}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
                {statusSaving ? '...' : '▶ 开始任务'}
              </button>
            )}
            {task && form.status === '进行中' && (
              <>
                <button onClick={() => handleStatusAction('挂起')} disabled={statusSaving}
                        className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 text-sm">
                  {statusSaving ? '...' : '⏸ 暂停任务'}
                </button>
                <button onClick={() => handleStatusAction('已完成')} disabled={statusSaving}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm">
                  {statusSaving ? '...' : '✓ 完成任务'}
                </button>
              </>
            )}
            {task && form.status === '挂起' && (
              <button onClick={() => handleStatusAction('进行中')} disabled={statusSaving}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
                {statusSaving ? '...' : '▶ 恢复任务'}
              </button>
            )}
            {task && form.status === '已完成' && (
              <button onClick={() => handleStatusAction('进行中')} disabled={statusSaving}
                      className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 text-sm">
                {statusSaving ? '...' : '↩ 退回'}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
            <button onClick={handleSave} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">保存</button>
          </div>
        </div>
      </div>

      {/* ===== 所有子 Modal 保持不变 ===== */}
      {detailEntityId && detailEntityType === 'config_item' && (
        <ConfigurationDetailModal itemId={detailEntityId} onClose={() => { setDetailEntityId(null); setDetailEntityType(null); }} />
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
          docId={detailDocId}
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

      {showPartPicker && (
        <AssemblyPartPicker
          open={showPartPicker}
          onClose={() => setShowPartPicker(false)}
          dataMode="parts"
          onConfirm={(items) => {
            addLinks(items.map((it) => ({ entity_type: 'part', entity_id: it.child_id })));
            setShowPartPicker(false);
          }}
        />
      )}
      {showDocPicker && (
        <DocumentPicker
          open={showDocPicker}
          onClose={() => setShowDocPicker(false)}
          onConfirm={(items) => {
            addLinks(items.map((it) => ({ entity_type: 'document', entity_id: it.document_id })));
            setShowDocPicker(false);
          }}
        />
      )}
      {showConfigPicker && (
        <ConfigItemPicker
          open={showConfigPicker}
          onClose={() => setShowConfigPicker(false)}
          onConfirm={(item) => {
            addLinks([{ entity_type: 'config_item', entity_id: item.id }]);
            setShowConfigPicker(false);
          }}
        />
      )}
      <ECPicker open={showECPicker} onClose={() => setShowECPicker(false)} onConfirm={(items) => addLinks(items)} />
    </Modal>
  );
}

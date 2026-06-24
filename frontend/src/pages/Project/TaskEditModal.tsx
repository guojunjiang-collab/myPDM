import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { projectApi } from '../../services/projectApi';
import { usersApi, partsApi, assembliesApi, documentsApi } from '../../services/api';
import AssemblyPartPicker from '../../components/AssemblyPartPicker';
import DocumentPicker from '../../components/DocumentPicker';
import ConfigItemPicker from '../../components/Configuration/ConfigItemPicker';
import ECPicker from '../../components/ECPicker';
import PartDetailContent from '../../components/PartDetailContent';
import AssemblyDetailContent from '../../components/AssemblyDetailContent';
import DocumentDetailContent from '../../components/DocumentDetailContent';
import ConfigurationDetailModal from '../../components/Configuration/ConfigurationDetailModal';
import type { ProjectTask, TaskType, TaskStatus, TaskPriority, TaskLink, TaskComment } from '../../types/project';

interface Props {
  open: boolean;
  projectId: string;
  task: ProjectTask | null;
  parentId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const TYPES: TaskType[] = ['任务', '里程碑', '评审'];
const STATUSES: TaskStatus[] = ['未开始', '进行中', '已完成', '挂起'];
const PRIORITIES: TaskPriority[] = ['高', '中', '低'];
const LINK_LABEL: Record<string, string> = {
  part: '零件', assembly: '部件', config_item: '构型项', ec: 'EC', document: '图文档',
};

export default function TaskEditModal({ open, projectId, task, parentId, onClose, onSaved }: Props) {
  const empty = { name: '', task_type: '任务' as TaskType, assignee_id: '', status: '未开始' as TaskStatus,
    priority: '中' as TaskPriority, planned_start: '', planned_end: '', description: '' };
  const [form, setForm] = useState(empty);
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

  useEffect(() => {
    if (!open) return;
    usersApi.list().then((r) => setUsers(r.data.items || r.data)).catch(() => setUsers([]));
    if (task) {
      setForm({
        name: task.name, task_type: task.task_type, assignee_id: task.assignee_id || '',
        status: task.status, priority: task.priority,
        planned_start: task.planned_start || '', planned_end: task.planned_end || '',
        description: task.description || '',
      });
      loadLinks(task.id);
      loadComments(task.id);
    } else {
      setForm(empty);
      setLinks([]); setComments([]);
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
    if (task) await projectApi.updateTask(projectId, task.id, payload);
    else await projectApi.createTask(projectId, payload);
    onSaved();
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
    setDetailEntityId(entityId);
    setDetailEntityType(entityType);
    setDetailData(null);
    if (entityType === 'config_item' || entityType === 'ec') return;
    setDetailLoading(true);
    try {
      let res;
      if (entityType === 'part') res = await partsApi.get(entityId);
      else if (entityType === 'assembly') res = await assembliesApi.get(entityId);
      else if (entityType === 'document') res = await documentsApi.get(entityId);
      if (res) setDetailData(res.data);
    } catch {
      setDetailEntityId(null);
      setDetailEntityType(null);
    }
    setDetailLoading(false);
  };

  return (
    <Modal open={open} title={task ? `编辑任务 · ${task.name}` : '新建任务'} onClose={onClose} width="3xl">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="block text-sm text-gray-600 mb-1">任务名称 *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                   className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">类型</label>
            <select value={form.task_type} onChange={(e) => setForm({ ...form, task_type: e.target.value as TaskType })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">负责人</label>
            <select value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              <option value="">未指派</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.real_name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">状态</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">优先级</label>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">计划开始</label>
            <input type="date" value={form.planned_start} onChange={(e) => setForm({ ...form, planned_start: e.target.value })}
                   className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">计划完成</label>
            <input type="date" value={form.planned_end} onChange={(e) => setForm({ ...form, planned_end: e.target.value })}
                   className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">描述</label>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg" rows={2} />
        </div>

        <div className="border-t pt-3">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-sm text-gray-600">关联对象</span>
            <button onClick={() => setShowPartPicker(true)} className="text-xs px-2 py-1 rounded bg-primary-50 text-primary-700">零部件 +</button>
            <button onClick={() => setShowConfigPicker(true)} className="text-xs px-2 py-1 rounded bg-teal-50 text-teal-700">构型项 +</button>
            <button onClick={() => setShowECPicker(true)} className="text-xs px-2 py-1 rounded bg-amber-50 text-amber-700">EC +</button>
            <button onClick={() => setShowDocPicker(true)} className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700">图文档 +</button>
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
                        onClick={() => handleViewEntity(l.entity_type, l.entity_id)}>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{LINK_LABEL[l.entity_type]}</span>
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
            <div className="text-xs text-gray-400">暂无关联</div>
          )}
        </div>

        <div className="border-t pt-3">
          <div className="text-sm text-gray-600 mb-1">任务附件 <span className="text-gray-400">(生产人员在此传产出)</span></div>
          <div className="text-xs text-gray-400 border border-dashed border-gray-300 rounded-lg px-3 py-3">
            接入现有附件上传组件(entity_type='project_task', entity_id=任务 id)
          </div>
        </div>

        <div className="border-t pt-3">
          <div className="text-sm text-gray-600 mb-2">评论</div>
          <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
            {comments.map((c) => (
              <div key={c.id} className="flex gap-2 text-sm">
                <div className="w-7 h-7 rounded-full bg-primary-50 text-primary-700 flex items-center justify-center text-xs shrink-0">
                  {c.user_name?.[0] || '?'}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.user_name}</span>
                    <span className="text-xs text-gray-400">{c.created_at?.slice(0, 16).replace('T', ' ')}</span>
                    <div className="flex-1" />
                    <button onClick={() => removeComment(c.id)} className="text-xs text-gray-400 hover:text-red-600">删除</button>
                  </div>
                  <div className="text-gray-700 whitespace-pre-wrap">{c.content}</div>
                </div>
              </div>
            ))}
            {comments.length === 0 && <div className="text-xs text-gray-400">暂无评论</div>}
          </div>
          <div className="flex gap-2">
            <input value={newComment} onChange={(e) => setNewComment(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') submitComment(); }}
                   placeholder="写评论…(项目成员均可评论)"
                   className="flex-1 px-3 py-2 border border-gray-300 rounded-lg" />
            <button onClick={submitComment} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">发送</button>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t pt-3">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
          <button onClick={handleSave} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">保存</button>
        </div>
      </div>

      {detailEntityId && detailEntityType === 'config_item' && (
        <ConfigurationDetailModal itemId={detailEntityId} onClose={() => { setDetailEntityId(null); setDetailEntityType(null); }} />
      )}

      {detailEntityId && (detailEntityType === 'part' || detailEntityType === 'assembly' || detailEntityType === 'document') && (
        <Modal
          open={!!detailEntityId}
          title={detailEntityType === 'part' ? '零件详情' : detailEntityType === 'assembly' ? '部件详情' : '图文档详情'}
          onClose={() => { setDetailEntityId(null); setDetailEntityType(null); setDetailData(null); }}
          width="full"
        >
          {detailLoading ? (
            <div className="flex items-center justify-center py-8 text-gray-400">加载中...</div>
          ) : detailData ? (
            detailEntityType === 'part' ? <PartDetailContent part={detailData} customFieldDefs={[]} customFieldValues={{}} /> :
            detailEntityType === 'assembly' ? <AssemblyDetailContent assembly={detailData} customFieldDefs={[]} customFieldValues={{}} /> :
            <DocumentDetailContent doc={detailData} customFieldDefs={[]} customFieldValues={{}} />
          ) : null}
        </Modal>
      )}

      {showPartPicker && (
        <AssemblyPartPicker
          open={showPartPicker}
          onClose={() => setShowPartPicker(false)}
          onConfirm={(items) => {
            addLinks(items.map((it) => ({ entity_type: it.child_type === 'part' ? 'part' : 'assembly', entity_id: it.child_id })));
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

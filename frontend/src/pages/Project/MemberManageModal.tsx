import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/Modal';
import { projectApi } from '../../services/projectApi';
import { usersApi } from '../../services/api';
import type { ProjectMember } from '../../types/project';

interface Props {
  open: boolean;
  projectId: string;
  ownerId: string;
  onClose: () => void;
  /** 保存成功后回调,供父组件刷新成员数/任务负责人等 */
  onSaved?: () => void;
}

const ROLES = ['经理', '成员'] as const;

// 暂存中的成员条目(与 ProjectMember 同形,新增成员无 id)
type Draft = { user_id: string; user_name: string; username: string; role_in_project: string };

const toDraft = (m: ProjectMember): Draft => ({
  user_id: m.user_id, user_name: m.user_name, username: m.username, role_in_project: m.role_in_project,
});

export default function MemberManageModal({ open, projectId, ownerId, onClose, onSaved }: Props) {
  const [original, setOriginal] = useState<Draft[]>([]);   // 服务端当前成员(基线)
  const [draft, setDraft] = useState<Draft[]>([]);         // 本地暂存,保存时与基线求差
  const [users, setUsers] = useState<{ id: string; real_name: string; username: string }[]>([]);
  const [pickUser, setPickUser] = useState('');
  const [pickRole, setPickRole] = useState<string>('成员');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPickUser(''); setPickRole('成员'); setSaving(false);
    projectApi.listMembers(projectId).then((r) => {
      const items = (r.data.items as ProjectMember[]).map(toDraft);
      setOriginal(items);
      setDraft(items);
    });
    usersApi.list().then((r) => setUsers(r.data.items || r.data)).catch(() => setUsers([]));
  }, [open, projectId]);

  const draftIds = useMemo(() => new Set(draft.map((m) => m.user_id)), [draft]);

  // 暂存操作:只改本地 draft,不落库
  const stageAdd = () => {
    if (!pickUser) return;
    const u = users.find((x) => x.id === pickUser);
    if (!u) return;
    setDraft([...draft, { user_id: u.id, user_name: u.real_name, username: u.username, role_in_project: pickRole }]);
    setPickUser(''); setPickRole('成员');
  };
  const stageRemove = (userId: string) => setDraft(draft.filter((m) => m.user_id !== userId));
  const stageRole = (userId: string, role: string) =>
    setDraft(draft.map((m) => (m.user_id === userId ? { ...m, role_in_project: role } : m)));

  // 与基线求差
  const diff = useMemo(() => {
    const origMap = new Map(original.map((m) => [m.user_id, m.role_in_project]));
    const draftMap = new Map(draft.map((m) => [m.user_id, m.role_in_project]));
    const toAdd = draft.filter((m) => !origMap.has(m.user_id));
    const toRemove = original.filter((m) => !draftMap.has(m.user_id));
    const toUpdate = draft.filter((m) => origMap.has(m.user_id) && origMap.get(m.user_id) !== m.role_in_project);
    return { toAdd, toRemove, toUpdate };
  }, [original, draft]);

  const dirty = diff.toAdd.length > 0 || diff.toRemove.length > 0 || diff.toUpdate.length > 0;

  const handleSave = async () => {
    if (!dirty) { onClose(); return; }
    setSaving(true);
    try {
      // 先移除,再新增,最后改角色;逐条提交(后端各接口独立)
      for (const m of diff.toRemove) await projectApi.removeMember(projectId, m.user_id);
      for (const m of diff.toAdd) await projectApi.addMember(projectId, { user_id: m.user_id, role_in_project: m.role_in_project });
      for (const m of diff.toUpdate) await projectApi.setMemberRole(projectId, m.user_id, m.role_in_project);
      onSaved?.();
      onClose();
    } catch (err: any) {
      alert(err?.response?.data?.detail || '保存失败,请重试');
      // 失败时重新拉取,避免本地与服务端不一致
      const r = await projectApi.listMembers(projectId);
      const items = (r.data.items as ProjectMember[]).map(toDraft);
      setOriginal(items); setDraft(items);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="项目成员管理" onClose={onClose} width="lg">
      <div className="flex gap-2 mb-4">
        <select value={pickUser} onChange={(e) => setPickUser(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg">
          <option value="">选择用户加入…</option>
          {users.filter((u) => !draftIds.has(u.id)).map((u) => (
            <option key={u.id} value={u.id}>{u.real_name}（{u.username}）</option>
          ))}
        </select>
        <select value={pickRole} onChange={(e) => setPickRole(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg">
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button onClick={stageAdd} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">添加</button>
      </div>

      <div className="divide-y max-h-80 overflow-y-auto">
        {draft.map((m) => {
          const isOwner = m.user_id === ownerId;
          return (
            <div key={m.user_id} className="flex items-center gap-2 py-2">
              <span className="font-medium">{m.user_name}</span>
              <span className="text-xs text-gray-400">{m.username}</span>
              {isOwner ? (
                <span className="text-xs px-2 py-0.5 rounded bg-primary-50 text-primary-700">负责人</span>
              ) : (
                <select value={m.role_in_project} onChange={(e) => stageRole(m.user_id, e.target.value)}
                        className="text-xs border border-gray-300 rounded px-1.5 py-0.5 text-gray-600">
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
              <div className="flex-1" />
              {!isOwner && (
                <button onClick={() => stageRemove(m.user_id)} className="text-red-600 text-sm hover:underline">移除</button>
              )}
            </div>
          );
        })}
        {draft.length === 0 && <div className="text-sm text-gray-400 py-4 text-center">暂无成员</div>}
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-3 mt-3">
        {dirty && <span className="text-xs text-amber-600 mr-auto">有未保存的改动</span>}
        <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
        <button onClick={handleSave} disabled={saving || !dirty}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </Modal>
  );
}

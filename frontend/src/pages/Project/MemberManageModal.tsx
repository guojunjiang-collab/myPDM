import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/Modal';
import { toast } from '../../components/Toast';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import { projectApi } from '../../services/projectApi';
import { usersApi } from '../../services/api';
import { filterUsers, type PickableUser } from '../../lib/filterUsers';
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

/** 候选行：独立角色选择 + 添加（添加后由父组件刷新候选，该行自动消失） */
function CandidateRow({ u, onAdd }: { u: PickableUser; onAdd: (u: PickableUser, role: string) => void }) {
  const [role, setRole] = useState<string>('成员');
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {/* 名称列占满剩余宽度；姓名不换行，账号空间不足时省略号截断 */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <span className="font-medium whitespace-nowrap">{u.real_name}</span>
        <span className="text-xs text-[var(--ui-text-tertiary)] whitespace-nowrap truncate min-w-0">{u.username}</span>
      </div>
      <Select size="xs" className="!w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </Select>
      <Button size="xs" onClick={() => onAdd(u, role)}>添加</Button>
    </div>
  );
}

export default function MemberManageModal({ open, projectId, ownerId, onClose, onSaved }: Props) {
  const [original, setOriginal] = useState<Draft[]>([]);   // 服务端当前成员(基线)
  const [draft, setDraft] = useState<Draft[]>([]);         // 本地暂存,保存时与基线求差
  const [users, setUsers] = useState<PickableUser[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch(''); setSaving(false);
    projectApi.listMembers(projectId).then((r) => {
      const items = (r.data.items as ProjectMember[]).map(toDraft);
      setOriginal(items);
      setDraft(items);
    });
    usersApi.list({ limit: 500 }).then((r) => setUsers(r.data.items || r.data)).catch(() => setUsers([]));
  }, [open, projectId]);

  const draftIds = useMemo(() => new Set(draft.map((m) => m.user_id)), [draft]);
  // 候选 = 全部用户 - 已加入成员，按搜索关键字过滤（姓名/账号）
  const candidates = useMemo(() => filterUsers(users, draftIds, search), [users, draftIds, search]);

  // 暂存操作:只改本地 draft,不落库
  const stageAdd = (u: PickableUser, role: string) => {
    setDraft([...draft, { user_id: u.id, user_name: u.real_name, username: u.username, role_in_project: role }]);
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
      toast.error(err?.response?.data?.detail || '保存失败,请重试');
      // 失败时重新拉取,避免本地与服务端不一致
      const r = await projectApi.listMembers(projectId);
      const items = (r.data.items as ProjectMember[]).map(toDraft);
      setOriginal(items); setDraft(items);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="项目成员管理"
      onClose={onClose}
      width="xl"
      footer={
        <div className="flex items-center justify-between gap-2 w-full">
          <span className="text-xs text-amber-600">{dirty ? '有未保存的改动' : ''}</span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>取消</Button>
            <Button onClick={handleSave} disabled={saving || !dirty}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      }
    >
      {/* 上：已选成员（固定高度滚动容器） */}
      <div className="border border-[var(--ui-border)] rounded-lg overflow-hidden">
        <div className="bg-[var(--ui-bg-subtle)] px-3 py-1.5 text-xs text-[var(--ui-text-secondary)]">
          已选成员（{draft.length}）
        </div>
        <div className="h-[168px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[var(--ui-bg-subtle)] text-[var(--ui-text-secondary)]">
                <th className="text-left font-medium text-xs px-3 py-1.5">成员</th>
                <th className="text-left font-medium text-xs px-3 py-1.5 w-28">角色</th>
                <th className="text-right font-medium text-xs px-3 py-1.5 w-20">操作</th>
              </tr>
            </thead>
            <tbody>
              {draft.map((m) => {
                const isOwner = m.user_id === ownerId;
                return (
                  <tr key={m.user_id} className="border-t border-[var(--ui-border)]">
                    <td className="px-3 py-1.5">
                      <span className="font-medium">{m.user_name}</span>
                      <span className="text-xs text-[var(--ui-text-tertiary)] ml-1.5">{m.username}</span>
                      {isOwner && <Badge size="xs" tone="blue" label="负责人" className="ml-2" />}
                    </td>
                    <td className="px-3 py-1.5">
                      {isOwner ? (
                        <span className="text-sm text-[var(--ui-text-secondary)]">—</span>
                      ) : (
                        <Select size="xs" value={m.role_in_project} onChange={(e) => stageRole(m.user_id, e.target.value)}>
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </Select>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {!isOwner && (
                        <Button variant="danger" size="xs" onClick={() => stageRemove(m.user_id)}>移除</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {draft.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-sm text-[var(--ui-text-tertiary)]">暂无成员</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 中：搜索框 */}
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索姓名或账号…" className="mt-3" />

      {/* 下：候选列表（固定高度滚动容器；空搜索=全部可选用户，输入后过滤） */}
      <div className="border border-[var(--ui-border)] rounded-lg mt-3 overflow-hidden">
        <div className="bg-[var(--ui-bg-subtle)] px-3 py-1.5 text-xs text-[var(--ui-text-secondary)] flex items-center justify-between">
          <span>{search.trim() ? `匹配结果（${candidates.length}）` : `可选用户（${candidates.length}）`}</span>
          <span className="text-[var(--ui-text-tertiary)]">已排除已加入成员</span>
        </div>
        {candidates.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-[var(--ui-text-tertiary)]">
            {search.trim() ? '无匹配用户' : '暂无可添加用户'}
          </div>
        ) : (
          <div className="h-[248px] overflow-y-auto divide-y divide-[var(--ui-border)]">
            {candidates.map((u) => <CandidateRow key={u.id} u={u} onAdd={stageAdd} />)}
          </div>
        )}
      </div>
    </Modal>
  );
}

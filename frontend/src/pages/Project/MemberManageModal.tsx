import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { projectApi } from '../../services/projectApi';
import { usersApi } from '../../services/api';
import type { ProjectMember } from '../../types/project';

interface Props {
  open: boolean;
  projectId: string;
  ownerId: string;
  onClose: () => void;
}

export default function MemberManageModal({ open, projectId, ownerId, onClose }: Props) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [users, setUsers] = useState<{ id: string; real_name: string; username: string }[]>([]);
  const [pickUser, setPickUser] = useState('');

  const load = async () => {
    const res = await projectApi.listMembers(projectId);
    setMembers(res.data.items);
  };

  useEffect(() => {
    if (!open) return;
    load();
    usersApi.list().then((r) => setUsers(r.data.items || r.data)).catch(() => setUsers([]));
  }, [open, projectId]);

  const handleAdd = async () => {
    if (!pickUser) return;
    await projectApi.addMember(projectId, { user_id: pickUser });
    setPickUser('');
    load();
  };

  const handleRemove = async (userId: string) => {
    await projectApi.removeMember(projectId, userId);
    load();
  };

  const memberIds = new Set(members.map((m) => m.user_id));

  return (
    <Modal open={open} title="项目成员管理" onClose={onClose} width="lg">
      <div className="flex gap-2 mb-4">
        <select value={pickUser} onChange={(e) => setPickUser(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg">
          <option value="">选择用户加入…</option>
          {users.filter((u) => !memberIds.has(u.id)).map((u) => (
            <option key={u.id} value={u.id}>{u.real_name}（{u.username}）</option>
          ))}
        </select>
        <button onClick={handleAdd} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">添加</button>
      </div>
      <div className="divide-y">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-2 py-2">
            <span className="font-medium">{m.user_name}</span>
            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{m.role_in_project}</span>
            <div className="flex-1" />
            {m.user_id !== ownerId && (
              <button onClick={() => handleRemove(m.user_id)} className="text-red-600 text-sm hover:underline">移除</button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

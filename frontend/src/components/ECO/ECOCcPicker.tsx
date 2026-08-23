import { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { toast } from '../Toast';
import { ecoApi, usersApi } from '../../services/api';
import Button from '../ui/Button';

interface Props { open: boolean; ecoId: string; onClose: () => void; }

export function ECOCcPicker({ open, ecoId, onClose }: Props) {
  const [users, setUsers] = useState<any[]>([]);
  const [ccUserIds, setCcUserIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [unccLoading, setUnccLoading] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedIds([]);
      setLoading(true);
      Promise.all([
        usersApi.list({ page_size: 200 }),
        ecoApi.detail(ecoId).catch(() => ({ data: { cc_users: [] } })),
      ]).then(([uResp, eResp]) => {
        setUsers((uResp.data?.items || uResp.data || []) as any[]);
        setCcUserIds(((eResp as any).data?.cc_users || []).map((c: any) => c.user_id));
      }).finally(() => setLoading(false));
    }
  }, [open, ecoId]);

  const toggle = (uid: string) => {
    if (ccUserIds.includes(uid)) return;
    setSelectedIds(p => p.includes(uid) ? p.filter(id => id !== uid) : [...p, uid]);
  };

  const handleUncc = async (uid: string) => {
    setUnccLoading(uid);
    try { await ecoApi.uncc(ecoId, uid); setCcUserIds(p => p.filter(id => id !== uid)); toast.success('已取消'); }
    catch { toast.error('失败'); }
    finally { setUnccLoading(null); }
  };

  const submit = async () => {
    if (!selectedIds.length) return;
    setSubmitting(true);
    try { await ecoApi.cc(ecoId, selectedIds); toast.success('知会成功'); onClose(); }
    catch { toast.error('失败'); }
    finally { setSubmitting(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="知会用户" width="sm">
      {loading ? <div className="py-8 text-center text-[var(--ui-text-tertiary)] text-sm">加载中...</div> : (
        <div className="max-h-64 overflow-y-auto space-y-1">
          {users.map((u: any) => {
            const alreadyCc = ccUserIds.includes(u.id);
            return (
              <label key={u.id} className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer ${alreadyCc ? 'bg-[var(--ui-bg-subtle)] text-[var(--ui-text-tertiary)]' : selectedIds.includes(u.id) ? 'bg-blue-50' : 'hover:bg-[var(--ui-bg-hover)]'}`}>
                <input type="checkbox" checked={selectedIds.includes(u.id)} disabled={alreadyCc}
                  onChange={() => toggle(u.id)} className="rounded" />
                <span className="flex-1 text-sm">{u.real_name || u.username}</span>
                <span className="text-xs text-[var(--ui-text-tertiary)]">{u.role}</span>
                {alreadyCc && <Button variant="danger" size="xs" className="ml-auto" onClick={() => handleUncc(u.id)} disabled={unccLoading === u.id}>取消</Button>}
              </label>
            );
          })}
        </div>
      )}
      <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={submit} disabled={submitting || !selectedIds.length}>知会</Button>
      </div>
    </Modal>
  );
}

import { useState, useEffect } from 'react';
import { Modal } from '../Modal';
import { toast } from '../Toast';
import { ecrApi, usersApi } from '../../services/api';

interface CcPickerApi {
  get: (id: string) => Promise<any>;
  cc: (id: string, userIds: string[]) => Promise<any>;
  uncc: (id: string, userId: string) => Promise<any>;
}

interface ECRCcPickerProps {
  open: boolean;
  ecrId: string;
  onClose: () => void;
  /** Optional: custom API for non-ECR usage (e.g., ECO) */
  api?: CcPickerApi;
}

export function ECRCcPicker({ open, ecrId, onClose, api }: ECRCcPickerProps) {
  const entityApi = api || ecrApi;
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
        entityApi.get(ecrId).catch(() => ({ data: { cc_users: [] } })),
      ]).then(([usersResp, ecrResp]) => {
        const userData = usersResp.data?.items || usersResp.data || [];
        setUsers(Array.isArray(userData) ? userData : []);
        const detail = (ecrResp as any).data || ecrResp;
        const ccs: string[] = (detail.cc_users || []).map((c: any) => c.user_id);
        setCcUserIds(ccs);
      }).finally(() => setLoading(false));
    }
  }, [open, ecrId]);

  const toggleUser = (uid: string) => {
    if (ccUserIds.includes(uid)) return;
    setSelectedIds((prev) => (prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]));
  };

  const handleUncc = async (uid: string) => {
    setUnccLoading(uid);
    try {
      await entityApi.uncc(ecrId, uid);
      setCcUserIds((prev) => prev.filter((id) => id !== uid));
      toast.success('已取消知会');
    } catch {
      toast.error('取消失败');
    } finally {
      setUnccLoading(null);
    }
  };

  const handleSubmit = async () => {
    if (selectedIds.length === 0) return;
    setSubmitting(true);
    try {
      await entityApi.cc(ecrId, selectedIds);
      toast.success('知会成功');
      onClose();
    } catch {
      toast.error('知会失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="知会用户" width="sm">
      {loading ? (
        <div className="py-8 text-center text-gray-400 text-sm">加载中...</div>
      ) : (
        <div className="max-h-64 overflow-y-auto space-y-1">
          {users.map((u: any) => {
            const alreadyCc = ccUserIds.includes(u.id);
            return (
              <label
                key={u.id}
                className={`flex items-center gap-2 px-3 py-2 rounded ${
                  alreadyCc ? 'bg-gray-50 cursor-not-allowed' : 'hover:bg-gray-50 cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(u.id) || alreadyCc}
                  onChange={() => toggleUser(u.id)}
                  disabled={alreadyCc}
                  className="rounded border-gray-300 text-primary-600 disabled:opacity-50"
                />
                <span className="text-sm">{u.real_name}</span>
                <span className="text-xs text-gray-400">({u.username})</span>
                {alreadyCc && (
                  <button
                    onClick={(e) => { e.preventDefault(); handleUncc(u.id); }}
                    disabled={unccLoading === u.id}
                    className="ml-auto text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    {unccLoading === u.id ? '...' : '取消'}
                  </button>
                )}
              </label>
            );
          })}
        </div>
      )}
      <div className="flex justify-end gap-2 mt-4 pt-3 border-t">
        <button onClick={onClose} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">
          取消
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting || selectedIds.length === 0}
          className="px-4 py-2 text-sm bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50"
        >
          {submitting ? '提交中...' : `知会 (${selectedIds.length})`}
        </button>
      </div>
    </Modal>
  );
}

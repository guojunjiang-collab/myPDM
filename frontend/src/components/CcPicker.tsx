import { useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import { toast } from './Toast';
import { ecrApi, usersApi } from '../services/api';
import Badge from './ui/Badge';
import Button from './ui/Button';
import Input from './ui/Input';
import { filterUsers } from '../lib/filterUsers';

interface CcPickerApi {
  get: (id: string) => Promise<any>;
  cc: (id: string, userIds: string[]) => Promise<any>;
  uncc: (id: string, userId: string) => Promise<any>;
}

interface CcPickerProps {
  open: boolean;
  /** 目标单据 id（ECR/ECO） */
  entityId: string;
  onClose: () => void;
  /** 可选自定义 API（如 ECO 复用），默认 ecrApi */
  api?: CcPickerApi;
}

interface CcUser {
  user_id: string;
  user_name: string;
}

/** 知会用户选择弹窗：ECR/ECO 通用（合并自 ECOCcPicker/ECRCcPicker） */
export function CcPicker({ open, entityId, onClose, api }: CcPickerProps) {
  const entityApi = api || ecrApi;
  const [users, setUsers] = useState<any[]>([]);
  const [ccUsers, setCcUsers] = useState<CcUser[]>([]);   // 已知会用户（detail.cc_users）
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [unccLoading, setUnccLoading] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedIds([]);
      setSearch('');
      setLoading(true);
      Promise.all([
        usersApi.list({ limit: 500 }),
        entityApi.get(entityId).catch(() => ({ data: { cc_users: [] } })),
      ]).then(([usersResp, detailResp]) => {
        const userData = usersResp.data?.items || usersResp.data || [];
        setUsers(Array.isArray(userData) ? userData : []);
        const detail = (detailResp as any).data || detailResp;
        setCcUsers((detail.cc_users || []).map((c: any) => ({ user_id: c.user_id, user_name: c.user_name })));
      }).finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entityId]);

  const ccUserIds = useMemo(() => new Set(ccUsers.map((c) => c.user_id)), [ccUsers]);
  // 候选 = 全部用户 - 已知会 - 本次已添加，按搜索关键字过滤（姓名/账号）；添加后该行消失
  const excludeIds = useMemo(() => new Set([...ccUserIds, ...selectedIds]), [ccUserIds, selectedIds]);
  const candidates = useMemo(() => filterUsers(users, excludeIds, search), [users, excludeIds, search]);
  // 本次勾选对应的用户对象（用于已选区展示）
  const selectedUsers = useMemo(
    () => selectedIds.map((id) => users.find((u) => u.id === id)).filter(Boolean) as any[],
    [selectedIds, users]
  );

  const addUser = (u: any) => {
    if (ccUserIds.has(u.id) || selectedIds.includes(u.id)) return;
    setSelectedIds((prev) => [...prev, u.id]);
  };
  const removeUser = (uid: string) => setSelectedIds((prev) => prev.filter((id) => id !== uid));

  const handleUncc = async (uid: string) => {
    setUnccLoading(uid);
    try {
      await entityApi.uncc(entityId, uid);
      setCcUsers((prev) => prev.filter((c) => c.user_id !== uid));
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
      await entityApi.cc(entityId, selectedIds);
      toast.success('知会成功');
      onClose();
    } catch {
      toast.error('知会失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="知会用户"
      width="xl"
      footer={
        <div className="flex items-center justify-between gap-2 w-full">
          <span className="text-xs text-[var(--ui-text-tertiary)]">添加用户后点「知会」生效</span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || selectedIds.length === 0}>
              {submitting ? '提交中…' : `知会 (${selectedIds.length})`}
            </Button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="py-8 text-center text-[var(--ui-text-tertiary)] text-sm">加载中...</div>
      ) : (
        <div>
          {/* 上：已选（已知会 + 本次勾选，固定高度滚动容器） */}
          <div className="border border-[var(--ui-border)] rounded-lg overflow-hidden">
            <div className="bg-[var(--ui-bg-subtle)] px-3 py-1.5 text-xs text-[var(--ui-text-secondary)]">
              已选（{ccUsers.length + selectedIds.length}）· 已知会 {ccUsers.length} · 待知会 {selectedIds.length}
            </div>
            <div className="h-[168px] overflow-y-auto divide-y divide-[var(--ui-border)]">
              {ccUsers.map((c) => {
                const u = users.find((x) => x.id === c.user_id);
                return (
                  <div key={c.user_id} className="flex items-center gap-2 px-3 py-2">
                    <span className="text-sm">{c.user_name}</span>
                    {u && <span className="text-xs text-[var(--ui-text-tertiary)]">({u.username})</span>}
                    <div className="flex-1" />
                    <Button
                      variant="danger"
                      size="xs"
                      onClick={() => handleUncc(c.user_id)}
                      disabled={unccLoading === c.user_id}
                    >
                      {unccLoading === c.user_id ? '…' : '取消知会'}
                    </Button>
                  </div>
                );
              })}
              {selectedUsers.map((u) => (
                <div key={u.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="text-sm">{u.real_name}</span>
                  <span className="text-xs text-[var(--ui-text-tertiary)]">({u.username})</span>
                  <Badge size="xs" tone="blue" label="本次" />
                  <div className="flex-1" />
                  <Button variant="danger" size="xs" onClick={() => removeUser(u.id)}>
                    移除
                  </Button>
                </div>
              ))}
              {ccUsers.length + selectedIds.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-[var(--ui-text-tertiary)]">暂无知会用户</div>
              )}
            </div>
          </div>

          {/* 中：搜索框 */}
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索姓名或账号…" className="mt-3" />

          {/* 下：候选列表（固定高度滚动容器；空搜索=全部可选用户，输入后过滤） */}
          <div className="border border-[var(--ui-border)] rounded-lg mt-3 overflow-hidden">
            <div className="bg-[var(--ui-bg-subtle)] px-3 py-1.5 text-xs text-[var(--ui-text-secondary)] flex items-center justify-between">
              <span>{search.trim() ? `匹配结果（${candidates.length}）` : `可选用户（${candidates.length}）`}</span>
              <span className="text-[var(--ui-text-tertiary)]">已排除已选用户</span>
            </div>
            {candidates.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-[var(--ui-text-tertiary)]">
                {search.trim() ? '无匹配用户' : '暂无可知会用户'}
              </div>
            ) : (
              <div className="h-[248px] overflow-y-auto divide-y divide-[var(--ui-border)]">
                {candidates.map((u) => (
                  <div key={u.id} className="flex items-center gap-2 px-3 py-2">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="text-sm font-medium whitespace-nowrap">{u.real_name}</span>
                      <span className="text-xs text-[var(--ui-text-tertiary)] whitespace-nowrap truncate min-w-0">({u.username})</span>
                    </div>
                    <Button size="xs" onClick={() => addUser(u)}>添加</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

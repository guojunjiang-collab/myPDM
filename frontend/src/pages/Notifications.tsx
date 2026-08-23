import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { notificationApi } from '../services/notificationApi';
import { useNotificationStore } from '../stores/notification';
import { notificationIcon, NOTIFICATION_TARGET_ROUTE } from '../lib/notification';
import { isToday } from '../lib/date';
import type { Notification } from '../types';

const MODULE_FILTERS: { key: string; label: string; targets: string[] }[] = [
  { key: 'all', label: '全部', targets: [] },
  { key: 'unread', label: '未读', targets: [] },
  { key: 'change', label: '变更', targets: ['ecr', 'eco'] },
  { key: 'config', label: '配置', targets: ['configuration_profile'] },
  { key: 'inventory', label: '库存', targets: ['inventory_document'] },
  { key: 'project', label: '项目', targets: ['project_task'] },
];

function relativeTime(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN');
}

function groupByDay(items: Notification[]): { label: string; rows: Notification[] }[] {
  const g1: Notification[] = [], g2: Notification[] = [];
  for (const n of items) {
    if (isToday(n.created_at)) g1.push(n); else g2.push(n);
  }
  const out: { label: string; rows: Notification[] }[] = [];
  if (g1.length) out.push({ label: '今天', rows: g1 });
  if (g2.length) out.push({ label: '更早', rows: g2 });
  return out;
}

export default function Notifications() {
  const [filter, setFilter] = useState('all');
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { fetchUnread, markAllRead, markRead } = useNotificationStore();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const f = MODULE_FILTERS.find((x) => x.key === filter) ?? MODULE_FILTERS[0];
      const params: any = { page: 1, page_size: 100 };
      if (filter === 'unread') params.is_read = false;
      const res = await notificationApi.list(params);
      let list = res.items;
      if (f.targets.length) list = list.filter((n) => f.targets.includes(n.target_type));
      setItems(list);
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const onRowClick = async (n: Notification) => {
    if (!n.is_read) { await markRead(n.id); setItems(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x)); }
    navigate(NOTIFICATION_TARGET_ROUTE[n.target_type] || '/');
  };

  const groups = groupByDay(items);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">通知中心</h1>
        <div className="flex gap-2">
          <button onClick={async () => { await markAllRead(); load(); }}
            className="px-3 py-1.5 text-sm bg-[var(--ui-bg-surface)] border border-gray-300 rounded-lg hover:bg-[var(--ui-bg-hover)]">全部标为已读</button>
          <button onClick={async () => { await notificationApi.clearRead(); fetchUnread(); load(); }}
            className="px-3 py-1.5 text-sm bg-[var(--ui-bg-surface)] border border-gray-300 rounded-lg hover:bg-[var(--ui-bg-hover)]">清除已读</button>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap mb-4">
        {MODULE_FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-[12.5px] border ${filter === f.key ? 'bg-primary-600 text-white border-primary-600' : 'bg-[var(--ui-bg-surface)] text-gray-700 border-gray-300'}`}>
            {f.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--ui-text-tertiary)]">加载中...</div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--ui-text-tertiary)]">暂无通知</div>
      ) : groups.map((g) => (
        <div key={g.label} className="mb-4">
          <div className="text-xs text-[var(--ui-text-tertiary)] font-semibold mb-2">{g.label}</div>
          <div className="bg-[var(--ui-bg-surface)] border border-[var(--ui-border)] rounded-lg overflow-hidden">
            {g.rows.map((n) => {
              const ic = notificationIcon(n.event_type);
              return (
                <div key={n.id} onClick={() => onRowClick(n)}
                  className={`px-3.5 py-3 border-b border-gray-50 last:border-b-0 flex gap-3 items-start cursor-pointer hover:bg-[var(--ui-bg-hover)] ${!n.is_read ? 'bg-blue-50' : ''}`}>
                  <span className="rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ background: ic.bg, width: 30, height: 30 }}>{ic.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{n.title}</div>
                    {n.body && <div className="text-[13px] text-[var(--ui-text-secondary)] mt-0.5">{n.body}</div>}
                    <div className="text-xs text-[var(--ui-text-tertiary)] mt-1">{relativeTime(n.created_at)}</div>
                  </div>
                  {!n.is_read && <span className="w-2 h-2 rounded-full bg-blue-600 mt-1.5 flex-shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

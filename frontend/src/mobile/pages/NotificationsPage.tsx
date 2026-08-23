import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { notificationApi } from '../../services/notificationApi';
import { useNotificationStore } from '../../stores/notification';
import { notificationIcon, NOTIFICATION_TARGET_ROUTE } from '../../lib/notification';
import { isToday } from '../../lib/date';
import EmptyState from '../components/EmptyState';
import Button from '../../components/ui/Button';
import { formatMeta } from '../components/formatMeta';
import type { Notification } from '../../types';

/* ================================================================
   通知中心移动页（只读为主）
   - 列表：按天分组（今天 / 更早，复用 lib/notification 的图标与
     lib/date 的 isToday 分组——与桌面 pages/Notifications.tsx 一致）
   - 点击通知：未读则先「标记已读」，再按 NOTIFICATION_TARGET_ROUTE 跳转；
     目标在移动端无对应页面时由 MobileRoot 的 * 通配回 /dashboard
   - 「全部已读」：仅已读类只读写操作（Ruling 2 允许）；「清理已读」(DELETE)
     超出只读范围，不实现
   - API 核验（对应桌面 Notifications.tsx）：
     · notificationApi.list({page:1,page_size:100}) → NotificationListResult
       （{items,total,unread}，r.data 直出）
     · notificationApi.markRead(id)      → POST /api/notifications/{id}/read
     · notificationApi.markAllRead()     → POST /api/notifications/read-all
     · 未读数经 useNotificationStore 更新（NotificationBell 同源订阅）
   ================================================================ */

function fmtDateTime(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('zh-CN');
}

/** 按天分组：今天 / 更早（与桌面 Notifications.tsx groupByDay 一致） */
function groupByDay(items: Notification[]): { label: string; rows: Notification[] }[] {
  const today: Notification[] = [];
  const earlier: Notification[] = [];
  for (const n of items) {
    if (isToday(n.created_at)) today.push(n);
    else earlier.push(n);
  }
  const out: { label: string; rows: Notification[] }[] = [];
  if (today.length) out.push({ label: '今天', rows: today });
  if (earlier.length) out.push({ label: '更早', rows: earlier });
  return out;
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { unread, markRead, markAllRead, fetchUnread } = useNotificationStore();

  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 列表加载（alive 竞态防护；加载/错误/空态互斥）
  useEffect(() => {
    let alive = true;
    setLoading(true);
    notificationApi
      .list({ page: 1, page_size: 100 })
      .then((res) => {
        if (!alive) return;
        setItems(res.items ?? []);
        setError(null);
      })
      .catch(() => {
        if (!alive) return;
        setItems([]);
        setError('加载失败，请稍后重试');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 顶栏铃铛未读数同步（NotificationBell 订阅同一 store）
  useEffect(() => {
    fetchUnread();
  }, [fetchUnread]);

  const onRowClick = async (n: Notification) => {
    if (!n.is_read) {
      try {
        await markRead(n.id);
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      } catch {
        // 已读失败不阻塞跳转，保持未读态
      }
    }
    // 按桌面 NOTIFICATION_TARGET_ROUTE 映射跳转；移动端无对应页面（如 /users）由
    // MobileRoot 的 * 通配回 /dashboard；未映射目标同样回落 /dashboard
    navigate(NOTIFICATION_TARGET_ROUTE[n.target_type] || '/dashboard');
  };

  const onMarkAllRead = async () => {
    try {
      await markAllRead();
      setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));
    } catch {
      // 失败静默，本地已读态保持原样
    }
  };

  const groups = groupByDay(items);

  return (
    <div className="flex flex-col">
      {/* 操作栏（sticky）：未读数 + 全部已读 */}
      <div className="sticky top-0 z-10 bg-gray-50 px-3 pt-2 pb-1">
        <div className="flex items-center justify-between gap-2">
          <div className="min-h-11 flex items-center text-xs text-gray-500">
            {unread > 0 ? `未读 ${unread} 条` : '全部已读'}
          </div>
          <Button
            onClick={onMarkAllRead}
            size="touch"
          >
            全部已读
          </Button>
        </div>
      </div>

      {loading && <p className="text-center text-xs text-gray-400 py-3">加载中...</p>}
      {!loading && error && <p className="text-center text-xs text-red-400 py-3">{error}</p>}
      {!loading && !error && items.length === 0 && <EmptyState text="暂无通知" />}

      {!loading && !error && items.length > 0 && (
        <div className="p-3 flex flex-col gap-3">
          {groups.map((g) => (
            <section key={g.label}>
              <div className="px-1 mb-1.5 text-xs text-gray-400 font-medium">{g.label}</div>
              <div className="flex flex-col gap-2">
                {g.rows.map((n) => {
                  const ic = notificationIcon(n.event_type);
                  return (
                    <button
                      key={n.id}
                      onClick={() => onRowClick(n)}
                      className={`text-left rounded-lg px-4 py-3 min-h-14 flex gap-3 items-start shadow-sm ${
                        n.is_read ? 'bg-white' : 'bg-blue-50'
                      }`}
                    >
                      <span
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-lg shrink-0"
                        style={{ background: ic.bg }}
                      >
                        {ic.icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-gray-900 break-all">{n.title}</span>
                        {n.body && <span className="block text-xs text-gray-500 mt-0.5 break-all">{n.body}</span>}
                        <span className="block text-xs text-gray-400 mt-1">
                          {formatMeta([['时间', fmtDateTime(n.created_at)]])}
                        </span>
                      </span>
                      {!n.is_read && <span className="w-2 h-2 rounded-full bg-blue-600 mt-2 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotificationStore } from '../stores/notification';
import type { Notification } from '../types';

const EVENT_ICON: Record<string, { icon: string; bg: string }> = {
  ecr_approved: { icon: '✅', bg: '#dcfce7' },
  eco_approved: { icon: '✅', bg: '#dcfce7' },
  profile_approved: { icon: '✅', bg: '#dcfce7' },
  inv_doc_approved: { icon: '✅', bg: '#dcfce7' },
  ecr_rejected: { icon: '↩️', bg: '#fee2e2' },
  eco_rejected: { icon: '↩️', bg: '#fee2e2' },
  profile_rejected: { icon: '↩️', bg: '#fee2e2' },
  inv_doc_rejected: { icon: '↩️', bg: '#fee2e2' },
  cc_added: { icon: '👁', bg: '#dbeafe' },
  profile_archived: { icon: '📦', bg: '#f3f4f6' },
  eco_executing: { icon: '⚙️', bg: '#e0e7ff' },
  eco_closed: { icon: '📦', bg: '#f3f4f6' },
  ecr_closed: { icon: '📦', bg: '#f3f4f6' },
  inv_doc_posted: { icon: '📥', bg: '#fef9c3' },
  task_assigned: { icon: '📋', bg: '#dbeafe' },
};

const TARGET_ROUTE: Record<string, string> = {
  ecr: '/ec', eco: '/ec', configuration_profile: '/configuration',
  inventory_document: '/inventory', project_task: '/projects',
};

function relativeTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { unread, recent, fetchRecent, markRead, markAllRead } = useNotificationStore();

  useEffect(() => {
    if (open) fetchRecent();
  }, [open, fetchRecent]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const onItemClick = async (n: Notification) => {
    if (!n.is_read) await markRead(n.id);
    setOpen(false);
    navigate(TARGET_ROUTE[n.target_type] || '/');
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className="relative text-gray-500 hover:text-blue-500" title="通知">
        <span className="text-lg">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-2 bg-red-500 text-white text-[10px] rounded-full px-1 leading-4 min-w-[16px] text-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[360px] bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden z-50">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100">
            <b className="text-sm">通知 {unread > 0 && <span className="text-red-500">{unread}</span>}</b>
            <button onClick={() => markAllRead()} className="text-xs text-blue-600 hover:text-blue-800">全部已读</button>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {recent.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">暂无通知</div>
            ) : recent.map((n) => {
              const ic = EVENT_ICON[n.event_type] || { icon: '🔔', bg: '#f3f4f6' };
              return (
                <div key={n.id} onClick={() => onItemClick(n)}
                  className={`px-3 py-2.5 border-b border-gray-50 flex gap-2.5 cursor-pointer hover:bg-gray-50 ${!n.is_read ? 'bg-blue-50' : ''}`}>
                  <span className="rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ background: ic.bg, width: 26, height: 26 }}>{ic.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate">{n.title}</div>
                    {n.body && <div className="text-xs text-gray-500 mt-0.5 truncate">{n.body}</div>}
                    <div className="text-xs text-gray-400 mt-0.5">{relativeTime(n.created_at)}</div>
                  </div>
                  {!n.is_read && <span className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-1.5 flex-shrink-0" />}
                </div>
              );
            })}
          </div>
          <div onClick={() => { setOpen(false); navigate('/notifications'); }}
            className="text-center py-2.5 text-[13px] text-blue-600 hover:bg-gray-50 cursor-pointer border-t border-gray-100">
            查看全部通知 →
          </div>
        </div>
      )}
    </div>
  );
}

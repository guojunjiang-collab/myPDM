import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ecrApi, ecoApi, partsApi, documentsApi, configurationApi, dashboardApi } from '../../services/api';
import { notificationApi } from '../../services/notificationApi';
import { useAuthStore } from '../../stores/auth';
import EmptyState from '../components/EmptyState';
import type { MyTodoItem, Notification } from '../../types';

/* ================================================================
   仪表盘移动页
   - 数据加载照搬桌面 Dashboard 的 API 调用：
     · 统计计数：桌面用 useDataStore 缓存（由列表页检出填充），移动端列表页不写
       store，故改用同源列表 API 的 total 字段实时取数（见报告 §4 偏离说明）；
     · 变更进行中：ecrApi.list/ecoApi.list status=reviewing（与桌面 index.tsx 完全一致）；
     · 待办摘要：dashboardApi.getMyTodos()（与桌面 MyTodosTile 一致）；
     · 通知摘要：notificationApi.unreadCount() + list(is_read=false)（桌面通知中心 API）。
   - 图表/复杂 tile 桌面组件不可复用 → 以纯文本/数字摘要呈现（brief 允许）。
   ================================================================ */

const TYPE_TAG: Record<string, { label: string; cls: string }> = {
  ecr: { label: 'ECR', cls: 'bg-blue-50 text-blue-800' },
  eco: { label: 'ECO', cls: 'bg-amber-50 text-amber-800' },
};
const PRIO_DOT: Record<string, string> = { urgent: '#E24B4A', high: '#EF9F27', normal: '#378ADD', low: '#888780' };

function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return '早上好';
  if (hour >= 12 && hour < 18) return '下午好';
  return '晚上好';
}

function relativeTime(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Math.floor((nowMs - t) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
}

interface StatCard {
  label: string;
  value: number;
  highlight?: boolean;
}

function Section({ title, badge, children }: { title: string; badge?: number; children: ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-3">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        {badge !== undefined && badge > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600">{badge}</span>
        )}
      </div>
      {children}
    </section>
  );
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  /* ---- 关键统计（实时取数，页面挂载时一次性加载） ---- */
  const [stats, setStats] = useState({ parts: 0, documents: 0, configItems: 0, changeOpen: 0 });
  const [statsState, setStatsState] = useState<'loading' | 'ok' | 'error'>('loading');

  /* ---- 待办摘要 ---- */
  const [todos, setTodos] = useState<MyTodoItem[]>([]);
  const [todosState, setTodosState] = useState<'loading' | 'ok' | 'error'>('loading');

  /* ---- 通知摘要 ---- */
  const [unread, setUnread] = useState(0);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [notifsState, setNotifsState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      // partsApi.list 直接返回响应体 { items, total, ... }
      partsApi.list({ page_size: 1 }),
      documentsApi.list({ page_size: 1 }),
      configurationApi.listItems({ page_size: 1 }),
      ecrApi.list({ status: 'reviewing', page_size: 1 }),
      ecoApi.list({ status: 'reviewing', page_size: 1 }),
    ]).then((rs) => {
      if (!alive) return;
      const num = (r: PromiseSettledResult<unknown>, pick: (v: any) => number) =>
        r.status === 'fulfilled' ? pick(r.value) : 0;
      setStats({
        parts: num(rs[0], (v) => v?.total ?? 0),
        documents: num(rs[1], (v) => v?.data?.total ?? 0),
        configItems: num(rs[2], (v) => v?.data?.total ?? 0),
        changeOpen: num(rs[3], (v) => v?.data?.total ?? 0) + num(rs[4], (v) => v?.data?.total ?? 0),
      });
      setStatsState(rs.every((r) => r.status === 'rejected') ? 'error' : 'ok');
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    dashboardApi
      .getMyTodos()
      .then((res) => {
        if (alive) {
          setTodos(res.data?.items ?? []);
          setTodosState('ok');
        }
      })
      .catch(() => {
        if (alive) {
          setTodos([]);
          setTodosState('error');
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      notificationApi.unreadCount(),
      notificationApi.list({ is_read: false, page_size: 5 }),
    ]).then((rs) => {
      if (!alive) return;
      setUnread(rs[0].status === 'fulfilled' ? (rs[0].value as number) : 0);
      setNotifs(rs[1].status === 'fulfilled' ? ((rs[1].value as { items: Notification[] })?.items ?? []) : []);
      setNotifsState(rs[0].status === 'rejected' && rs[1].status === 'rejected' ? 'error' : 'ok');
    });
    return () => {
      alive = false;
    };
  }, []);

  const now = Date.now();
  const statCards: StatCard[] = [
    { label: '零部件', value: stats.parts },
    { label: '图文档', value: stats.documents },
    { label: '构型项', value: stats.configItems },
    { label: '变更进行中', value: stats.changeOpen, highlight: stats.changeOpen > 0 },
  ];

  return (
    <div className="p-3 flex flex-col gap-3">
      {/* 问候语（同桌面 GreetingHeader 文案） */}
      <div className="px-1">
        <div className="text-base font-medium text-gray-900">
          {greeting(new Date().getHours())}，{user?.real_name || '同事'}
        </div>
        <div className="text-xs text-gray-400 mt-0.5">
          你有 {todos.length} 项待处理{unread > 0 ? `、${unread} 条未读通知` : ''}
        </div>
      </div>

      {/* 关键统计卡片网格 */}
      <Section title="关键统计">
        {statsState === 'loading' ? (
          <p className="text-center text-xs text-gray-400 py-3">加载中...</p>
        ) : statsState === 'error' ? (
          <p className="text-center text-xs text-red-400 py-3">统计加载失败</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {statCards.map((c) => (
              <div key={c.label} className="bg-gray-50 rounded-lg px-4 py-3 flex flex-col items-center">
                <span className={`text-xl font-medium ${c.highlight ? 'text-red-600' : 'text-gray-900'}`}>{c.value}</span>
                <span className="text-xs text-gray-500 mt-1">{c.label}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 待办摘要（桌面 MyTodosTile 数据接口） */}
      <Section title="待我处理" badge={todos.length}>
        {todosState === 'loading' ? (
          <p className="text-center text-xs text-gray-400 py-3">加载中...</p>
        ) : todosState === 'error' ? (
          <p className="text-center text-xs text-red-400 py-3">待办加载失败</p>
        ) : todos.length === 0 ? (
          <EmptyState text="✅ 暂无待办" />
        ) : (
          <div className="flex flex-col">
            {todos.slice(0, 5).map((it) => (
              <div
                key={`${it.type}:${it.id}`}
                className="flex items-center gap-2 py-2.5 border-b border-gray-50 last:border-b-0"
              >
                <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${TYPE_TAG[it.type]?.cls || 'bg-gray-100 text-gray-700'}`}>
                  {TYPE_TAG[it.type]?.label || it.type}
                </span>
                <span className={`flex-1 text-sm min-w-0 truncate ${it.kind === 'rejected' ? 'text-red-600' : 'text-gray-700'}`}>
                  {it.title}
                  {it.kind === 'rejected' ? ' · 被驳回' : ''}
                </span>
                {it.kind === 'review' && (
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: PRIO_DOT[it.priority] || '#888' }} />
                )}
                <span className="text-xs text-gray-400 shrink-0">{relativeTime(it.updated_at, now)}</span>
              </div>
            ))}
            {todos.length > 5 && <div className="text-center text-xs text-gray-400 pt-2">共 {todos.length} 项，移动端暂只展示前 5 项</div>}
          </div>
        )}
      </Section>

      {/* 通知摘要（未读通知，桌面通知中心 API） */}
      <Section title="通知" badge={unread}>
        {notifsState === 'loading' ? (
          <p className="text-center text-xs text-gray-400 py-3">加载中...</p>
        ) : notifsState === 'error' ? (
          <p className="text-center text-xs text-red-400 py-3">通知加载失败</p>
        ) : notifs.length === 0 ? (
          <EmptyState text="暂无未读通知" />
        ) : (
          <div className="flex flex-col">
            {notifs.slice(0, 3).map((n) => (
              <div key={n.id} className="flex items-center gap-2 py-2.5 border-b border-gray-50 last:border-b-0">
                <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                <span className="flex-1 text-sm text-gray-700 min-w-0 truncate">{n.title}</span>
                <span className="text-xs text-gray-400 shrink-0">{relativeTime(n.created_at, now)}</span>
              </div>
            ))}
            {notifs.length > 3 && <div className="text-center text-xs text-gray-400 pt-2">共 {unread} 条未读</div>}
          </div>
        )}
      </Section>
    </div>
  );
}

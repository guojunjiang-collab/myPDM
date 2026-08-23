import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { partsApi, documentsApi, configurationApi, dashboardApi } from '../../services/api';
import { inventoryApi } from '../../services/inventoryApi';
import { projectApi } from '../../services/projectApi';
import { notificationApi } from '../../services/notificationApi';
import { useAuthStore } from '../../stores/auth';
import Badge from '../../components/ui/Badge';
import type { BadgeTone } from '../../constants/badges';
import EmptyState from '../components/EmptyState';
import type { MyTodoItem, MyTaskItem, Notification } from '../../types';

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

const TYPE_TAG: Record<string, { label: string; tone: BadgeTone }> = {
  ecr: { label: 'ECR', tone: 'blue' },
  eco: { label: 'ECO', tone: 'amber' },
};
const PRIO_DOT: Record<string, string> = { urgent: '#E24B4A', high: '#EF9F27', normal: '#378ADD', low: '#888780' };

function fmtDate(d: string | null): string {
  if (!d) return '';
  return d.slice(0, 10);
}

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
    <section className="bg-[var(--ui-bg-surface)] rounded-xl border border-[var(--ui-border)] p-3">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        {badge !== undefined && badge > 0 && (
          <Badge tone="red" label={badge} size="xs" />
        )}
      </div>
      {children}
    </section>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  /* ---- 关键统计（实时取数，页面挂载时一次性加载） ---- */
  const [stats, setStats] = useState({ parts: 0, documents: 0, configItems: 0, stockItems: 0 });
  const [statsState, setStatsState] = useState<'loading' | 'ok' | 'error'>('loading');

  /* ---- 我的任务（桌面 MyTasksTile 数据接口） ---- */
  const [tasks, setTasks] = useState<MyTaskItem[]>([]);
  const [tasksState, setTasksState] = useState<'loading' | 'ok' | 'error'>('loading');

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
      // 有库存的物料项：库存数量 > 0 的物料（按物料去重）
      inventoryApi.listStock(),
    ]).then((rs) => {
      if (!alive) return;
      const num = (r: PromiseSettledResult<unknown>, pick: (v: any) => number) =>
        r.status === 'fulfilled' ? pick(r.value) : 0;
      setStats({
        parts: num(rs[0], (v) => v?.total ?? 0),
        documents: num(rs[1], (v) => v?.data?.total ?? 0),
        configItems: num(rs[2], (v) => v?.data?.total ?? 0),
        stockItems: num(rs[3], (v) => {
          const items = v?.data?.items ?? [];
          return new Set(items.filter((i: any) => (i.quantity ?? 0) > 0).map((i: any) => i.material_id)).size;
        }),
      });
      setStatsState(rs.every((r) => r.status === 'rejected') ? 'error' : 'ok');
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    projectApi
      .myTasks()
      .then((res) => {
        if (alive) {
          setTasks(res.data?.items ?? []);
          setTasksState('ok');
        }
      })
      .catch(() => {
        if (alive) {
          setTasks([]);
          setTasksState('error');
        }
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
    { label: '有库存物料', value: stats.stockItems },
  ];
  // 我的任务：逾期数（planned_end < 今天）
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueCount = tasks.filter((t) => t.planned_end && t.planned_end.slice(0, 10) < fmtDate(today.toISOString())).length;
  // 按项目分组（同桌面 MyTasksTile）
  const taskGroups = (() => {
    const map = new Map<string, { projectCode: string; projectName: string; tasks: MyTaskItem[] }>();
    for (const t of tasks) {
      if (!map.has(t.project_id)) {
        map.set(t.project_id, { projectCode: t.project_code, projectName: t.project_name, tasks: [] });
      }
      map.get(t.project_id)!.tasks.push(t);
    }
    for (const [, g] of map) {
      g.tasks.sort((a, b) => {
        if (!a.planned_start) return 1;
        if (!b.planned_start) return -1;
        return a.planned_start.localeCompare(b.planned_start);
      });
    }
    return Array.from(map.values());
  })();

  return (
    <div className="p-3 flex flex-col gap-3">
      {/* 问候语（同桌面 GreetingHeader 文案） */}
      <div className="px-1">
        <div className="text-base font-medium text-[var(--ui-text-primary)]">
          {greeting(new Date().getHours())}，{user?.real_name || '同事'}
        </div>
        <div className="text-xs text-[var(--ui-text-tertiary)] mt-0.5">
          你有 {todos.length} 项待处理{unread > 0 ? `、${unread} 条未读通知` : ''}
        </div>
      </div>

      {/* 关键统计卡片网格 */}
      <Section title="关键统计">
        {statsState === 'loading' ? (
          <p className="text-center text-xs text-[var(--ui-text-tertiary)] py-3">加载中...</p>
        ) : statsState === 'error' ? (
          <p className="text-center text-xs text-red-400 py-3">统计加载失败</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {statCards.map((c) => (
              <div key={c.label} className="bg-[var(--ui-bg-subtle)] rounded-lg px-4 py-3 flex flex-col items-center">
                <span className={`text-xl font-medium ${c.highlight ? 'text-red-600' : 'text-[var(--ui-text-primary)]'}`}>{c.value}</span>
                <span className="text-xs text-[var(--ui-text-secondary)] mt-1">{c.label}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 我的任务（桌面 MyTasksTile 数据接口，按项目分组） */}
      <Section title="我的任务" badge={overdueCount}>
        {tasksState === 'loading' ? (
          <p className="text-center text-xs text-[var(--ui-text-tertiary)] py-3">加载中...</p>
        ) : tasksState === 'error' ? (
          <p className="text-center text-xs text-red-400 py-3">任务加载失败</p>
        ) : tasks.length === 0 ? (
          <EmptyState text="暂无指派给你的任务" />
        ) : (
          <div className="flex flex-col gap-3">
            {taskGroups.map((g) => (
              <div key={g.projectCode} className="rounded-lg border border-gray-100 bg-[var(--ui-bg-subtle)] overflow-hidden">
                <div className="px-3 py-1.5 border-b border-[var(--ui-border)] text-sm font-medium text-[var(--ui-text-secondary)] truncate">
                  {g.projectCode} · {g.projectName}
                  <span className="text-[var(--ui-text-tertiary)] ml-1">({g.tasks.length})</span>
                </div>
                {g.tasks.map((t) => {
                  const od = !!(t.planned_end && t.planned_end.slice(0, 10) < fmtDate(today.toISOString()));
                  return (
                    <button
                      key={t.task_id}
                      type="button"
                      onClick={() => navigate(`/projects/${t.project_id}`)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${od ? 'bg-red-50/50' : ''}`}
                    >
                      <span className="shrink-0 text-xs font-mono text-[var(--ui-text-secondary)]">{t.code}</span>
                      <span className={`flex-1 min-w-0 truncate text-sm ${od ? 'text-red-700' : 'text-gray-800'}`}>
                        {t.name}
                      </span>
                      <Badge status={t.status} domain="task" />
                      <span className="shrink-0 text-xs text-[var(--ui-text-tertiary)]">
                        {fmtDate(t.planned_start)}~{fmtDate(t.planned_end)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 待办摘要（桌面 MyTodosTile 数据接口） */}
      <Section title="待我处理" badge={todos.length}>
        {todosState === 'loading' ? (
          <p className="text-center text-xs text-[var(--ui-text-tertiary)] py-3">加载中...</p>
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
                <Badge
                  tone={TYPE_TAG[it.type]?.tone ?? 'gray'}
                  label={TYPE_TAG[it.type]?.label ?? it.type}
                  size="xs"
                />
                <span className={`flex-1 text-sm min-w-0 truncate ${it.kind === 'rejected' ? 'text-red-600' : 'text-gray-700'}`}>
                  {it.title}
                  {it.kind === 'rejected' ? ' · 被驳回' : ''}
                </span>
                {it.kind === 'review' && (
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: PRIO_DOT[it.priority] || '#888' }} />
                )}
                <span className="text-xs text-[var(--ui-text-tertiary)] shrink-0">{relativeTime(it.updated_at, now)}</span>
              </div>
            ))}
            {todos.length > 5 && <div className="text-center text-xs text-[var(--ui-text-tertiary)] pt-2">共 {todos.length} 项，移动端暂只展示前 5 项</div>}
          </div>
        )}
      </Section>

      {/* 通知摘要（未读通知，桌面通知中心 API） */}
      <Section title="通知" badge={unread}>
        {notifsState === 'loading' ? (
          <p className="text-center text-xs text-[var(--ui-text-tertiary)] py-3">加载中...</p>
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
                <span className="text-xs text-[var(--ui-text-tertiary)] shrink-0">{relativeTime(n.created_at, now)}</span>
              </div>
            ))}
            {notifs.length > 3 && <div className="text-center text-xs text-[var(--ui-text-tertiary)] pt-2">共 {unread} 条未读</div>}
          </div>
        )}
      </Section>
    </div>
  );
}

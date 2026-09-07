import { useEffect, useMemo, useRef, useState } from 'react';
import { projectApi } from '../../services/projectApi';
import { useDetailOverlayPush } from '../hooks/useDetailOverlay';
import EmptyState from '../components/EmptyState';
import {
  DAY_PX, ROW_H, daysBetween, computeRange, barBox, ticks, STATUS_FILL,
} from '../../pages/Project/gantt/ganttUtils';
import type { Scale } from '../../pages/Project/gantt/ganttUtils';
import type { GanttData, GanttTask, ProjectTask } from '../../types/project';

/** 缩进步长像素值（读取 --ui-tree-indent；canvas 测量与渲染 calc() 保持一致） */
function treeIndentPx(): number {
  if (typeof document === 'undefined') return 14;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--ui-tree-indent').trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 14;
}

/* ================================================================
   移动端甘特图（只读，覆盖层）：
   - 数据/几何计算复用桌面版 ganttUtils（DAY_PX/barBox/ticks/computeRange/STATUS_FILL）
   - 布局：左列任务名固定（sticky left-0）+ 右区日期表头/甘特条横向滚动
   - 缩放：日/周/月切换；今日高亮线；进入自动滚动到今日
   - 行点击 → 打开任务详情（详情栈 push，逐级返回）
   - 只读：无拖拽编辑（编辑进任务详情）
   ================================================================ */

interface Props {
  projectId: string;
  onBack?: () => void;
  onNavigate?: (to: string) => void;
}

const SCALES: Array<{ key: Scale; label: string }> = [
  { key: 'day', label: '日' },
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
];

export default function GanttPage({ projectId, onBack }: Props) {
  const [data, setData] = useState<GanttData | null>(null);
  const [tree, setTree] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState<Scale>('week');
  const scrollRef = useRef<HTMLDivElement>(null);
  const overlayPush = useDetailOverlayPush();

  // 数据：甘特图（条/依赖/范围）+ 任务树（行点击打开详情需要完整 ProjectTask）
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([projectApi.getGantt(projectId), projectApi.listTasks(projectId)])
      .then(([g, t]) => {
        if (!alive) return;
        setData(g.data as GanttData);
        setTree(((t.data ?? {}) as { items?: ProjectTask[] }).items ?? []);
      })
      .catch(() => {
        if (alive) setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  // 进入/切换缩放时：右区自动滚动到今日附近
  useEffect(() => {
    if (!data || !scrollRef.current) return;
    const x = daysBetween(computeRange(data.tasks).start, new Date()) * DAY_PX[scale] - 60;
    if (x > 0) scrollRef.current.scrollLeft = Math.max(0, x);
  }, [data, scale]);

  // 任务树扁平映射（行点击 → 完整任务详情）
  const taskMap = useMemo(() => {
    const m: Record<string, ProjectTask> = {};
    const walk = (ts: ProjectTask[]) => {
      for (const t of ts) {
        m[t.id] = t;
        if (t.children?.length) walk(t.children);
      }
    };
    walk(tree);
    return m;
  }, [tree]);

  const openTask = (t: GanttTask) => {
    const full = taskMap[t.id];
    if (!full || !overlayPush) return;
    overlayPush.push({ kind: 'task', projectId, task: full });
  };

  const range = useMemo(() => (data ? computeRange(data.tasks) : null), [data]);
  const totalPx = range ? (daysBetween(range.start, range.end) + 1) * DAY_PX[scale] : 0;
  const todayX = range ? daysBetween(range.start, new Date()) * DAY_PX[scale] : -1;

  // 左列宽度自适应内容：canvas 精确测量文本（text-xs 12px），逐行取「层级缩进(depth*var(--ui-tree-indent)) + 文本宽」之和的最大值
  // （最长文本可能不在最深层级，不能分开取最大值），再加行内 padding(px-2=16)——分割线紧贴最靠右的编号
  const leftW = useMemo(() => {
    if (!data) return 140;
    const ctx =
      typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
    if (ctx) ctx.font = '500 12px system-ui, -apple-system, sans-serif';
    const indentPx = treeIndentPx();
    let max = 0;
    for (const t of data.tasks) {
      const codeW = ctx ? ctx.measureText(t.code).width : t.code.length * 7;
      const nameW = t.assignee_name ? (ctx ? ctx.measureText(t.assignee_name).width : t.assignee_name.length * 6) : 0;
      max = Math.max(max, t.depth * indentPx + codeW, t.depth * indentPx + nameW);
    }
    return Math.min(300, Math.max(96, Math.ceil(max) + 12));
  }, [data]);

  return (
    <div className="flex flex-col h-full">
      {/* 顶部：返回 + 标题 + 缩放切换 */}
      <div className="sticky top-0 z-20 bg-[var(--ui-bg-subtle)] px-2 pt-2 pb-1">
        <div className="flex items-center gap-1 min-h-10">
          <button
            aria-label="返回"
            onClick={() => (onBack ? onBack() : window.history.back())}
            className="shrink-0 min-w-10 h-10 flex items-center justify-center text-2xl leading-none text-[var(--ui-text-secondary)]"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1 text-base font-medium text-[var(--ui-text-primary)] truncate">甘特图</div>
          <div className="flex bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] overflow-hidden">
            {SCALES.map((s) => (
              <button
                key={s.key}
                onClick={() => setScale(s.key)}
                className={`min-h-8 px-3 text-xs ${
                  scale === s.key ? 'bg-[var(--ui-btn-primary-bg)] text-white font-medium' : 'text-[var(--ui-text-secondary)]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-center text-xs text-[var(--ui-text-tertiary)] py-3">加载中...</p>
      ) : !data ? (
        <EmptyState text="甘特图加载失败" />
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-x-auto">
          <div className="flex min-w-max">
            {/* 左列：任务编号（固定，横向滚动不跟随）；名称显示在甘特条上。
                宽度按内容自适应（leftW），右侧 border-r 竖线分割符随左列宽度自动贴合；
                z-20 高于右区全部元素（含今日线 z-10），滚动时分割线不被右区内容遮盖 */}
            <div
              className="sticky left-0 z-20 bg-[var(--ui-bg-subtle)] shrink-0 border-r border-[var(--ui-border-strong)] relative"
              style={{ width: leftW }}
            >
              {/* 与右区日期表头等高的占位，保证任务行对齐 */}
              <div style={{ height: 28 }} />
              {data.tasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => openTask(t)}
                  className="w-full text-left px-1.5 flex flex-col justify-center"
                  style={{ height: ROW_H }}
                >
                  {/* 编号：全部显示不省略（左列宽度按测量值自适应，已含保险余量） */}
                  <span
                    className="text-xs font-medium text-[var(--ui-text-primary)] whitespace-nowrap leading-tight"
                    style={{ paddingLeft: `calc(${t.depth} * var(--ui-tree-indent))` }}
                  >
                    {t.code}
                  </span>
                  {/* 行2：负责人（更小字体）；无负责人/无日期时给出提醒 */}
                  <span
                    className="text-[10px] whitespace-nowrap leading-tight"
                    style={{ paddingLeft: `calc(${t.depth} * var(--ui-tree-indent))` }}
                  >
                    {t.assignee_name ? (
                      <span className="text-[var(--ui-text-secondary)]">{t.assignee_name}</span>
                    ) : (
                      <span className="text-amber-500">未分配</span>
                    )}
                    {(!t.planned_start || !t.planned_end) && (
                      <span className="text-red-400 ml-1">无日期</span>
                    )}
                  </span>
                </button>
              ))}
              {/* 行分隔线：与右侧日历区同画法（绝对定位 border-t），像素级对齐；左列底色为 --ui-bg-subtle，用 --ui-border-strong 保证深色下可见 */}
              {data.tasks.map((t, i) => (
                <div
                  key={'lb' + t.id}
                  className="absolute left-0 right-0 border-t border-[var(--ui-border-strong)]"
                  style={{ top: 28 + i * ROW_H }}
                />
              ))}
            </div>
            {/* 右区：日期表头 + 甘特条（横向滚动） */}
            <div>
              <div className="relative" style={{ width: totalPx, height: 28 }}>
                {range &&
                  ticks(range.start, range.end, scale).map((tk, i) => (
                    <span
                      key={i}
                      className={`absolute top-1 text-[10px] text-[var(--ui-text-secondary)] ${tk.major ? 'font-medium' : ''}`}
                      style={{ left: tk.x }}
                    >
                      {tk.label}
                    </span>
                  ))}
              </div>
              <div className="relative" style={{ width: totalPx, height: data.tasks.length * ROW_H }}>
                {/* 今日高亮线 */}
                {todayX >= 0 && (
                  <div className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10" style={{ left: todayX }} />
                )}
                {/* 甘特条（条内显示任务名称） */}
                {data.tasks.map((t, i) => {
                  const bb = range ? barBox(t, range.start, scale, i) : null;
                  if (!bb) return null;
                  const barH = 20;
                  return (
                    <div
                      key={t.id}
                      className="absolute flex items-center"
                      style={{
                        left: bb.x,
                        top: i * ROW_H + (ROW_H - barH) / 2,
                        width: bb.w,
                        height: barH,
                        borderRadius: 4,
                        background: STATUS_FILL[t.status] ?? '#9ca3af',
                        opacity: t.is_critical ? 1 : 0.85,
                        ...(t.is_overdue ? { outline: '1px solid #ef4444' } : {}),
                      }}
                    >
                      {/* 名称始终显示，条内放不下时向右溢出；z-[5] 高于兄弟条背景、低于左列 sticky z-10（不盖任务编号列） */}
                      <span className="relative z-[5] shrink-0 pl-1.5 pr-1 text-[10px] leading-none text-[var(--ui-text-primary)] whitespace-nowrap">
                        {t.name}
                      </span>
                    </div>
                  );
                })}
                {/* 行分隔线（深色下 --ui-border 与底色对比过弱，与左列同用 --ui-border-strong） */}
                {data.tasks.map((t, i) => (
                  <div
                    key={'l' + t.id}
                    className="absolute left-0 right-0 border-t border-[var(--ui-border-strong)]"
                    style={{ top: i * ROW_H }}
                  />
                ))}
                {/* 整行点击层（最上层透明，点击甘特条任意处进入任务详情） */}
                {data.tasks.map((t, i) => (
                  <button
                    key={'c' + t.id}
                    type="button"
                    onClick={() => openTask(t)}
                    className="absolute left-0 right-0"
                    style={{ top: i * ROW_H, height: ROW_H }}
                    aria-label={`打开任务 ${t.code}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

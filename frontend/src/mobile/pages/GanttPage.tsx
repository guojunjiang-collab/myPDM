import { useEffect, useMemo, useRef, useState } from 'react';
import { projectApi } from '../../services/projectApi';
import { useDetailOverlayPush } from '../hooks/useDetailOverlay';
import EmptyState from '../components/EmptyState';
import {
  DAY_PX, ROW_H, daysBetween, computeRange, barBox, ticks, STATUS_FILL,
} from '../../pages/Project/gantt/ganttUtils';
import type { Scale } from '../../pages/Project/gantt/ganttUtils';
import type { GanttData, GanttTask, ProjectTask } from '../../types/project';

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

  // 左列宽度自适应内容（按最长编号/负责人估算，中文 12px/字、编号 7px/字符），
  // 右侧 border-r 竖线分割符随左列宽度自动贴合；z-20 高于右区全部元素（含今日线 z-10），滚动时分割线永不被遮盖
  const leftW = useMemo(() => {
    if (!data) return 160;
    let max = 0;
    for (const t of data.tasks) {
      const codeW = Array.from(t.code).reduce((s, ch) => s + (/[\u4e00-\u9fa5]/.test(ch) ? 12 : 7), 0) + 20;
      const nameW = (t.assignee_name ? Array.from(t.assignee_name).reduce((s, ch) => s + (/[\u4e00-\u9fa5]/.test(ch) ? 7 : 6), 0) : 16) + 20;
      max = Math.max(max, codeW, nameW);
    }
    return Math.min(220, Math.max(160, max));
  }, [data]);

  return (
    <div className="flex flex-col h-full">
      {/* 顶部：返回 + 标题 + 缩放切换 */}
      <div className="sticky top-0 z-20 bg-gray-50 px-2 pt-2 pb-1">
        <div className="flex items-center gap-1 min-h-10">
          <button
            aria-label="返回"
            onClick={() => (onBack ? onBack() : window.history.back())}
            className="shrink-0 min-w-10 h-10 flex items-center justify-center text-2xl leading-none text-gray-600"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1 text-base font-medium text-gray-900 truncate">甘特图</div>
          <div className="flex bg-white rounded-lg border border-gray-200 overflow-hidden">
            {SCALES.map((s) => (
              <button
                key={s.key}
                onClick={() => setScale(s.key)}
                className={`min-h-8 px-3 text-xs ${
                  scale === s.key ? 'bg-primary-600 text-white font-medium' : 'text-gray-500'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-center text-xs text-gray-400 py-3">加载中...</p>
      ) : !data ? (
        <EmptyState text="甘特图加载失败" />
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-x-auto">
          <div className="flex min-w-max">
            {/* 左列：任务编号（固定，横向滚动不跟随）；名称显示在甘特条上。
                宽度按内容自适应（leftW），右侧 border-r 竖线分割符随左列宽度自动贴合；
                z-20 高于右区全部元素（含今日线 z-10），滚动时分割线不被右区内容遮盖 */}
            <div
              className="sticky left-0 z-20 bg-gray-50 shrink-0 border-r border-gray-200 relative"
              style={{ width: leftW }}
            >
              {/* 与右区日期表头等高的占位，保证任务行对齐 */}
              <div style={{ height: 28 }} />
              {data.tasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => openTask(t)}
                  className="w-full text-left px-2 flex flex-col justify-center"
                  style={{ height: ROW_H }}
                >
                  <span
                    className="text-xs font-medium text-gray-900 truncate leading-tight"
                    style={{ paddingLeft: t.depth * 10 }}
                  >
                    {t.code}
                  </span>
                  {/* 行2：负责人（更小字体）；无负责人/无日期时给出提醒 */}
                  <span
                    className="text-[10px] leading-tight truncate"
                    style={{ paddingLeft: t.depth * 10 }}
                  >
                    {t.assignee_name ? (
                      <span className="text-gray-500">{t.assignee_name}</span>
                    ) : (
                      <span className="text-amber-500">未分配</span>
                    )}
                    {(!t.planned_start || !t.planned_end) && (
                      <span className="text-red-400 ml-1">无日期</span>
                    )}
                  </span>
                </button>
              ))}
              {/* 行分隔线：与右侧日历区同画法（绝对定位 border-t），像素级对齐 */}
              {data.tasks.map((t, i) => (
                <div
                  key={'lb' + t.id}
                  className="absolute left-0 right-0 border-t border-gray-100"
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
                      className={`absolute top-1 text-[10px] text-gray-500 ${tk.major ? 'font-medium' : ''}`}
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
                      <span className="relative z-[5] shrink-0 pl-1.5 pr-1 text-[10px] leading-none text-gray-900 whitespace-nowrap">
                        {t.name}
                      </span>
                    </div>
                  );
                })}
                {/* 行分隔线 */}
                {data.tasks.map((t, i) => (
                  <div
                    key={'l' + t.id}
                    className="absolute left-0 right-0 border-t border-gray-100"
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

import { useEffect, useMemo, useRef, useState } from 'react';
import { projectApi } from '../../../services/projectApi';
import type { GanttData, GanttTask } from '../../../types/project';
import type { Scale } from './ganttUtils';
import {
  DAY_PX, ROW_H, BAR_H, LEFT_W, CODE_W, ASSIGNEE_W, INDENT, parseDate, daysBetween, addDays, fmtISO,
  computeRange, barBox, ticks, STATUS_FILL, depAnchors,
} from './ganttUtils';

interface Props {
  projectId: string;
  canEdit: boolean;
  onTaskUpdated?: () => void;
  onRowClick?: (taskId: string) => void;
  refreshKey?: number;
}

export default function GanttView({ projectId, canEdit, onTaskUpdated, onRowClick, refreshKey }: Props) {
  const [data, setData] = useState<GanttData | null>(null);
  const [scale, setScale] = useState<Scale>('day');
  const [loading, setLoading] = useState(false);
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'resize-l' | 'resize-r'; startX: number; origStart: Date; origEnd: Date; isMilestone: boolean } | null>(null);
  const [preview, setPreview] = useState<Record<string, { start: string; end: string }>>({});
  const [createDrag, setCreateDrag] = useState<{ id: string; anchorDay: number; isMilestone: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportW, setViewportW] = useState(0);
  const [pan, setPan] = useState<{ startX: number; startScroll: number } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await projectApi.getGantt(projectId);
      setData(res.data);
      setPreview({});
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { if (projectId) load(); /* eslint-disable-next-line */ }, [projectId, refreshKey]);

  const range = useMemo(() => (data ? computeRange(data.tasks) : null), [data]);
  const px = DAY_PX[scale];

  const effTask = (t: GanttTask): GanttTask => {
    const p = preview[t.id];
    return p ? { ...t, planned_start: p.start, planned_end: p.end } : t;
  };

  const onMouseDown = (e: React.MouseEvent, t: GanttTask, mode: 'move' | 'resize-l' | 'resize-r') => {
    if (!canEdit) return;
    const s = parseDate(t.planned_start); const en = parseDate(t.planned_end);
    if (!s || !en) return;
    e.preventDefault();
    setDrag({ id: t.id, mode, startX: e.clientX, origStart: s, origEnd: en, isMilestone: t.task_type === '里程碑' });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const deltaDays = Math.round((e.clientX - drag.startX) / px);
      let ns = drag.origStart; let ne = drag.origEnd;
      if (drag.mode === 'move') { ns = addDays(drag.origStart, deltaDays); ne = addDays(drag.origEnd, deltaDays); }
      else if (drag.mode === 'resize-l') { ns = addDays(drag.origStart, deltaDays); if (ns > ne) ns = ne; }
      else { ne = addDays(drag.origEnd, deltaDays); if (ne < ns) ne = ns; }
      if (drag.isMilestone) ne = ns; // 里程碑保持单日
      setPreview((p) => ({ ...p, [drag.id]: { start: fmtISO(ns), end: fmtISO(ne) } }));
    };
    const onUp = async () => {
      const pv = preview[drag.id];
      const d = drag; setDrag(null);
      if (pv) {
        try {
          await projectApi.updateTask(projectId, d.id, { planned_start: pv.start, planned_end: pv.end });
          onTaskUpdated?.();
          await load();
        } catch {
          await load();
        }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    /* eslint-disable-next-line */
  }, [drag, preview, px, projectId]);

  // 无日期任务:在时间轴上拖拽快速划出计划起止
  const onCreateDown = (e: React.MouseEvent, t: GanttTask) => {
    if (!canEdit || !svgRef.current || !range) return;
    e.preventDefault();
    const rect = svgRef.current.getBoundingClientRect();
    const day = Math.max(0, Math.floor((e.clientX - rect.left) / px));
    setCreateDrag({ id: t.id, anchorDay: day, isMilestone: t.task_type === '里程碑' });
    const d = fmtISO(addDays(range.start, day));
    setPreview((p) => ({ ...p, [t.id]: { start: d, end: d } }));
  };

  useEffect(() => {
    if (!createDrag || !svgRef.current || !range) return;
    const onMove = (e: MouseEvent) => {
      const rect = svgRef.current!.getBoundingClientRect();
      const day = Math.max(0, Math.floor((e.clientX - rect.left) / px));
      if (createDrag.isMilestone) {
        const d = fmtISO(addDays(range.start, day));
        setPreview((p) => ({ ...p, [createDrag.id]: { start: d, end: d } }));
        return;
      }
      const s = Math.min(createDrag.anchorDay, day);
      const en = Math.max(createDrag.anchorDay, day);
      setPreview((p) => ({
        ...p,
        [createDrag.id]: { start: fmtISO(addDays(range.start, s)), end: fmtISO(addDays(range.start, en)) },
      }));
    };
    const onUp = async () => {
      const id = createDrag.id; const pv = preview[id];
      setCreateDrag(null);
      if (pv) {
        try {
          await projectApi.updateTask(projectId, id, { planned_start: pv.start, planned_end: pv.end });
          onTaskUpdated?.();
          await load();
        } catch {
          await load();
        }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    /* eslint-disable-next-line */
  }, [createDrag, preview, px, projectId, range]);

  // 测量可视宽度,用于把日历铺满界面
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  // 拖动时间轴空白处左右平移(调整关注区域)
  const onPanDown = (e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    setPan({ startX: e.clientX, startScroll: scrollRef.current.scrollLeft });
  };
  useEffect(() => {
    if (!pan) return;
    const onMove = (e: MouseEvent) => {
      if (scrollRef.current) scrollRef.current.scrollLeft = pan.startScroll - (e.clientX - pan.startX);
    };
    const onUp = () => setPan(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [pan]);

  if (loading && !data) return <div className="p-8 text-center text-gray-400">加载甘特图...</div>;
  if (!data || !range) return null;
  if (data.tasks.length === 0) return <div className="p-8 text-center text-gray-400">该项目还没有任务,先在"项目详情"中添加任务。</div>;

  // 日历铺满可视宽度:不足时向后补天数填满
  const availChartW = Math.max(0, viewportW - LEFT_W);
  const totalDays = Math.max(daysBetween(range.start, range.end) + 1, Math.ceil(availChartW / px));
  const chartW = totalDays * px;
  const chartH = data.tasks.length * ROW_H;
  const rowIndex: Record<string, number> = {};
  data.tasks.forEach((t, i) => { rowIndex[t.id] = i; });
  const tickList = ticks(range.start, addDays(range.start, totalDays - 1), scale);
  const todayX = daysBetween(range.start, new Date()) * px;

  const depPaths = data.deps.map((dep) => {
    const pt = data.tasks.find((t) => t.id === dep.predecessor_id);
    const st = data.tasks.find((t) => t.id === dep.successor_id);
    if (!pt || !st) return null;
    const pb = barBox(effTask(pt), range.start, scale, rowIndex[pt.id]);
    const sb = barBox(effTask(st), range.start, scale, rowIndex[st.id]);
    if (!pb || !sb) return null;
    const a = depAnchors(dep);
    const x1 = a.from === 'end' ? pb.x + pb.w : pb.x;
    const y1 = pb.y + BAR_H / 2;
    const x2 = a.to === 'end' ? sb.x + sb.w : sb.x;
    const y2 = sb.y + BAR_H / 2;
    const midX = (x1 + x2) / 2;
    return (
      <path key={dep.id} d={`M${x1},${y1} L${midX},${y1} L${midX},${y2} L${x2},${y2}`}
        fill="none" stroke={dep.is_violation ? '#ef4444' : '#94a3b8'}
        strokeWidth={dep.is_violation ? 2 : 1.2} markerEnd="url(#arrow)" />
    );
  });

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
        <span className="text-sm text-gray-500">视图:</span>
        {(['day', 'week', 'month'] as Scale[]).map((s) => (
          <button key={s} onClick={() => setScale(s)}
            className={`px-2 py-1 text-xs rounded ${scale === s ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300 text-gray-600'}`}>
            {s === 'day' ? '日' : s === 'week' ? '周' : '月'}
          </button>
        ))}
        <button onClick={load} className="ml-auto px-2 py-1 text-xs rounded bg-white border border-gray-300 text-gray-600">刷新</button>
      </div>

      <div ref={scrollRef} className="flex overflow-auto" style={{ maxHeight: '70vh' }}>
        <div className="shrink-0 border-r border-gray-200 sticky left-0 z-20 bg-white" style={{ width: LEFT_W }}>
          <div className="h-8 bg-gray-50 border-b border-gray-200 flex items-center text-xs font-medium text-gray-500">
            <span className="px-2 shrink-0 truncate" style={{ width: CODE_W }}>任务编号</span>
            <span className="px-1 flex-1 min-w-0 truncate">任务名称</span>
            <span className="px-1 shrink-0 truncate text-center" style={{ width: ASSIGNEE_W }}>负责人</span>
          </div>
          {data.tasks.map((t) => (
            <div key={t.id} onClick={() => onRowClick?.(t.id)}
              className="flex items-center border-b border-gray-100 text-sm cursor-pointer hover:bg-primary-50" style={{ height: ROW_H }}>
              <span className="pr-2 shrink-0 truncate text-xs text-gray-500 font-mono" style={{ width: CODE_W, paddingLeft: 8 + t.depth * INDENT }} title={t.code}>
                {t.code}
              </span>
              <span className="px-1 flex-1 min-w-0 flex items-center">
                <span className="text-gray-400 mr-1 shrink-0">
                  {t.task_type === '里程碑' ? '🏁' : t.task_type === '评审' ? '🔎' : '📋'}
                </span>
                <span className={`truncate ${t.is_critical ? 'text-red-600 font-medium' : 'text-gray-700'}`} title={t.name}>
                  {t.name}
                </span>
              </span>
              <span className="px-1 shrink-0 truncate text-xs text-gray-500 text-center" style={{ width: ASSIGNEE_W }} title={t.assignee_name || ''}>
                {t.assignee_name || '—'}
              </span>
            </div>
          ))}
        </div>

        <div className="relative" style={{ width: chartW }}>
          <div className="sticky top-0 h-8 bg-gray-50 border-b border-gray-200 z-10" style={{ width: chartW, cursor: pan ? 'grabbing' : 'grab' }}
            onMouseDown={onPanDown}>
            {tickList.map((tk, i) => (
              <div key={i} className={`absolute top-0 h-8 text-[10px] flex items-center ${tk.major ? 'text-gray-600' : 'text-gray-300'}`}
                style={{ left: tk.x, borderLeft: tk.major ? '1px solid #e5e7eb' : 'none', paddingLeft: 2 }}>
                {tk.label}
              </div>
            ))}
          </div>

          <svg ref={svgRef} width={chartW} height={chartH} className="block">
            <defs>
              <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8" />
              </marker>
            </defs>
            {data.tasks.map((t, i) => (
              <rect key={`bg-${t.id}`} x={0} y={i * ROW_H} width={chartW} height={ROW_H}
                fill={i % 2 ? '#fafafa' : '#fff'}
                style={{ cursor: pan ? 'grabbing' : 'grab' }} onMouseDown={onPanDown} />
            ))}
            {todayX >= 0 && todayX <= chartW && (
              <line x1={todayX} y1={0} x2={todayX} y2={chartH} stroke="#f97316" strokeWidth={1} strokeDasharray="3,3" />
            )}
            {depPaths}
            {data.tasks.map((t) => {
              const box = barBox(effTask(t), range.start, scale, rowIndex[t.id]);
              if (!box) return null;
              const isParent = data.tasks.some((c) => c.parent_id === t.id);
              if (t.task_type === '里程碑') {
                const cx = box.x; const cy = box.y + 6;
                return <rect key={t.id} x={cx - 7} y={cy - 7} width={14} height={14}
                  transform={`rotate(45 ${cx} ${cy})`}
                  fill={t.is_overdue ? '#ef4444' : '#6366f1'} stroke={t.is_critical ? '#dc2626' : 'none'} strokeWidth={2}
                  style={{ cursor: canEdit && !isParent ? 'grab' : 'default' }}
                  onMouseDown={(e) => { if (canEdit && !isParent) onMouseDown(e, t, 'move'); }} />;
              }
              const fill = t.is_overdue ? '#ef4444' : STATUS_FILL[t.status] || '#9ca3af';
              return (
                <g key={t.id}>
                  <rect x={box.x} y={box.y} width={box.w} height={12} rx={3}
                    fill={isParent ? '#cbd5e1' : fill} opacity={isParent ? 0.7 : 1}
                    stroke={t.is_critical ? '#dc2626' : 'none'} strokeWidth={t.is_critical ? 2 : 0}
                    style={{ cursor: canEdit && !isParent ? 'grab' : 'default' }}
                    onMouseDown={(e) => !isParent && onMouseDown(e, t, 'move')} />
                  {canEdit && !isParent && (
                    <>
                      <rect x={box.x - 3} y={box.y} width={6} height={12} fill="transparent" style={{ cursor: 'ew-resize' }}
                        onMouseDown={(e) => onMouseDown(e, t, 'resize-l')} />
                      <rect x={box.x + box.w - 3} y={box.y} width={6} height={12} fill="transparent" style={{ cursor: 'ew-resize' }}
                        onMouseDown={(e) => onMouseDown(e, t, 'resize-r')} />
                    </>
                  )}
                </g>
              );
            })}
            {/* 无日期任务:整行透明覆盖层,拖拽划出计划起止 */}
            {canEdit && data.tasks.map((t, i) => {
              const hasDates = !!(t.planned_start && t.planned_end);
              const isParent = data.tasks.some((c) => c.parent_id === t.id);
              if (hasDates || isParent || preview[t.id]) return null;
              return (
                <g key={`new-${t.id}`}>
                  <text x={6} y={i * ROW_H + ROW_H / 2 + 3} fontSize={10} fill="#cbd5e1" style={{ pointerEvents: 'none' }}>
                    ⟵ 拖拽设置计划日期 ⟶
                  </text>
                  <rect x={0} y={i * ROW_H} width={chartW} height={ROW_H} fill="transparent"
                    style={{ cursor: 'crosshair' }} onMouseDown={(e) => onCreateDown(e, t)} />
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}

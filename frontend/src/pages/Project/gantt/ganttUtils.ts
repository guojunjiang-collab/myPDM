import type { GanttTask, TaskDependency } from '../../../types/project';

export type Scale = 'day' | 'week' | 'month';

export const DAY_PX: Record<Scale, number> = { day: 40, week: 10, month: 4 };
export const ROW_H = 36;      // 与项目详情任务行高(px-4 py-2 text-sm)一致
export const BAR_H = 12;      // 任务条高度
export const CODE_W = 200;    // 左侧:任务编号列宽(含层级缩进)
export const ASSIGNEE_W = 72; // 左侧:负责人列宽
export const STATUS_W = 64;   // 左侧:状态列宽
export const LEFT_W = 574;    // 左侧固定区总宽(编号 + 名称 + 状态 + 负责人)
export const INDENT = 20;     // 每层级缩进像素(同详情页)

export function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function fmtISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 计算时间轴范围:任务最早开始 - 2 天 ~ 最晚结束 + 2 天;无日期时以今天为中心 ±15 天。 */
export function computeRange(tasks: GanttTask[]): { start: Date; end: Date } {
  const dates: Date[] = [];
  for (const t of tasks) {
    const s = parseDate(t.planned_start);
    const e = parseDate(t.planned_end);
    if (s) dates.push(s);
    if (e) dates.push(e);
  }
  if (dates.length === 0) {
    const today = new Date();
    return { start: addDays(today, -15), end: addDays(today, 15) };
  }
  const min = new Date(Math.min(...dates.map((d) => d.getTime())));
  const max = new Date(Math.max(...dates.map((d) => d.getTime())));
  return { start: addDays(min, -2), end: addDays(max, 2) };
}

export interface BarBox {
  x: number; w: number; y: number;
}

/** 任务条几何:相对时间轴起点的像素位置。 */
export function barBox(t: GanttTask, rangeStart: Date, scale: Scale, rowIndex: number): BarBox | null {
  const s = parseDate(t.planned_start);
  const e = parseDate(t.planned_end);
  if (!s || !e) return null;
  const px = DAY_PX[scale];
  const x = daysBetween(rangeStart, s) * px;
  const w = Math.max(px, (daysBetween(s, e) + 1) * px);
  const y = rowIndex * ROW_H + (ROW_H - BAR_H) / 2; // 垂直居中任务条
  return { x, w, y };
}

/** 表头刻度:返回 [{x, label, major}]。 */
export function ticks(rangeStart: Date, rangeEnd: Date, scale: Scale): { x: number; label: string; major: boolean }[] {
  const px = DAY_PX[scale];
  const total = daysBetween(rangeStart, rangeEnd) + 1;
  const out: { x: number; label: string; major: boolean }[] = [];
  for (let i = 0; i < total; i++) {
    const d = addDays(rangeStart, i);
    if (scale === 'day') {
      out.push({ x: i * px, label: `${d.getMonth() + 1}/${d.getDate()}`, major: d.getDay() === 1 });
    } else if (scale === 'week') {
      if (d.getDay() === 1) out.push({ x: i * px, label: `${d.getMonth() + 1}/${d.getDate()}`, major: true });
    } else {
      if (d.getDate() === 1) out.push({ x: i * px, label: `${d.getFullYear()}-${d.getMonth() + 1}`, major: true });
    }
  }
  return out;
}

export const STATUS_FILL: Record<string, string> = {
  未开始: '#9ca3af',
  进行中: '#3b82f6',
  已完成: '#22c55e',
  挂起: '#eab308',
};

// 左侧状态列的徽章配色(与项目详情表一致)
export const STATUS_BADGE: Record<string, string> = {
  未开始: 'bg-gray-100 text-gray-600',
  进行中: 'bg-blue-50 text-blue-700',
  已完成: 'bg-green-50 text-green-700',
  挂起: 'bg-amber-50 text-amber-700',
};

/** 依赖连线两端的锚点(返回前置端 x 与后置端 x 的取法)。 */
export function depAnchors(dep: TaskDependency): { from: 'start' | 'end'; to: 'start' | 'end' } {
  switch (dep.dep_type) {
    case 'SS': return { from: 'start', to: 'start' };
    case 'FF': return { from: 'end', to: 'end' };
    case 'SF': return { from: 'start', to: 'end' };
    case 'FS':
    default: return { from: 'end', to: 'start' };
  }
}

export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return '早上好';
  if (hour >= 12 && hour < 18) return '下午好';
  return '晚上好';
}

export function relativeTime(iso: string, nowMs: number): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Math.floor((nowMs - t) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
}

export type StatusKey = 'draft' | 'frozen' | 'released' | 'obsolete';
export interface Distribution {
  total: number;
  draft: number; frozen: number; released: number; obsolete: number;
  pct: Record<StatusKey, number>;
}

export function statusDistribution(items: { status: string }[]): Distribution {
  const d: Distribution = {
    total: 0, draft: 0, frozen: 0, released: 0, obsolete: 0,
    pct: { draft: 0, frozen: 0, released: 0, obsolete: 0 },
  };
  for (const it of items) {
    d.total++;
    if (it.status === 'draft' || it.status === 'frozen' || it.status === 'released' || it.status === 'obsolete') {
      d[it.status]++;
    }
  }
  if (d.total > 0) {
    (['draft', 'frozen', 'released', 'obsolete'] as StatusKey[]).forEach((k) => {
      d.pct[k] = Math.round((d[k] / d.total) * 100);
    });
  }
  return d;
}

export function overdueDays(plannedEnd: string | null, nowMs: number): number {
  if (!plannedEnd) return 0;
  const t = Date.parse(plannedEnd);
  if (Number.isNaN(t)) return 0;
  const diff = Math.floor((nowMs - t) / 86400000);
  return diff > 0 ? diff : 0;
}

// myPDM 用统一 components 模型：日志 target_type 可能为 part/assembly/component，全部纳入
const ENTITY_TYPES = new Set(['part', 'assembly', 'component', 'document', 'configuration']);
const ENTITY_LABEL: Record<string, string> = { part: '零件', assembly: '部件', component: '零部件', document: '图文档', configuration: '构型项' };
const ACTION_LABEL: Record<string, string> = { create: '创建了', update: '更新了', delete: '删除了', login: '登录', review: '审批了' };

export interface RecentRef { targetType: string; targetId: string; at: string; }

export function dedupeRecentRefs(
  logs: { target_type: string; target_id: string; created_at: string }[],
  limit: number,
): RecentRef[] {
  const seen = new Set<string>();
  const out: RecentRef[] = [];
  for (const l of logs) {
    if (!ENTITY_TYPES.has(l.target_type)) continue;
    const key = `${l.target_type}:${l.target_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ targetType: l.target_type, targetId: l.target_id, at: l.created_at });
    if (out.length >= limit) break;
  }
  return out;
}

export interface FavItem { id: string; entity_type: string; entity_id: string; code: string; name: string; }

export function flattenFavorites(resp: any, limit: number): FavItem[] {
  const out: FavItem[] = [];
  const walk = (folders: any[]) => {
    for (const f of folders || []) {
      for (const it of f.items || []) {
        out.push(it);
        if (out.length >= limit) return;
      }
      walk(f.children || []);
      if (out.length >= limit) return;
    }
  };
  walk(resp?.folders || []);
  return out.slice(0, limit);
}

export interface Activity { initial: string; text: string; time: string; targetType: string; targetId: string; }

export function formatActivity(
  log: { username: string; action: string; target_type: string; target_id: string; created_at: string },
  nowMs: number,
): Activity {
  const action = ACTION_LABEL[log.action] || log.action;
  const label = ENTITY_LABEL[log.target_type] || log.target_type;
  return {
    initial: (log.username || '?').charAt(0),
    text: `${log.username} ${action}${label}`,
    time: relativeTime(log.created_at, nowMs),
    targetType: log.target_type,
    targetId: log.target_id,
  };
}

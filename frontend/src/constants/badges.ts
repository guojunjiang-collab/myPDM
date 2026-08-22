// 前端风格统一 —— 徽标语义映射单一事实源
// 业务代码只写语义（<Badge status="released" />），颜色只在这里与 badgeMeta.ts 中出现。

export const BADGE_TONES = ['blue', 'orange', 'green', 'red', 'gray', 'amber', 'teal', 'purple', 'indigo'] as const;
export type BadgeTone = (typeof BADGE_TONES)[number];

export type BadgeDomain =
  | 'part' | 'ecr' | 'eco' | 'profile' | 'inventoryDoc' | 'priority' | 'action' | 'exec'
  | 'checkout' | 'required' | 'entity' | 'match' | 'role' | 'user' | 'project' | 'task' | 'decision';

export interface BadgeDef { label: string; tone: BadgeTone }

// A. 数据生命周期（part/document/configItem/material 共用）
const PART_STATUS: Record<string, BadgeDef> = {
  draft: { label: '草稿', tone: 'blue' },
  frozen: { label: '冻结', tone: 'orange' },
  released: { label: '发布', tone: 'green' },
  obsolete: { label: '作废', tone: 'red' },
};

const FLOW_STATUS: Record<string, BadgeDef> = { // 审批流程：draft=灰（未提交），刻意与数据 draft=蓝 区分
  draft: { label: '草稿', tone: 'gray' },
  reviewing: { label: '审核中', tone: 'blue' },
  approved: { label: '已批准', tone: 'green' },
  rejected: { label: '已驳回', tone: 'red' },
};

export const BADGE_DOMAINS: Record<BadgeDomain, Record<string, BadgeDef>> = {
  part: PART_STATUS,
  ecr: FLOW_STATUS,
  eco: {
    ...FLOW_STATUS,
    executing: { label: '执行中', tone: 'amber' },
    completed: { label: '已完成', tone: 'teal' },
  },
  profile: {
    draft: { label: '草稿', tone: 'gray' },
    reviewing: { label: '评审中', tone: 'blue' },
    active: { label: '生效中', tone: 'green' },
    rejected: { label: '已驳回', tone: 'red' },
    archived: { label: '已归档', tone: 'gray' },
  },
  inventoryDoc: {
    draft: { label: '草稿', tone: 'gray' },
    reviewing: { label: '评审中', tone: 'blue' },
    approved: { label: '已批准', tone: 'green' },
    posted: { label: '已过账', tone: 'teal' },
    rejected: { label: '已驳回', tone: 'red' },
    cancelled: { label: '已取消', tone: 'gray' },
  },
  priority: {
    urgent: { label: '紧急', tone: 'red' },
    high: { label: '高', tone: 'orange' },
    normal: { label: '普通', tone: 'blue' },
    low: { label: '低', tone: 'gray' },
  },
  action: {
    create: { label: '新建', tone: 'green' },
    add_new: { label: '新建', tone: 'green' },
    add_existing: { label: '新增', tone: 'teal' },
    upgrade: { label: '升版', tone: 'blue' },
    qty_change: { label: '数量变更', tone: 'orange' },
    delete: { label: '删除', tone: 'red' },
    no_change: { label: '不变', tone: 'gray' },
  },
  exec: {
    pending: { label: '待执行', tone: 'gray' },
    in_progress: { label: '执行中', tone: 'amber' },
    completed: { label: '已完成', tone: 'green' },
    failed: { label: '失败', tone: 'red' },
  },
  checkout: {
    not_checked_out: { label: '未签出', tone: 'gray' },
    checked_out: { label: '已签出', tone: 'blue' },
    other_checked_out: { label: '他人签出', tone: 'amber' },
  },
  required: {
    required: { label: '必选', tone: 'blue' },
    optional: { label: '可选', tone: 'gray' },
  },
  entity: {
    part: { label: '零件', tone: 'gray' },
    assembly: { label: '装配', tone: 'blue' },
    configuration: { label: '构型项', tone: 'purple' },
    document: { label: '图文档', tone: 'indigo' },
  },
  match: {
    matched: { label: '已匹配', tone: 'green' },
    new: { label: '可新建', tone: 'amber' },
    conflict: { label: '冲突', tone: 'red' },
    unknown: { label: '未知', tone: 'gray' },
  },
  role: {
    admin: { label: '管理员', tone: 'red' },
    engineer: { label: '工程师', tone: 'blue' },
    production: { label: '生产人员', tone: 'green' },
    guest: { label: '访客', tone: 'gray' },
    unverified: { label: '未验证', tone: 'amber' },
  },
  user: {
    active: { label: '正常', tone: 'green' },
    disabled: { label: '禁用', tone: 'red' },
  },
  project: {
    '待启动': { label: '待启动', tone: 'gray' },
    '进行中': { label: '进行中', tone: 'blue' },
    '已完成': { label: '已完成', tone: 'green' },
    '已暂停': { label: '已暂停', tone: 'amber' },
    '已归档': { label: '已归档', tone: 'gray' },
  },
  task: {
    '未开始': { label: '未开始', tone: 'gray' },
    '进行中': { label: '进行中', tone: 'blue' },
    '已完成': { label: '已完成', tone: 'green' },
    '挂起': { label: '挂起', tone: 'amber' },
  },
  decision: {
    approved: { label: '同意', tone: 'green' },
    rejected: { label: '驳回', tone: 'red' },
  },
};

export function resolveBadge(
  status: string | undefined,
  domain: BadgeDomain,
  fallback?: { label?: string; tone?: BadgeTone },
): BadgeDef {
  if (status) {
    const hit = BADGE_DOMAINS[domain][status];
    if (hit) return hit;
    return { label: status, tone: 'gray' }; // 未知值灰底兜底，保留原值
  }
  return { label: fallback?.label ?? '', tone: fallback?.tone ?? 'gray' };
}

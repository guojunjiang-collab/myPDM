/**
 * 交付物汇总 - 纯函数工具
 * TAB 配置、状态标签映射、搜索/筛选、状态选项生成、来源任务文案。
 */
import { STATUS_OPTIONS } from '../../constants';
import type { DeliverableItem, DeliverableTaskRef } from '../../types/project';

export type DeliverableTabKey = 'config_items' | 'parts' | 'documents' | 'changes';

export interface DeliverableTabDef {
  key: DeliverableTabKey;
  label: string;
  nameLabel: string;
  extraLabel: string;
  showVersion: boolean;
  showExtra: boolean;
}

export const DELIVERABLE_TABS: DeliverableTabDef[] = [
  { key: 'config_items', label: '构型项', nameLabel: '名称', extraLabel: '版本名称', showVersion: true, showExtra: true },
  { key: 'parts', label: '零部件', nameLabel: '名称', extraLabel: '类型', showVersion: true, showExtra: true },
  { key: 'documents', label: '图文档', nameLabel: '名称', extraLabel: '备注', showVersion: true, showExtra: false },
  { key: 'changes', label: '变更', nameLabel: '标题', extraLabel: '类型', showVersion: false, showExtra: true },
];

/** 零部件/图文档/构型项状态 */
const BASE_STATUS_LABEL: Record<string, string> =
  Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));

/** 变更专有状态（与 ECRStatusBadge / ECOCreateModal 中的映射保持一致） */
const EC_STATUS_LABEL: Record<string, string> = {
  reviewing: '审核中', approved: '已批准', rejected: '已驳回',
  executing: '执行中', completed: '已完成', closed: '已关闭',
};

/** 状态英文值 → 中文标签；映射不到时原样返回 */
export function statusLabel(status: string): string {
  return BASE_STATUS_LABEL[status] || EC_STATUS_LABEL[status] || status;
}

/** 按关键词（编号/名称）与状态过滤 */
export function filterItems(
  items: DeliverableItem[], search: string, status: string,
): DeliverableItem[] {
  const kw = search.trim().toLowerCase();
  return items.filter((i) => {
    if (status && i.status !== status) return false;
    if (!kw) return true;
    return i.code.toLowerCase().includes(kw) || i.name.toLowerCase().includes(kw);
  });
}

/** 从当前数据动态生成状态下拉选项（去重 + 排序），不硬编码状态字典 */
export function statusOptions(items: DeliverableItem[]): { value: string; label: string }[] {
  const seen: string[] = [];
  for (const i of items) {
    if (i.status && !seen.includes(i.status)) seen.push(i.status);
  }
  seen.sort();
  return seen.map((s) => ({ value: s, label: statusLabel(s) }));
}

/** 来源任务列的悬浮提示：每行一个任务 */
export function taskTooltip(tasks: DeliverableTaskRef[]): string {
  return tasks.map((t) => `${t.code} ${t.name}`).join('\n');
}

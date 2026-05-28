interface ECOStatusBadgeProps { status: string }
interface ECOPriorityBadgeProps { priority: string }

const statusConfig: Record<string, { label: string; class: string }> = {
  draft: { label: '草稿', class: 'bg-gray-100 text-gray-800' },
  reviewing: { label: '评审中', class: 'bg-blue-100 text-blue-800' },
  approved: { label: '已批准', class: 'bg-green-100 text-green-800' },
  rejected: { label: '已驳回', class: 'bg-red-100 text-red-800' },
  executing: { label: '执行中', class: 'bg-yellow-100 text-yellow-800' },
  completed: { label: '已完成', class: 'bg-teal-100 text-teal-800' },
};

const priorityConfig: Record<string, { label: string; class: string }> = {
  urgent: { label: '紧急', class: 'bg-red-100 text-red-800' },
  high: { label: '高', class: 'bg-orange-100 text-orange-800' },
  normal: { label: '普通', class: 'bg-blue-100 text-blue-800' },
  low: { label: '低', class: 'bg-gray-100 text-gray-600' },
};

const actionConfig: Record<string, { label: string; class: string }> = {
  create: { label: '新建', class: 'bg-green-100 text-green-800' },
  upgrade: { label: '升版', class: 'bg-blue-100 text-blue-800' },
  qty_change: { label: '数量变更', class: 'bg-orange-100 text-orange-800' },
  delete: { label: '删除', class: 'bg-red-100 text-red-800' },
  no_change: { label: '不变', class: 'bg-gray-100 text-gray-600' },
  add_existing: { label: '新增', class: 'bg-teal-100 text-teal-800' },
  add_new: { label: '新建', class: 'bg-green-100 text-green-800' },
};

const execStatusConfig: Record<string, { label: string; class: string }> = {
  pending: { label: '待执行', class: 'bg-gray-100 text-gray-600' },
  in_progress: { label: '执行中', class: 'bg-yellow-100 text-yellow-800' },
  completed: { label: '已完成', class: 'bg-green-100 text-green-800' },
  failed: { label: '失败', class: 'bg-red-100 text-red-800' },
  skipped: { label: '已跳过', class: 'bg-gray-200 text-gray-500' },
};

export function ECOStatusBadge({ status }: ECOStatusBadgeProps) {
  const c = statusConfig[status] || { label: status, class: 'bg-gray-100 text-gray-800' };
  return <span className={`px-2 py-1 text-xs rounded-full ${c.class}`}>{c.label}</span>;
}

export function ECOPriorityBadge({ priority }: ECOPriorityBadgeProps) {
  const c = priorityConfig[priority] || { label: priority, class: 'bg-gray-100 text-gray-600' };
  return <span className={`px-2 py-1 text-xs rounded-full ${c.class}`}>{c.label}</span>;
}

export function ECOActionBadge({ action }: { action: string }) {
  const c = actionConfig[action] || { label: action, class: 'bg-gray-100 text-gray-600' };
  return <span className={`px-2 py-1 text-xs rounded-full ${c.class}`}>{c.label}</span>;
}

export function ECOExecStatusBadge({ status }: { status: string }) {
  const c = execStatusConfig[status] || { label: status, class: 'bg-gray-100 text-gray-600' };
  return <span className={`px-2 py-1 text-xs rounded-full ${c.class}`}>{c.label}</span>;
}

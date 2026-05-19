interface ECRStatusBadgeProps {
  status: string;
}

interface ECRPriorityBadgeProps {
  priority: string;
}

const statusConfig: Record<string, { label: string; class: string }> = {
  draft: { label: '草稿', class: 'bg-gray-100 text-gray-800' },
  reviewing: { label: '审核中', class: 'bg-blue-100 text-blue-800' },
  approved: { label: '已批准', class: 'bg-green-100 text-green-800' },
  rejected: { label: '已驳回', class: 'bg-red-100 text-red-800' },
  closed: { label: '已关闭', class: 'bg-gray-200 text-gray-700' },
};

const priorityConfig: Record<string, { label: string; class: string }> = {
  urgent: { label: '紧急', class: 'bg-red-100 text-red-800' },
  high: { label: '高', class: 'bg-orange-100 text-orange-800' },
  normal: { label: '普通', class: 'bg-blue-100 text-blue-800' },
  low: { label: '低', class: 'bg-gray-100 text-gray-600' },
};

export function ECRStatusBadge({ status }: ECRStatusBadgeProps) {
  const config = statusConfig[status] || { label: status, class: 'bg-gray-100 text-gray-800' };
  return (
    <span className={`px-2 py-1 text-xs rounded-full ${config.class}`}>
      {config.label}
    </span>
  );
}

export function ECRPriorityBadge({ priority }: ECRPriorityBadgeProps) {
  const config = priorityConfig[priority] || { label: priority, class: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`px-2 py-1 text-xs rounded-full ${config.class}`}>
      {config.label}
    </span>
  );
}

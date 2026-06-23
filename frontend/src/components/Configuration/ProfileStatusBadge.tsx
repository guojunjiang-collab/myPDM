interface ProfileStatusBadgeProps { status: string }

const statusConfig: Record<string, { label: string; class: string }> = {
  draft: { label: '草稿', class: 'bg-gray-100 text-gray-800' },
  reviewing: { label: '评审中', class: 'bg-orange-100 text-orange-800' },
  active: { label: '生效中', class: 'bg-green-100 text-green-800' },
  rejected: { label: '已驳回', class: 'bg-red-100 text-red-800' },
  archived: { label: '已归档', class: 'bg-slate-200 text-slate-600' },
};

export default function ProfileStatusBadge({ status }: ProfileStatusBadgeProps) {
  const c = statusConfig[status] || { label: status, class: 'bg-gray-100 text-gray-800' };
  return <span className={`px-2 py-1 text-xs rounded-full ${c.class}`}>{c.label}</span>;
}

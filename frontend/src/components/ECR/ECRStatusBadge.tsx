import Badge from '../ui/Badge';

export function ECRStatusBadge({ status }: { status: string }) {
  return <Badge status={status} domain="ecr" />;
}

export function ECRPriorityBadge({ priority }: { priority: string }) {
  return <Badge status={priority} domain="priority" />;
}

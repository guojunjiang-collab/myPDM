import Badge from '../ui/Badge';

export function ECOStatusBadge({ status }: { status: string }) {
  return <Badge status={status} domain="eco" />;
}

export function ECOPriorityBadge({ priority }: { priority: string }) {
  return <Badge status={priority} domain="priority" />;
}

export function ECOActionBadge({ action }: { action: string }) {
  return <Badge status={action} domain="action" />;
}

export function ECOExecStatusBadge({ status }: { status: string }) {
  return <Badge status={status} domain="exec" />;
}

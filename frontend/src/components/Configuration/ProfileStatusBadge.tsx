import Badge from '../ui/Badge';

export default function ProfileStatusBadge({ status }: { status: string }) {
  return <Badge status={status} domain="profile" />;
}

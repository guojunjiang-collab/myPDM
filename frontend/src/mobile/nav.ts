import type { Permission } from '../constants/permissions.generated';

export interface MobileTab {
  key: string;
  path: string;
  label: string;
  icon: string;
  perm: Permission;
}

export const MOBILE_TABS: MobileTab[] = [
  { key: 'board', path: '/board', label: '看板', icon: '📋', perm: 'nav.board' },
  { key: 'parts', path: '/parts', label: '零部件', icon: '📦', perm: 'nav.parts' },
  { key: 'documents', path: '/documents', label: '图文档', icon: '📄', perm: 'nav.documents' },
  { key: 'projects', path: '/projects', label: '项目', icon: '🗂️', perm: 'nav.projects' },
  { key: 'more', path: '/more', label: '更多', icon: '⋯', perm: 'nav.dashboard' },
];

export const MORE_ITEMS: MobileTab[] = [
  { key: 'dashboard', path: '/dashboard', label: '仪表盘', icon: '📊', perm: 'nav.dashboard' },
  { key: 'ecr', path: '/ec/ecr', label: 'ECR', icon: '📝', perm: 'nav.ec' },
  { key: 'eco', path: '/ec/eco', label: 'ECO', icon: '🔄', perm: 'nav.ec' },
  { key: 'inventory', path: '/inventory', label: '库存管理', icon: '🏬', perm: 'nav.inventory' },
  { key: 'config-items', path: '/configuration/items', label: '构型项管理', icon: '🧩', perm: 'nav.configuration' },
  { key: 'config-profiles', path: '/configuration/profiles', label: '构型配置', icon: '📐', perm: 'nav.configuration' },
  { key: 'notifications', path: '/notifications', label: '通知中心', icon: '🔔', perm: 'nav.settings' },
  { key: 'users', path: '/users', label: '用户管理', icon: '👥', perm: 'nav.users' },
];

export function filterVisible(items: MobileTab[], can: (p: Permission) => boolean): MobileTab[] {
  return items.filter((t) => can(t.perm));
}

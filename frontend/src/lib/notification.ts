export const NOTIFICATION_EVENT_ICON: Record<string, { icon: string; bg: string }> = {
  ecr_approved: { icon: '✅', bg: '#dcfce7' }, eco_approved: { icon: '✅', bg: '#dcfce7' },
  profile_approved: { icon: '✅', bg: '#dcfce7' }, inv_doc_approved: { icon: '✅', bg: '#dcfce7' },
  ecr_rejected: { icon: '↩️', bg: '#fee2e2' }, eco_rejected: { icon: '↩️', bg: '#fee2e2' },
  profile_rejected: { icon: '↩️', bg: '#fee2e2' }, inv_doc_rejected: { icon: '↩️', bg: '#fee2e2' },
  cc_added: { icon: '👁', bg: '#dbeafe' }, profile_archived: { icon: '📦', bg: '#f3f4f6' },
  eco_executing: { icon: '⚙️', bg: '#e0e7ff' }, eco_closed: { icon: '📦', bg: '#f3f4f6' },
  ecr_closed: { icon: '📦', bg: '#f3f4f6' }, inv_doc_posted: { icon: '📥', bg: '#fef9c3' },
  task_assigned: { icon: '📋', bg: '#dbeafe' },
  approval_request: { icon: '👤', bg: '#fef3c7' },
};

export const NOTIFICATION_TARGET_ROUTE: Record<string, string> = {
  ecr: '/ec', eco: '/ec', configuration_profile: '/configuration',
  inventory_document: '/inventory',   project_task: '/projects',
  user: '/users',
};

export function notificationIcon(eventType: string): { icon: string; bg: string } {
  return NOTIFICATION_EVENT_ICON[eventType] || { icon: '🔔', bg: '#f3f4f6' };
}

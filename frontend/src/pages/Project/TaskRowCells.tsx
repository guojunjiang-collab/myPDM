import { CODE_W, ASSIGNEE_W, INDENT } from './gantt/ganttUtils';

export const TYPE_ICON: Record<string, string> = { 任务: '📋', 里程碑: '🏁', 评审: '🔎' };

interface CodeCellProps {
  code: string;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggle?: (e: React.MouseEvent) => void;
  onClick?: () => void;
  variant: 'table' | 'gantt';
}

interface NameCellProps {
  name: string;
  taskType: string;
  isCritical?: boolean;
  isOverdue?: boolean;
  onClick?: () => void;
  variant: 'table' | 'gantt';
}

interface AssigneeCellProps {
  assigneeName?: string | null;
  onClick?: () => void;
  variant: 'table' | 'gantt';
}

export function TaskCodeCell({ code, depth, hasChildren, isExpanded, onToggle, onClick, variant }: CodeCellProps) {
  const indent = variant === 'gantt'
    ? { paddingLeft: 8 + depth * INDENT, width: CODE_W }
    : { paddingLeft: depth * INDENT };

  const toggleEl = hasChildren ? (
    variant === 'gantt' ? (
      <span className="inline-block w-4 cursor-pointer select-none text-gray-400 hover:text-gray-700"
        onClick={onToggle}>
        {isExpanded ? '▾' : '▸'}
      </span>
    ) : (
      <button onClick={onToggle} className="text-gray-400 w-4 shrink-0">
        {isExpanded ? '▾' : '▸'}
      </button>
    )
  ) : (
    <span className="inline-block w-4 shrink-0" />
  );

  return (
    <span
      className={variant === 'gantt'
        ? 'shrink-0 truncate'
        : 'whitespace-nowrap'}
      style={indent}
      title={code}
    >
      {toggleEl}
      {onClick ? (
        <span onClick={onClick} className={variant === 'gantt' ? 'cursor-pointer' : ''}>{code}</span>
      ) : (
        <span>{code}</span>
      )}
    </span>
  );
}

export function TaskNameCell({ name, taskType, isCritical, isOverdue, onClick, variant }: NameCellProps) {
  const icon = TYPE_ICON[taskType] || '📋';

  return (
    <span
      className={variant === 'gantt'
        ? `px-1 flex-1 min-w-0 flex items-center${onClick ? ' cursor-pointer' : ''}`
        : 'inline-flex items-center gap-1'}
      onClick={onClick}
    >
      <span className={variant === 'gantt' ? 'text-gray-400 mr-1 shrink-0' : ''}>{icon}</span>
      <span
        className={variant === 'gantt'
          ? `truncate ${isCritical ? 'text-red-600 font-medium' : 'text-gray-700'}`
          : 'font-medium'}
        title={variant === 'gantt' ? name : undefined}
      >
        {name}
      </span>
      {variant === 'table' && isOverdue && (
        <span className="text-xs text-red-600">⚠ 逾期</span>
      )}
    </span>
  );
}

export function TaskAssigneeCell({ assigneeName, onClick, variant }: AssigneeCellProps) {
  return (
    <span
      className={variant === 'gantt'
        ? `px-1 shrink-0 truncate text-sm text-center${onClick ? ' cursor-pointer' : ''}`
        : 'text-sm'}
      style={variant === 'gantt' ? { width: ASSIGNEE_W } : undefined}
      title={assigneeName || undefined}
      onClick={onClick}
    >
      {assigneeName || '—'}
    </span>
  );
}

import type { GanttTask } from '../../types/project';
import { CODE_W, ASSIGNEE_W, STATUS_W, LEFT_W, ROW_H, INDENT } from './gantt/ganttUtils';
import { TaskCodeCell, TaskNameCell, TaskAssigneeCell } from './TaskRowCells';
import { STATUS_BADGE } from './gantt/ganttUtils';

interface Props {
  tasks: GanttTask[];
  expanded: Set<string>;
  childMap: Record<string, GanttTask[]>;
  onToggle: (taskId: string) => void;
  onRowClick: (taskId: string) => void;
  project?: { code: string; name: string; status?: string | null; owner_name?: string | null } | null;
  hoveredId?: string | null;
  onHover?: (taskId: string | null) => void;
  hideHeader?: boolean;
}

export default function SharedLeftPanel({ tasks, expanded, childMap, onToggle, onRowClick, project, hoveredId, onHover, hideHeader }: Props) {
  const hasProject = !!(project?.code);

  return (
    <div className="shrink-0 border-r border-gray-200 bg-white" style={{ width: LEFT_W }}>
      {!hideHeader && (
      <div className="bg-gray-50 border-b border-gray-200 flex items-center text-sm font-medium text-gray-500 sticky top-0 z-10" style={{ height: ROW_H }}>
        <span className="shrink-0 truncate text-left pl-2" style={{ width: CODE_W }}>任务编号</span>
        <span className="px-1 flex-1 min-w-0 truncate text-left">任务名称</span>
        <span className="px-1 shrink-0 truncate text-center" style={{ width: ASSIGNEE_W }}>负责人</span>
        <span className="px-1 shrink-0 truncate text-center" style={{ width: STATUS_W }}>状态</span>
      </div>
      )}
      {hasProject && project && (
        <div className="flex items-center border-b border-gray-200 bg-gray-50 text-sm" style={{ height: ROW_H }}>
          <span className="shrink-0 truncate font-semibold text-gray-700 pl-2" style={{ width: CODE_W }} title={project.code}>
            {project.code}
          </span>
          <span className="px-1 flex-1 min-w-0 flex items-center">
            <span className="text-gray-400 mr-1 shrink-0">📁</span>
            <span className="font-medium text-gray-700 truncate" title={project.name}>{project.name}</span>
          </span>
          <span className="px-1 shrink-0 truncate text-xs text-gray-500 text-center" style={{ width: ASSIGNEE_W }} title={project.owner_name || ''}>
            {project.owner_name || '—'}
          </span>
          <span className="px-1 shrink-0 flex items-center justify-center" style={{ width: STATUS_W }}>
            {project.status && (
              <span className={`px-1.5 py-0.5 text-xs rounded ${STATUS_BADGE[project.status] || 'bg-gray-100 text-gray-600'}`}>{project.status}</span>
            )}
          </span>
        </div>
      )}
      {tasks.map((t) => {
        const hasChildren = !!childMap[t.id];
        return (
          <div key={t.id}
            className={`flex items-center border-b border-gray-100 text-sm ${hoveredId === t.id ? 'bg-primary-50' : ''}`}
            style={{ height: ROW_H }}
            onMouseEnter={() => onHover?.(t.id)}>
            <TaskCodeCell code={t.code} depth={t.depth} hasChildren={hasChildren}
              isExpanded={expanded.has(t.id)}
              onToggle={(e) => { e.stopPropagation(); onToggle(t.id); }}
              onClick={() => onRowClick?.(t.id)} variant="gantt" />
            <TaskNameCell name={t.name} taskType={t.task_type}
              isCritical={t.is_critical} variant="gantt"
              onClick={() => onRowClick?.(t.id)} />
            <TaskAssigneeCell assigneeName={t.assignee_name} variant="gantt"
              onClick={() => onRowClick?.(t.id)} />
            <span className="px-1 shrink-0 flex items-center justify-center cursor-pointer" style={{ width: STATUS_W }}
              onClick={() => onRowClick?.(t.id)}>
              <span className={`px-1.5 py-0.5 text-xs rounded whitespace-nowrap ${STATUS_BADGE[t.status] || 'bg-gray-100 text-gray-600'}`}>{t.status}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

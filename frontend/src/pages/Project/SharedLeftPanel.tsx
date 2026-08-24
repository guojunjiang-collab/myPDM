import React from 'react';
import type { GanttTask, ProjectTask } from '../../types/project';
import Button from '../../components/ui/Button';
import { CODE_W, ASSIGNEE_W, STATUS_W, LEFT_W, ROW_H, OP_W } from './gantt/ganttUtils';
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
  /** 拖拽排序支持 */
  dragTask?: ProjectTask | null;
  dragOver?: { taskId: string; position: 'above' | 'below' | 'into' } | null;
  onDragStart?: (t: ProjectTask, e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (t: ProjectTask, e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (t: ProjectTask, e: React.DragEvent) => void;
  /** 关联/操作列（最右侧常显，同原右侧计划表操作列） */
  canAddChild?: boolean;
  canDelete?: boolean;
  onAddChild?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
}

export default function SharedLeftPanel({ tasks, expanded, childMap, onToggle, onRowClick, project, hoveredId, onHover, hideHeader, dragTask, dragOver, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, canAddChild, canDelete, onAddChild, onDelete }: Props) {
  const hasProject = !!(project?.code);

  return (
    <div className="shrink-0 border-r border-[var(--ui-border)] bg-[var(--ui-bg-surface)]" style={{ width: LEFT_W }}>
      {!hideHeader && (
      <div className="bg-[var(--ui-bg-subtle)] border-b border-[var(--ui-border)] flex items-center text-sm font-medium text-[var(--ui-text-secondary)] sticky top-0 z-10" style={{ height: ROW_H }}>
        <span className="shrink-0 truncate text-left pl-2" style={{ width: CODE_W }}>任务编号</span>
        <span className="px-1 flex-1 min-w-0 truncate text-left">任务名称</span>
        <span className="px-1 shrink-0 truncate text-center" style={{ width: ASSIGNEE_W }}>负责人</span>
        <span className="px-1 shrink-0 truncate text-center" style={{ width: STATUS_W }}>状态</span>
        <span className="shrink-0 px-2 text-right" style={{ width: OP_W }}>关联/操作</span>
      </div>
      )}
      {hasProject && project && (
        <div className="flex items-center border-b border-[var(--ui-border)] bg-[var(--ui-bg-subtle)] text-sm" style={{ height: ROW_H }}>
          <span className="shrink-0 truncate font-semibold text-gray-700 pl-2" style={{ width: CODE_W }} title={project.code}>
            {project.code}
          </span>
          <span className="px-1 flex-1 min-w-0 flex items-center">
            <span className="text-[var(--ui-text-tertiary)] mr-1 shrink-0">📁</span>
            <span className="font-medium text-gray-700 truncate" title={project.name}>{project.name}</span>
          </span>
          <span className="px-1 shrink-0 truncate text-xs text-[var(--ui-text-secondary)] text-center" style={{ width: ASSIGNEE_W }} title={project.owner_name || ''}>
            {project.owner_name || '—'}
          </span>
          <span className="px-1 shrink-0 flex items-center justify-center" style={{ width: STATUS_W }}>
            {project.status && (
              <span className={`px-1.5 py-0.5 text-xs rounded ${STATUS_BADGE[project.status] || 'bg-gray-100 text-[var(--ui-text-secondary)]'}`}>{project.status}</span>
            )}
          </span>
          {/* 关联/操作列占位：与任务行操作列等宽，保证名称/状态列对齐 */}
          <div className="shrink-0" style={{ width: OP_W }} />
        </div>
      )}
      {tasks.map((t) => {
        const hasChildren = !!childMap[t.id];
        const isDragAbove = dragOver?.taskId === t.id && dragOver?.position === 'above';
        const isDragBelow = dragOver?.taskId === t.id && dragOver?.position === 'below';
        const isDragInto = dragOver?.taskId === t.id && dragOver?.position === 'into';
        const isDragging = dragTask?.id === t.id;
        const hasDrag = !!onDragStart;
        const dragProps = hasDrag ? {
          draggable: true as const,
          onDragStart: (e: React.DragEvent) => onDragStart!(t as any, e),
          onDragEnd: onDragEnd!,
          onDragOver: (e: React.DragEvent) => onDragOver!(t as any, e),
          onDragLeave: onDragLeave!,
          onDrop: (e: React.DragEvent) => onDrop!(t as any, e),
        } : {};
        return (
          <React.Fragment key={t.id}>
            {isDragAbove && <div className="h-1"><div className="h-1 bg-primary-500 rounded-full mx-1" /></div>}
            <div
              {...dragProps}
              className={`project-detail-row flex items-center border-b border-[var(--ui-border)] text-sm relative ${hoveredId === t.id ? 'bg-[var(--ui-highlight-bg)]' : t.is_overdue ? 'bg-red-50' : ''} ${isDragInto ? 'bg-blue-50 ring-2 ring-primary-300 ring-inset' : ''} ${isDragging ? 'opacity-40' : ''} ${hasDrag ? 'cursor-grab' : ''}`}
              style={{ height: ROW_H }}
              onMouseEnter={() => onHover?.(t.id)}
              onClick={(e) => { if (hasDrag) e.stopPropagation(); onRowClick?.(t.id); }}>
              {/* 树形缩进竖线：每层一条，对齐该层展开按钮中心（16 + k*var(--ui-tree-indent)），与 BOM 树/ECO 弹窗同款 */}
              {t.depth > 0 && Array.from({ length: t.depth }, (_, k) => (
                <span key={k} className="absolute -top-px bottom-0 w-px bg-[var(--ui-border)] pointer-events-none" style={{ left: `calc(16px + ${k} * var(--ui-tree-indent))` }} />
              ))}
              <TaskCodeCell code={t.code} depth={t.depth} hasChildren={hasChildren}
                isExpanded={expanded.has(t.id)}
                onToggle={() => onToggle(t.id)}
                onClick={() => onRowClick?.(t.id)} variant="gantt" />
              <TaskNameCell name={t.name} taskType={t.task_type}
                isCritical={t.is_critical} variant="gantt"
                onClick={() => onRowClick?.(t.id)} />
              <TaskAssigneeCell assigneeName={t.assignee_name} variant="gantt"
                onClick={() => onRowClick?.(t.id)} />
              <span className="px-1 shrink-0 flex items-center justify-center" style={{ width: STATUS_W }}
                onClick={() => onRowClick?.(t.id)}>
                <span className={`px-1.5 py-0.5 text-xs rounded whitespace-nowrap ${STATUS_BADGE[t.status] || 'bg-gray-100 text-[var(--ui-text-secondary)]'}`}>{t.status}</span>
              </span>
              {/* 关联/操作列：常显在左侧最右侧（🔗 关联数固定占位右对齐，按钮按权限显示） */}
              <div className="shrink-0 flex items-center justify-end px-4 text-[var(--ui-text-tertiary)]" onClick={(e) => e.stopPropagation()}>
                <span className={`mr-2 w-[24px] shrink-0 text-right ${(t.link_count ?? 0) > 0 ? '' : 'invisible'}`}>{t.link_count ?? 0}</span>
                {canAddChild && onAddChild && <Button variant="link" size="xs" className="mr-2" onClick={() => onAddChild(t.id)}>+子</Button>}
                {canDelete && onDelete && <Button variant="danger" size="xs" onClick={() => onDelete(t.id)}>删除</Button>}
              </div>
            </div>
            {isDragBelow && <div className="h-1"><div className="h-1 bg-primary-500 rounded-full mx-1" /></div>}
          </React.Fragment>
        );
      })}
    </div>
  );
}

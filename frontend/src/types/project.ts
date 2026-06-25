export type ProjectStatus = '待启动' | '进行中' | '已完成' | '已暂停' | '已归档';
export type TaskType = '任务' | '里程碑' | '评审';
export type TaskStatus = '未开始' | '进行中' | '已完成' | '挂起';
export type TaskPriority = '高' | '中' | '低';
export type LinkEntityType = 'part' | 'assembly' | 'config_item' | 'ec' | 'document';

export interface ProjectMember {
  id: string;
  user_id: string;
  user_name: string;
  username: string;
  role_in_project: '经理' | '成员';
}

export interface Project {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  owner_id: string;
  owner_name: string;
  planned_start?: string | null;
  planned_end?: string | null;
  description?: string | null;
  member_count?: number;
  members?: ProjectMember[];
  created_at?: string;
}

export interface ProjectTask {
  id: string;
  project_id: string;
  parent_id: string | null;
  code: string;
  name: string;
  task_type: TaskType;
  assignee_id: string | null;
  assignee_name?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  planned_start?: string | null;
  planned_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  sort_order: number;
  description?: string | null;
  link_count?: number;
  children?: ProjectTask[];
}

export interface TaskLink {
  id: string;
  task_id: string;
  entity_type: LinkEntityType;
  entity_id: string;
  entity_code?: string | null;
  entity_name?: string | null;
  entity_spec?: string | null;
  entity_remark?: string | null;
}

export interface TaskComment {
  id: string;
  task_id: string;
  user_id: string;
  user_name: string;
  content: string;
  created_at: string;
}

export type DepType = 'FS' | 'SS' | 'FF' | 'SF';

export interface TaskDependency {
  id: string;
  predecessor_id: string;
  successor_id: string;
  dep_type: DepType;
  lag_days: number;
  is_violation?: boolean;
}

export interface GanttTask {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  task_type: TaskType;
  status: TaskStatus;
  assignee_name?: string | null;
  planned_start: string | null;
  planned_end: string | null;
  duration_days: number | null;
  is_critical: boolean;
  is_overdue: boolean;
  sort_order: number;
  depth: number;
}

export interface GanttData {
  tasks: GanttTask[];
  deps: TaskDependency[];
  range: { min_date: string | null; max_date: string | null };
}

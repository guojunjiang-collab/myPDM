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
  /** 当前用户在该项目内是否为管理者（admin / owner / 经理成员），仅项目详情接口返回 */
  is_manager?: boolean;
  /** 当前用户在该项目内的角色，非成员为 null，仅项目详情接口返回 */
  my_role_in_project?: '经理' | '成员' | null;
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
  /** 零部件/构型项等实体的主数据 id（跳转详情用），后端 _link_dict 返回 */
  entity_master_id?: string | null;
  /** 零部件/图文档关联的版本号与状态（后端 _link_dict 返回） */
  entity_version?: string | null;
  entity_status?: string | null;
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

/** 交付物汇总：来源任务引用 */
export interface DeliverableTaskRef {
  id: string;
  code: string;
  name: string;
}

/** 交付物汇总：统一条目形状（四类共用） */
export interface DeliverableItem {
  entity_type: string;
  entity_id: string;
  master_id: string | null;
  code: string;
  name: string;
  version: string | null;
  status: string;
  creator_name: string;
  extra: string | null;
  tasks: DeliverableTaskRef[];
}

/** 交付物汇总：接口响应 */
export interface DeliverableSummary {
  counts: { config_items: number; parts: number; documents: number; changes: number };
  config_items: DeliverableItem[];
  parts: DeliverableItem[];
  documents: DeliverableItem[];
  changes: DeliverableItem[];
}

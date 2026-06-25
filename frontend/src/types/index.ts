export type UserRole = 'admin' | 'engineer' | 'production' | 'guest';

export interface User {
  id: string;
  username: string;
  real_name: string;
  role: UserRole;
  department?: string;
  phone?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Part {
  id: string;
  code: string;
  name: string;
  spec?: string;
  version?: string;
  status: 'draft' | 'frozen' | 'released' | 'obsolete';
  remark?: string;
  revision_parent_id?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface Assembly {
  id: string;
  code: string;
  name: string;
  spec?: string;
  version?: string;
  status: 'draft' | 'frozen' | 'released' | 'obsolete';
  remark?: string;
  revision_parent_id?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface Document {
  id: string;
  code: string;
  name: string;
  version?: string;
  status: 'draft' | 'frozen' | 'released' | 'obsolete';
  remark?: string;
  file_name?: string;
  file_id?: string;
  revision_parent_id?: string;
  creator_id?: string;
  creator_name?: string;
  accessible?: boolean;
  group_ids?: string[];
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface DocumentAttachment {
  id: string;
  document_id: string;
  file_name?: string;
  file_size?: number;
  created_at?: string;
}

export interface BOMItem {
  id: string;
  parent_type: 'part' | 'assembly';
  parent_id: string;
  child_type: 'part' | 'assembly';
  child_id: string;
  qty: number;
  created: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface OperationLog {
  id: string;
  user_id: string;
  username: string;
  action: string;
  target_type: string;
  target_id: string;
  detail?: string;
  ip?: string;
  created: string;
}

export interface CustomFieldDefinition {
  id: string;
  name: string;
  field_key: string;
  field_type: 'text' | 'number' | 'select' | 'multiselect';
  options?: string[];
  is_required: boolean;
  applies_to: string[]; // backend: ['part'] / ['component'] / ['part', 'component'] 等数组
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CustomFieldValue {
  field_id: string;
  field_key: string;
  field_name: string;
  field_type: string;
  value: string | number | string[] | null;
}

export interface CustomFieldDef {
  id: string;
  entity_type: string;
  field_name: string;
  field_type: string;
  field_label: string;
  options?: string;
  required: boolean;
  status: 'active' | 'disabled';
}

/** 实体-图文档关联记录 */
export interface EntityDocument {
  id: string;
  entity_type: string;
  entity_id: string;
  document_id: string;
  category?: string;
  sort_order: number;
  created_at: string;
  document: {
    id: string;
    code: string;
    name: string;
    version: string;
    status: string;
    file_name?: string;
    file_id?: string;
  };
}

/** 子项（后端 get_assembly_parts 返回格式） */
export interface AssemblyPartItem {
  id: string;
  childType: 'part' | 'component';
  child_id: string;
  componentId: string | null;
  partId: string | null;
  quantity: number;
  created_at: string;
  child_detail?: {
    id: string;
    code: string;
    name: string;
    spec?: string;
    version?: string;
    status?: string;
  };
}

export interface DashboardStats {
  total_parts: number;
  total_assemblies: number;
  total_documents: number;
  total_users: number;
}

/** BOM对比节点 */
export interface BOMCompareNode {
  key: string;
  level: number;
  sort: string;
  path: string;
  change_type: 'none' | 'add' | 'delete' | 'modify' | 'internal';
  left: {
    id: string;
    child_type: string;
    child_id: string;
    quantity: number;
    detail: {
      code: string;
      name: string;
      spec: string;
      version: string;
      status: string;
    };
  } | null;
  right: {
    id: string;
    child_type: string;
    child_id: string;
    quantity: number;
    detail: {
      code: string;
      name: string;
      spec: string;
      version: string;
      status: string;
    };
  } | null;
}

/** BOM对比响应 */
export interface BOMCompareResponse {
  left_assembly: { id: string; code: string; name: string; spec: string; version: string; status: string; };
  right_assembly: { id: string; code: string; name: string; spec: string; version: string; status: string; };
  comparison: BOMCompareNode[];
  summary: { total: number; added: number; deleted: number; modified: number; internal_changes: number; unchanged: number; };
}

/** BOM反查结果项 */
export interface BOMTraceItem {
  level: number;
  bom_item_id: string;
  parent_assembly: { id: string; code: string; name: string; spec: string; version: string; status: string; } | null;
  parent_part: { id: string; code: string; name: string; spec: string; version: string; status: string; } | null;
  child_entity: { id: string; code: string; name: string; type: string; };
  quantity: number;
}

/** 压缩包内容树节点 */
export interface ArchiveTreeNode {
  name: string;
  path?: string;
  type: 'file' | 'dir';
  size: number;
  compressed_size?: number;
  children?: ArchiveTreeNode[];
}

/** 压缩包内容树 API 响应 */
export interface ArchiveTreeResponse {
  file_name: string;
  total_files: number;
  total_size: number;
  tree: ArchiveTreeNode[];
}

// ECR Types
export interface ECRReviewer {
  user_id: string;
  user_name: string;
  role: string;
  seq: number;
}

export interface ECRRequest {
  id: string;
  ecr_number: string;
  title: string;
  description?: string;
  reason: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  category?: string;
  status: 'draft' | 'reviewing' | 'approved' | 'rejected' | 'closed';
  review_mode: 'all' | 'any';
  creator_id: string;
  creator_name: string;
  reviewers: ECRReviewer[];
  reviewers_count: number;
  approved_count: number;
  affected_count: number;
  document_links: ECRDocumentLink[];
  affected_items?: ECRAffectedItem[];
  created_at: string;
  updated_at: string;
  reviewed_at?: string;
  closed_at?: string;
  eco_id?: string;
}

export interface ECRReviewRecord {
  id: string;
  reviewer_id: string;
  reviewer_name: string;
  decision: 'approved' | 'rejected' | 'returned';
  comment?: string;
  created_at: string;
}

export interface BomImpactNode {
  level?: number;
  entity_type: 'part' | 'assembly';
  entity_id: string;
  entity_code: string;
  entity_name: string;
  entity_version: string;
  quantity: number;
  action: 'upgrade' | 'qty_change' | 'delete' | 'add_existing' | 'add_new' | 'no_change';
  target_version?: string;
  quantity_change?: { from: number; to: number };
  change_description?: string;
  parent_entity_id?: string;
  parent_entity_code?: string;
  parent_target_version?: string;
  is_change_target?: boolean;
  selected?: boolean;
  new_item_type?: string;
  new_item_code?: string;
  new_item_name?: string;
  new_item_spec?: string;
  tree_path?: string;
  tree_connector?: string;
  has_sibling?: boolean;
  is_last_child?: boolean;
}

export interface ECRAffectedItem {
  id: string;
  entity_type: 'part' | 'assembly';
  entity_id: string;
  entity_code: string;
  entity_name: string;
  entity_version: string;
  change_description?: string;
  change_type?: string;
  bom_impact?: {
    upward_chain: BomImpactNode[];
    downward_items: BomImpactNode[];
  };
}

export interface ECRStatusLog {
  id: string;
  from_status?: string;
  to_status: string;
  operator_name: string;
  comment?: string;
  created_at: string;
}

export interface ECRDocumentLink {
  document_id: string;
  document_code: string;
  document_name: string;
  document_version: string;
}

export interface ECRCreateData {
  title: string;
  description?: string;
  reason: string;
  priority: string;
  category?: string;
  reviewers: { user_id: string; seq: number }[];
  review_mode: string;
  document_links: ECRDocumentLink[];
  affected_items?: { entity_type: string; entity_id: string; change_description?: string; change_type?: string }[];
}

export interface ECRListParams {
  page?: number;
  page_size?: number;
  search?: string;
  status?: string;
  priority?: string;
  creator_id?: string;
}

// ECO Types
export interface ECOReviewer {
  user_id: string;
  user_name: string;
  role: string;
  seq: number;
}

export interface ECORequest {
  id: string;
  eco_number: string;
  title: string;
  description?: string;
  reason: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  category?: string;
  status: 'draft' | 'reviewing' | 'approved' | 'rejected' | 'executing' | 'completed' | 'closed';
  review_mode: 'all' | 'any';
  creator_id: string;
  creator_name: string;
  reviewers: ECOReviewer[];
  reviewers_count: number;
  approved_count: number;
  execution_count: number;
  execution_completed_count: number;
  document_links: ECRDocumentLink[];
  execution_items?: ECOExecutionItem[];
  release_items?: Array<{ entity_type: string; entity_id: string; entity_code: string; entity_name: string; entity_version: string }>;
  ecr_id?: string;
  ecr_number?: string;
  created_at: string;
  updated_at: string;
  reviewed_at?: string;
  executed_at?: string;
  closed_at?: string;
}

export interface ECOReviewRecord {
  id: string;
  reviewer_id: string;
  reviewer_name: string;
  decision: 'approved' | 'rejected' | 'returned';
  comment?: string;
  created_at: string;
}

export interface ECOExecutionItem {
  id: string;
  eco_id?: string;
  source: 'ecr' | 'manual';
  affected_item_id?: string;
  entity_type: 'part' | 'assembly';
  entity_id?: string;
  entity_code?: string;
  entity_name: string;
  entity_version?: string;
  action: 'create' | 'upgrade' | 'qty_change' | 'delete' | 'no_change';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  detail?: Record<string, unknown>;
  new_entity_id?: string;
  new_version?: string;
  new_entity_status?: string;
  parent_entity_id?: string;
  parent_new_entity_id?: string;
  error_message?: string;
  sort_order: number;
  executed_at?: string;
}

export interface ECOStatusLog {
  id: string;
  from_status?: string;
  to_status: string;
  operator_name: string;
  comment?: string;
  created_at: string;
}

export interface ECOCreateData {
  title: string;
  description?: string;
  reason: string;
  priority: string;
  category?: string;
  reviewers: { user_id: string; seq: number }[];
  review_mode: string;
  document_links: ECRDocumentLink[];
  ecr_id?: string;
  execution_items?: {
    source?: string;
    entity_type: string;
    entity_name: string;
    action: string;
    entity_id?: string;
    entity_code?: string;
    parent_entity_id?: string;
  }[];
}

export interface ECOListParams {
  page?: number;
  page_size?: number;
  search?: string;
  status?: string;
  priority?: string;
}

// ECO Types
export interface ECOReviewer {
  user_id: string;
  user_name: string;
  role: string;
  seq: number;
}

export interface ECOExecutionItem {
  id: string;
  source: 'ecr' | 'manual';
  entity_type: 'part' | 'assembly';
  entity_id?: string;
  entity_code?: string;
  entity_name: string;
  entity_version?: string;
  action: 'create' | 'upgrade' | 'qty_change' | 'delete' | 'no_change';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  detail?: Record<string, unknown>;
  new_entity_id?: string;
  new_version?: string;
  new_entity_status?: string;
  parent_entity_id?: string;
  parent_new_entity_id?: string;
  error_message?: string;
  sort_order: number;
  executed_at?: string;
}

export interface ECOStatusLog {
  id: string;
  from_status?: string;
  to_status: string;
  operator_name: string;
  comment?: string;
  created_at: string;
}

export interface ECOReviewRecord {
  id: string;
  reviewer_id: string;
  reviewer_name: string;
  decision: 'approved' | 'rejected' | 'returned';
  comment?: string;
  created_at: string;
}

export interface ECORequest {
  id: string;
  eco_number: string;
  ecr_id?: string;
  title: string;
  description?: string;
  reason: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  category?: string;
  status: 'draft' | 'reviewing' | 'approved' | 'rejected' | 'executing' | 'completed' | 'closed';
  review_mode: 'all' | 'any';
  creator_id: string;
  creator_name: string;
  reviewers: ECOReviewer[];
  reviewers_count: number;
  approved_count: number;
  execution_count: number;
  execution_completed_count: number;
  document_links: ECRDocumentLink[];
  execution_items?: ECOExecutionItem[];
  review_records?: ECOReviewRecord[];
  status_logs?: ECOStatusLog[];
  cc_users?: { user_id: string; user_name: string }[];
  created_at: string;
  updated_at: string;
  reviewed_at?: string;
  executed_at?: string;
  closed_at?: string;
}

// ──────────────────────────────────────────
// 构型项管理
// ──────────────────────────────────────────

export interface ConfigurationItem {
  id: string;
  code: string;
  name: string;
  spec?: string;
  remark?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ConfigPartItem {
  id: string;
  configuration_item_id: string;
  part_type: 'part' | 'assembly';
  part_id: string;
  is_required: boolean;
  quantity?: number;
  sort_order: number;
  part_detail?: { id: string; code: string; name: string; version?: string; spec?: string; status?: string };
}

export interface ConfigChildItem {
  id: string;
  parent_id: string;
  child_id: string;
  is_required: boolean;
  quantity?: number;
  sort_order: number;
  has_children?: boolean;
  has_parts?: boolean;
  child_detail?: { id: string; code: string; name: string; spec?: string; status?: string };
}

// ──────────────────────────────────────────
// 构型配置 (Configuration Profile)
// ──────────────────────────────────────────

export interface ProfileReviewer {
  user_id: string;
  user_name?: string;
  role?: string;
  seq?: number;
}

export interface ProfileCcUser {
  user_id: string;
  user_name?: string;
}

export interface ProfileReviewRecord {
  id: string;
  reviewer_id: string;
  reviewer_name?: string;
  decision: 'approved' | 'rejected' | 'returned';
  comment?: string;
  created_at?: string;
}

export interface ProfileStatusLog {
  id: string;
  from_status?: string;
  to_status: string;
  operator_name?: string;
  comment?: string;
  created_at?: string;
}

export type ProfileStatus = 'draft' | 'reviewing' | 'active' | 'rejected' | 'archived';

export interface ConfigurationProfile {
  id: string;
  code: string;
  name: string;
  configuration_item_id: string;
  status: ProfileStatus;
  effectivity_start?: string;
  effectivity_end?: string;
  remark?: string;
  creator_id: string;
  created_at: string;
  updated_at?: string;
  configuration_item?: { id: string; code: string; name: string };
  reviewers?: ProfileReviewer[];
  review_mode?: 'all' | 'any';
  cc_users?: ProfileCcUser[];
  review_records?: ProfileReviewRecord[];
  status_logs?: ProfileStatusLog[];
  submitted_at?: string | null;
  reviewed_at?: string | null;
  archived_at?: string | null;
  reviewer_count?: number;
}

export interface ConfigurationProfileItem {
  id: string;
  profile_id: string;
  source_config_item_id?: string;
  item_type: 'part' | 'assembly';
  item_id: string;
  item_code?: string;
  item_name?: string;
  is_required: boolean;
  is_selected: boolean;
  source_type: 'direct' | 'child';
  sort_order: number;
  source_config_item?: { id: string; code: string; name: string };
}

export interface ConfigTreePart {
  id: string;
  item_id: string;
  item_type: string;
  item_code: string;
  item_name: string;
  item_version?: string;
  item_status?: string;
  is_required: boolean;
  is_selected: boolean;
  quantity?: number;
  source_type: string;
}

export interface ConfigTreeNode {
  id: string;
  code: string;
  name: string;
  is_required: boolean;
  is_selected: boolean;
  quantity?: number;
  parts: ConfigTreePart[];
  children: ConfigTreeNode[];
}

export interface ConfigurationProfileDetail extends ConfigurationProfile {
  items: ConfigurationProfileItem[];
  config_tree?: ConfigTreeNode | null;
}

// ===== Brief types (lightweight for sync/list) =====

export interface PartBrief {
  id: string;
  code: string;
  name: string;
  spec?: string;
  version?: string;
  status: 'draft' | 'frozen' | 'released' | 'obsolete';
  remark?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface AssemblyBrief {
  id: string;
  code: string;
  name: string;
  spec?: string;
  version?: string;
  status: 'draft' | 'frozen' | 'released' | 'obsolete';
  remark?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface DocumentBrief {
  id: string;
  code: string;
  name: string;
  version?: string;
  status: 'draft' | 'frozen' | 'released' | 'obsolete';
  remark?: string;
  file_name?: string;
  file_id?: string;
  accessible?: boolean;
  group_ids?: string[];
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface AssemblyBrief {
  id: string;
  code: string;
  name: string;
  spec?: string;
  version?: string;
  status: 'draft' | 'frozen' | 'released' | 'obsolete';
  remark?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface DocumentBrief {
  id: string;
  code: string;
  name: string;
  version?: string;
  status: 'draft' | 'frozen' | 'released' | 'obsolete';
  remark?: string;
  file_name?: string;
  file_id?: string;
  accessible?: boolean;
  group_ids?: string[];
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface AssemblyBrief {
  id: string;
  code: string;
  name: string;
  spec?: string;
  version?: string;
  status: 'draft' | 'frozen' | 'released' | 'obsolete';
  remark?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface DocumentBrief {
  id: string;
  code: string;
  name: string;
  version?: string;
  status: 'draft' | 'frozen' | 'released' | 'obsolete';
  remark?: string;
  file_name?: string;
  file_id?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface BOMItemBrief {
  id: string;
  parent_type: 'part' | 'assembly';
  parent_id: string;
  child_type: 'part' | 'assembly';
  child_id: string;
  quantity: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

// ===== ECR / ECO / ConfigItem =====

export interface ECRBrief {
  id: string;
  ecr_number: string;
  title: string;
  status: string;
  priority: string;
  creator_name?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface ECOBrief {
  id: string;
  eco_number: string;
  title: string;
  status: string;
  priority: string;
  creator_name?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface ConfigItemBrief {
  id: string;
  code: string;
  name: string;
  spec?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

// ===== Sync status =====
export interface SyncStatus {
  parts: number;
  assemblies: number;
  documents: number;
  bom_items: number;
  ecrs: number;
  ecos: number;
  config_items: number;
}

// ===== 库存管理 =====
export type InvDocType = 'inbound' | 'outbound' | 'transfer' | 'stocktake' | 'adjustment';
export type InvDocStatus = 'draft' | 'reviewing' | 'approved' | 'posted' | 'rejected' | 'cancelled';

export interface Warehouse {
  id: string; code: string; name: string; type?: string;
  default_keeper_id?: string | null; status: string; remark?: string;
}
export interface InvMaterial {
  id: string; code: string; name: string; spec?: string; unit?: string;
  source_type: 'part' | 'assembly' | 'standalone';
  ref_entity_type?: string | null; ref_entity_id?: string | null;
  track_mode: 'quantity' | 'batch'; safety_stock?: number | null; status: string; remark?: string;
}
export interface StockRow {
  material_id: string; material_code: string; material_name: string; unit?: string;
  warehouse_id: string; batch_no: string; quantity: number;
  safety_stock?: number | null; is_low: boolean;
}
export interface InvDocLine {
  id?: string; material_id: string; batch_no: string; quantity: number;
  direction?: 'in' | 'out' | null; book_quantity?: number | null;
  counted_quantity?: number | null; remark?: string;
}
export interface InvReviewer { user_id: string; seq?: number; user_name?: string; role?: string; }
export interface InvDocument {
  id: string; doc_number: string; doc_type: InvDocType; biz_type?: string;
  status: InvDocStatus; warehouse_id?: string | null; to_warehouse_id?: string | null;
  keeper_id?: string | null; keeper_name?: string; creator_id?: string; creator_name?: string;
  reviewers?: InvReviewer[]; review_mode?: 'all' | 'any'; remark?: string;
  lines?: InvDocLine[]; review_records?: any[]; status_logs?: any[];
  created_at?: string; updated_at?: string;
}


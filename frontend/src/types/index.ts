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
  created_at?: string;
  updated_at?: string;
}

export interface Assembly {
  id: string;
  code: string;
  name: string;
  spec?: string;
  version?: string;
  status: 'draft' | 'frozen' | 'released' | 'obsolete';
  remark?: string;
  created_at?: string;
  updated_at?: string;
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
  created_at?: string;
  updated_at?: string;
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
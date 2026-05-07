export type UserRole = 'admin' | 'engineer' | 'production' | 'guest';

export interface User {
  id: string;
  username: string;
  real_name: string;
  role: UserRole;
  dept?: string;
  phone?: string;
  status: 'active' | 'disabled';
  created: string;
  updated: string;
}

export interface Part {
  id: string;
  code: string;
  name: string;
  spec?: string;
  material?: string;
  unit?: string;
  price?: number;
  supplier?: string;
  stock?: number;
  status: 'draft' | 'frozen' | 'released' | 'obsolete';
  remark?: string;
  created: string;
  updated: string;
}

export interface Assembly {
  id: string;
  code: string;
  name: string;
  spec?: string;
  material?: string;
  unit?: string;
  price?: number;
  status: 'draft' | 'frozen' | 'released' | 'obsolete';
  remark?: string;
  created: string;
  updated: string;
}

export interface Document {
  id: string;
  code: string;
  name: string;
  version?: string;
  status: 'draft' | 'frozen' | 'released' | 'obsolete';
  remark?: string;
  created: string;
  updated: string;
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

export interface Attachment {
  id: string;
  doc_id: string;
  filename: string;
  filepath: string;
  filesize: number;
  content_type: string;
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

export interface DashboardStats {
  total_parts: number;
  total_assemblies: number;
  total_documents: number;
  total_users: number;
}
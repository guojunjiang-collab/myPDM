// 状态选项
export const STATUS_OPTIONS = [
  { value: 'draft', label: '草稿', color: 'blue' },
  { value: 'frozen', label: '冻结', color: 'orange' },
  { value: 'released', label: '发布', color: 'green' },
  { value: 'obsolete', label: '作废', color: 'red' },
] as const;

// 角色选项
export const ROLE_OPTIONS = [
  { value: 'admin', label: '管理员', color: 'red' },
  { value: 'engineer', label: '工程师', color: 'blue' },
  { value: 'production', label: '生产人员', color: 'green' },
  { value: 'guest', label: '访客', color: 'gray' },
] as const;

// 用户状态选项
export const USER_STATUS_OPTIONS = [
  { value: 'active', label: '正常', color: 'green' },
  { value: 'disabled', label: '禁用', color: 'red' },
] as const;

// 实体类型
export const ENTITY_TYPES = {
  PART: 'part',
  ASSEMBLY: 'assembly',
  DOCUMENT: 'document',
} as const;

// 分页默认值
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZES = [10, 20, 50, 100];

// API 超时时间
export const API_TIMEOUT = 30000;

// 文件大小限制
export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

// 允许的文件类型
export const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/dxf',
  'image/vnd.dxf',
];
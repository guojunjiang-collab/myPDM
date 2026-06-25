// 应用版本
export const APP_VERSION = 'v1.6.1';

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
  CONFIGURATION: 'configuration',
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

// 版本号序列（排除 I 和 O）
// 基础字符集: A, B, C, D, E, F, G, H, J, K, L, M, N, P, Q, R, S, T, U, V, W, X, Y, Z
const VERSION_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * 将数字转为指定进制的字符串（使用 VERSION_CHARS 作为字符集）
 */
function toBase24(num: number): string {
  if (num < 0) throw new Error('Version number must be non-negative');
  if (num === 0) return VERSION_CHARS[0]; // 'A'
  
  let result = '';
  while (num > 0) {
    num -= 1; // 调整为从 0 开始
    result = VERSION_CHARS[num % 24] + result;
    num = Math.floor(num / 24);
  }
  return result;
}

/**
 * 将版本字符串转为数字（用于比较）
 */
function versionToNumber(version: string): number {
  if (!version || version === 'A') return 0;
  
  let result = 0;
  for (let i = 0; i < version.length; i++) {
    const charIndex = VERSION_CHARS.indexOf(version[i]);
    if (charIndex === -1) throw new Error(`Invalid version character: ${version[i]}`);
    result = result * 24 + (charIndex + 1);
  }
  return result - 1; // 调整为从 0 开始
}

/**
 * 获取指定版本的下一个版本
 * 序列: A, B, C, ... Z, AA, AB, ... AZ, BA, BB, ... ZZ
 */
export function getNextVersion(currentVersion?: string): string {
  const current = currentVersion?.trim().toUpperCase() || 'A';
  const num = versionToNumber(current);
  return toBase24(num + 1);
}

/**
 * 比较两个版本号
 * 返回: -1 (v1 < v2), 0 (v1 === v2), 1 (v1 > v2)
 */
export function compareVersions(v1: string, v2: string): number {
  const num1 = versionToNumber(v1);
  const num2 = versionToNumber(v2);
  if (num1 < num2) return -1;
  if (num1 > num2) return 1;
  return 0;
}
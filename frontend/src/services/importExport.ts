/**
 * 导入导出核心服务
 * 使用现有 API 实现前端侧的导入导出，后端零改动
 * 依赖: xlsx (SheetJS) 用于 Excel 处理
 *        File System Access API 用于文件夹读写（Chrome 86+ / Edge 86+）
 */

import * as XLSX from 'xlsx';

// File System Access API 类型声明（全局扩展）
declare global {
  interface FileSystemDirectoryHandle {
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
    entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>;
  }
  interface FileSystemFileHandle {
    getFile(): Promise<File>;
    createWritable(options?: FileSystemCreateWritableOptions): Promise<FileSystemWritableFileStream>;
  }
  interface FileSystemCreateWritableOptions {
    keepExistingData?: boolean;
  }
  interface FileSystemWritableFileStream extends WritableStream {
    write(data: Blob | BufferSource | string): Promise<void>;
    close(): Promise<void>;
  }
  interface Window {
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite'; startIn?: string }): Promise<FileSystemDirectoryHandle>;
  }
}
import {
  partsApi,
  entityDocumentsApi,
  customFieldsApi,
  usersApi,
  configurationApi,
  configurationProfileApi,
  componentAttachmentsApi,
} from './api';
import type { ComponentAttachment } from './api';
import { useDataStore } from '../stores/data';
import type {
  CustomFieldDefinition,
  CustomFieldValue,
} from '../types';

// ================================================================
// Types
// ================================================================

/** 导入预览行 */
export interface ImportRow {
  status: '新增' | '更新' | '错误';
  code: string;
  name: string;
  version: string;
  remark?: string;
  error?: string;
  /** 导入时携带的完整数据，供确认后执行使用 */
  _data?: Record<string, unknown>;
  /** 自定义字段值 */
  _customFields?: Record<string, unknown>;
  /** 关联图文档信息（导入时使用） */
  _docRelations?: { docCode: string; docVersion: string }[];
  /** BOM 子项相关信息（导入时使用） */
  _bomChildren?: number;
  /** 新创建的 ID（导入过程中填充） */
  _newId?: string;
  /** 构型项：关联零部件数 */
  _partCount?: number;
  /** 构型项：子构型项数 */
  _childCount?: number;
  /** 构型项：关联图文档数 */
  _docCount?: number;
  /** ECR/ECO：受影响对象数 */
  _affectedCount?: number;
  /** ECR/ECO：审批人数 */
  _reviewerCount?: number;
  /** ECO：执行明细数 */
  _execCount?: number;
  /** ECO 来源 ECR 编号（警告用） */
  _ecrNumber?: string;
  /** 构型配置关联构型项编号（警告用） */
  _ciCode?: string;
  /** 构型配置：正式清单项数 */
  _itemCount?: number;
}

/** 导入预览结果 */
export interface ImportPreview {
  type: 'part' | 'assembly' | 'document' | 'user' | 'dashboard' | 'configuration_item' | 'configuration_profile' | 'ecr' | 'eco';
  rows: ImportRow[];
  /** 关联图文档未找到数 */
  docWarnings?: number;
  /** BOM 文件数 */
  bomFiles?: number;
  /** BOM 匹配数 */
  bomMatched?: number;
  /** 关联图文档数 */
  docRelationCount?: number;
  /** 用户看板导入数据（看板导入时使用） */
  _dashboardData?: unknown[];
  /** 构型项：关联零部件未找到数 */
  partWarnings?: number;
  /** 构型项：子构型项未找到数 */
  childWarnings?: number;
  /** 构型项：关联零部件总数 */
  partRelationCount?: number;
  /** 构型项：子构型项总数 */
  childRelationCount?: number;
  /** ECR/ECO：受影响对象未找到数 */
  affectedWarnings?: number;
  /** ECR/ECO：审批人未找到数 */
  reviewerWarnings?: number;
  /** ECR/ECO：知会人未找到数 */
  ccWarnings?: number;
  /** ECR/ECO：受影响对象总数 */
  affectedCount?: number;
  /** ECR/ECO：审批人总数 */
  reviewerCount?: number;
  /** ECO：执行明细总数 */
  execItemCount?: number;
  /** ECO：执行明细未找到数 */
  execItemWarnings?: number;
  /** ECO：来源 ECR 未找到数 */
  ecrWarnings?: number;
  /** 构型配置：清单项总数 */
  profileItemCount?: number;
  /** 构型配置：关联构型项未找到数 */
  ciWarnings?: number;
  /** 构型项：子构型项 sheet 中父构型号不存在于构型项清单 */
  orphanParentCodes?: string[];
  /** 构型项：子构型项 sheet 中子构型号不存在于构型项清单 */
  orphanChildCodes?: string[];
}

// ================================================================
// Utilities
// ================================================================

/** 检查 File System Access API 是否可用 */
function supportsFileSystemAccess(): boolean {
  return 'showDirectoryPicker' in window;
}

/** 触发浏览器下载 Blob */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 状态英文→中文映射 */
const STATUS_EN_TO_ZH: Record<string, string> = {
  draft: '草稿',
  frozen: '冻结',
  released: '发布',
  obsolete: '作废',
};

/** 将状态转为中文 */
function statusToZh(s: string | undefined | null): string {
  return STATUS_EN_TO_ZH[s || ''] || s || 'draft';
}

/** 获取今天的日期字符串 YYYYMMDD */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** 分页拉取全部列表数据（后端 page_size 上限 100） */
async function fetchAllPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<{ items: T[]; total: number }>,
  pageSize = 100,
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  for (;;) {
    const res = await fetchPage(page, pageSize);
    const items: T[] = res.items || [];
    all.push(...items);
    const total = res.total ?? all.length;
    if (all.length >= total || items.length === 0) break;
    page += 1;
  }
  return all;
}

/**
 * 批量导入/导出的并发上限。一次性 Promise.all 扇出成百上千请求会触发
 * nginx 限流（被拒的请求表现为 4xx/5xx），故统一改为受限并发分批执行。
 */
const BATCH_CONCURRENCY = 20;

/**
 * 受限并发执行：同时最多 limit 个任务在飞行，结果保留输入顺序。
 * 语义同 Promise.all（任一任务抛出则整体抛出）。
 */
async function mapLimit<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  limit = BATCH_CONCURRENCY,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

/** 同 mapLimit，但语义同 Promise.allSettled：单个任务失败不影响其它。 */
async function mapLimitSettled<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  limit = BATCH_CONCURRENCY,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

/** 写入 Blob 到目录中的文件 */
async function writeBlobToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
  blob: Blob,
) {
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

// ================================================================
// Custom Field Helpers
// ================================================================

/** 获取适用于指定实体类型的自定义字段定义 */
function getCustomFieldDefs(entityType: string): CustomFieldDefinition[] {
  return useDataStore
    .getState()
    .customFieldDefs.filter((d) => d.applies_to?.includes(entityType));
}

/** 批量加载自定义字段值 */
async function loadCustomFieldValues(
  entityType: string,
  entityIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  const results = await mapLimitSettled(entityIds, (id) =>
    customFieldsApi.getValues(entityType, id),
  );
  results.forEach((res, idx) => {
    if (res.status === 'fulfilled') {
      const values: Record<string, unknown> = {};
      (res.value.data || []).forEach((v: CustomFieldValue) => {
        values[v.field_id] = v.value;
      });
      map.set(entityIds[idx], values);
    }
  });
  return map;
}

/** 获取适用于指定实体类型的自定义字段列名集合 */
function getCustomFieldColumnNames(entityType: string): string[] {
  return getCustomFieldDefs(entityType).map((d) => d.name);
}

// ================================================================
// Entity-Document Relation Helpers
// ================================================================

/** 批量加载实体的关联图文档 */
async function loadEntityDocuments(
  entityType: 'part' | 'assembly' | 'component',
  entityIds: string[],
): Promise<Map<string, any[]>> {
  const map = new Map<string, any[]>();
  const results = await mapLimitSettled(entityIds, (id) =>
    entityDocumentsApi.list(entityType, id),
  );
  results.forEach((res, idx) => {
    if (res.status === 'fulfilled') {
      map.set(entityIds[idx], res.value.data || []);
    } else {
      map.set(entityIds[idx], []);
    }
  });
  return map;
}

// ================================================================
// PART EXPORT
// ================================================================

/**
 * 构建零件导出的 Excel workbook（共享数据准备逻辑）
 * 包含 Sheet1: 零件数据, Sheet2: 关联图文档
 */
async function _buildPartsWorkbook(): Promise<XLSX.WorkBook> {
  const parts = useDataStore.getState().parts.filter(c => c.type !== 'assembly');
  if (parts.length === 0) {
    throw new Error('没有可导出的零件数据');
  }

  const defs = getCustomFieldDefs('part');
  const partIds = parts.map((p) => p.id);
  const [cfValuesMap, docMap] = await Promise.all([
    defs.length > 0 ? loadCustomFieldValues('part', partIds) : Promise.resolve(new Map()),
    loadEntityDocuments('part', partIds),
  ]);

  // Sheet 1: 零件数据
  const sheet1Rows = parts.map((p) => {
    const row: Record<string, unknown> = {
      件号: p.code,
      中文名称: p.name,
      规格型号: p.spec || '',
      版本: p.version || '',
      状态: statusToZh(p.status),
      备注: p.remark || '',
      创建时间: p.created_at || '',
      更新时间: p.updated_at || '',
    };
    const cfValues = cfValuesMap.get(p.id);
    if (cfValues) {
      for (const def of defs) {
        row[def.name] = cfValues[def.id] ?? '';
      }
    }
    return row;
  });

  // Sheet 2: 关联图文档
  const sheet2Rows: Record<string, unknown>[] = [];
  for (const part of parts) {
    const docs = docMap.get(part.id) || [];
    if (docs.length === 0) {
      sheet2Rows.push({ 件号: part.code, 零件版本: part.version || '' });
    } else {
      for (const ed of docs) {
        sheet2Rows.push({
          件号: part.code,
          零件版本: part.version || '',
          图文档编号: ed.document?.code || '',
          图文档名称: ed.document?.name || '',
          图文档版本: ed.document?.version || '',
          图文档状态: ed.document?.status || '',
        });
      }
    }
  }

  const wb = XLSX.utils.book_new();
  const s1 = XLSX.utils.json_to_sheet(sheet1Rows);
  s1['!cols'] = [
    { wch: 18 }, { wch: 24 }, { wch: 20 }, { wch: 8 },
    { wch: 10 }, { wch: 30 }, { wch: 20 }, { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, s1, '零件数据');

  if (sheet2Rows.length > 0) {
    const s2 = XLSX.utils.json_to_sheet(sheet2Rows);
    s2['!cols'] = [
      { wch: 18 }, { wch: 10 }, { wch: 20 }, { wch: 30 }, { wch: 10 }, { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb, s2, '关联图文档');
  }

  // CAD附件 / 生产附件 Sheets
  const cadAttMap = new Map<string, ComponentAttachment[]>();
  const prodAttMap = new Map<string, ComponentAttachment[]>();
  for (const p of parts) {
    try { const r = await componentAttachmentsApi.list(p.id, 'cad'); if (r.data?.length) cadAttMap.set(p.id, r.data); } catch { /* skip */ }
    try { const r = await componentAttachmentsApi.list(p.id, 'production'); if (r.data?.length) prodAttMap.set(p.id, r.data); } catch { /* skip */ }
  }
  const cadRows: Record<string, unknown>[] = [];
  for (const p of parts) {
    for (const att of cadAttMap.get(p.id) || []) cadRows.push({ 件号: p.code, 版本: p.version || '', 文件名: att.file_name, 大小: att.file_size ?? '' });
  }
  if (cadRows.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cadRows), 'CAD附件');
  const prodRows: Record<string, unknown>[] = [];
  for (const p of parts) {
    for (const att of prodAttMap.get(p.id) || []) prodRows.push({ 件号: p.code, 版本: p.version || '', 文件名: att.file_name, 大小: att.file_size ?? '' });
  }
  if (prodRows.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prodRows), '生产附件');

  return wb;
}

/**
 * 导出零件为 Excel 文件（下载到浏览器）
 * 包含 Sheet1: 零件数据, Sheet2: 关联图文档
 */
export async function exportPartsExcel(): Promise<void> {
  const wb = await _buildPartsWorkbook();
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, `零件清单_${todayStr()}.xlsx`);
}

// ================================================================
// ASSEMBLY EXPORT
// ================================================================

/** BOM 树中的一行 */
interface BOMRow {
  层级: number;
  类型: string;
  件号: string;
  中文名称: string;
  规格型号: string;
  版本: string;
  状态: string;
  用量: number;
}

interface BOMEntityRef {
  type: 'part' | 'component';
  id: string;
}

/** 递归收集 BOM 树，同时返回实体引用用于自定义字段加载 */
async function gatherBOMTree(
  revisionId: string,
  level: number = 1,
): Promise<{ rows: BOMRow[]; refs: BOMEntityRef[] }> {
  const rows: BOMRow[] = [];
  const refs: BOMEntityRef[] = [];
  try {
    const items = await partsApi.getBOM(revisionId) || [];

    for (const item of items) {
      refs.push({ type: item.child_type === 'part' ? 'part' : 'component', id: item.child_master_id || '' });
      rows.push({
        层级: level,
        类型: item.child_type === 'part' ? '零件' : '部件',
        件号: item.child_code || '',
        中文名称: item.child_name || '',
        规格型号: item.child_spec || '',
        版本: item.child_version || '',
        状态: statusToZh(item.child_status),
        用量: item.quantity,
      });

      // 如果是部件，递归收集子项
      if (item.child_type === 'assembly' && item.has_children && item.child_revision_id) {
        const child = await gatherBOMTree(item.child_revision_id, level + 1);
        rows.push(...child.rows);
        refs.push(...child.refs);
      }
    }
  } catch (err) {
    console.error(`获取 BOM 树失败: ${revisionId}`, err);
  }
  return { rows, refs };
}

/**
 * 导出单个部件的完整信息
 * 包含 Sheet1: 部件信息(含自定义字段), Sheet2: BOM(含自定义字段), Sheet3: 关联图文档
 */
export async function exportSingleAssemblyBOM(assemblyId: string): Promise<void> {
  const allComps = useDataStore.getState().parts;
  const asm = allComps.find((a) => a.id === assemblyId);
  if (!asm) {
    throw new Error('未找到该部件');
  }

  const asmDefs = getCustomFieldDefs('component');
  const [cfValuesMap, docMap, bomResult] = await Promise.all([
    asmDefs.length > 0 ? loadCustomFieldValues('component', [asm.id]) : Promise.resolve(new Map()),
    loadEntityDocuments('component', [asm.id]),
    gatherBOMTree((asm as any).revision_id || asm.id),
  ]);
  const bomRows = bomResult.rows;
  const bomRefs = bomResult.refs;

  const cfValues = cfValuesMap.get(asm.id) || {};

  // Sheet 1: 部件信息(含自定义字段)
  const infoRow: Record<string, unknown> = {
    件号: asm.code,
    中文名称: asm.name,
    规格型号: asm.spec || '',
    版本: asm.version || '',
    状态: statusToZh(asm.status),
    备注: asm.remark || '',
    创建时间: asm.created_at || '',
    更新时间: asm.updated_at || '',
  };
  for (const def of asmDefs) {
    infoRow[def.name] = cfValues[def.id] ?? '';
  }

  // Sheet 2: BOM (含自定义字段)
  // 自身上级行
  const selfRow: BOMRow = {
    层级: 0,
    类型: '部件',
    件号: asm.code,
    中文名称: asm.name,
    规格型号: asm.spec || '',
    版本: asm.version || '',
    状态: statusToZh(asm.status),
    用量: 1,
  };
  const allBomRows = [selfRow, ...bomRows];

  // 收集 BOM 中所有实体的 ID（按类型分组）
  // selfRow 是自身部件，#0 对应 asm.id / 'component'
  // bomRefs[i] 对应 allBomRows[i+1]
  const partIds: string[] = [];
  const componentIds: string[] = [asm.id]; // 自身
  for (const ref of bomRefs) {
    if (ref.id) {
      if (ref.type === 'part') partIds.push(ref.id);
      else componentIds.push(ref.id);
    }
  }

  // 加载零件和部件的自定义字段
  const partDefs = getCustomFieldDefs('part');
  const allDefs = [...asmDefs, ...partDefs];
  const [partCfMap, compCfMap] = await Promise.all([
    partIds.length > 0 && partDefs.length > 0
      ? loadCustomFieldValues('part', partIds)
      : Promise.resolve(new Map()),
    componentIds.length > 0 && asmDefs.length > 0
      ? loadCustomFieldValues('component', componentIds)
      : Promise.resolve(new Map()),
  ]);

  // 构建 BOM 行 → 实体信息的索引
  const entityInfo: { type: string; id: string }[] = [
    { type: 'component', id: asm.id }, // selfRow
    ...bomRefs.map(r => ({ type: r.type, id: r.id })),
  ];

  // 构建带自定义字段的 BOM 行
  const bomSheetRows: Record<string, unknown>[] = allBomRows.map((row, idx) => {
    const r: Record<string, unknown> = {
      层级: row.层级,
      类型: row.类型,
      件号: row.件号,
      中文名称: row.中文名称,
      规格型号: row.规格型号,
      版本: row.版本,
      状态: row.状态,
      用量: row.用量,
    };

    // 填充该实体类型的自定义字段
    const info = entityInfo[idx] || { type: 'component', id: '' };
    const defsForType = info.type === 'part' ? partDefs : asmDefs;
    const cfMap = info.type === 'part' ? partCfMap : compCfMap;
    if (info.id && defsForType.length > 0) {
      const values = cfMap.get(info.id) || {};
      for (const def of defsForType) {
        r[def.name] = values[def.id] ?? '';
      }
    }

    // 对于该实体不存在的字段类型，填充空值
    const otherDefs = info.type === 'part' ? asmDefs : partDefs;
    for (const def of otherDefs) {
      if (!(def.name in r)) {
        r[def.name] = '';
      }
    }

    return r;
  });

  // Sheet 3: 关联图文档
  const docs = docMap.get(asm.id) || [];
  const docRows: Record<string, unknown>[] = [];
  if (docs.length === 0) {
    docRows.push({ 件号: asm.code, 部件版本: asm.version || '' });
  } else {
    for (const ed of docs) {
      docRows.push({
        件号: asm.code,
        部件版本: asm.version || '',
        图文档编号: ed.document?.code || '',
        图文档名称: ed.document?.name || '',
        图文档版本: ed.document?.version || '',
      });
    }
  }

  const wb = XLSX.utils.book_new();

  const s1 = XLSX.utils.json_to_sheet([infoRow]);
  XLSX.utils.book_append_sheet(wb, s1, '部件信息');

  const s2 = XLSX.utils.json_to_sheet(bomSheetRows);
  const baseCols = 8;
  const cfColCount = allDefs.length;
  const s2Cols = Array.from({ length: baseCols + cfColCount }, (_, i) => {
    if (i < baseCols) {
      return { wch: [6, 8, 18, 24, 20, 8, 8, 8][i] };
    }
    return { wch: 16 };
  });
  s2['!cols'] = s2Cols;
  XLSX.utils.book_append_sheet(wb, s2, 'BOM');

  if (docRows.length > 0) {
    const s3 = XLSX.utils.json_to_sheet(docRows);
    s3['!cols'] = [
      { wch: 18 }, { wch: 10 }, { wch: 20 }, { wch: 30 }, { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb, s3, '关联图文档');
  }

  // Sheet 4/5: CAD附件 / 生产附件
  const cadRows: Record<string, unknown>[] = [];
  const prodRows: Record<string, unknown>[] = [];
  try {
    const cadRes = await componentAttachmentsApi.list(asm.id, 'cad');
    for (const att of cadRes.data || []) cadRows.push({ 文件名: att.file_name, 大小: att.file_size ?? '' });
  } catch { /* skip */ }
  try {
    const prodRes = await componentAttachmentsApi.list(asm.id, 'production');
    for (const att of prodRes.data || []) prodRows.push({ 文件名: att.file_name, 大小: att.file_size ?? '' });
  } catch { /* skip */ }
  if (cadRows.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cadRows), 'CAD附件');
  if (prodRows.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prodRows), '生产附件');

  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const filename = `BOM_${asm.code}_${asm.version || 'A'}.xlsx`;
  downloadBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  );
}

/**
 * 重新打开目录用于导入执行阶段
 * 因为浏览器安全限制，用户需要在执行阶段再次选择文件夹
 */
export async function pickDirectoryForImport(): Promise<FileSystemDirectoryHandle> {
  if (!supportsFileSystemAccess()) {
    throw new Error('您的浏览器不支持文件夹操作，请使用 Chrome 86+ 或 Edge 86+');
  }
  return await window.showDirectoryPicker({ mode: 'read' });
}

// ================================================================
// CUSTOM FIELD DEFS EXPORT
// ================================================================

/**
 * 导出自定义字段定义到指定目录
 */
export async function exportCustomFieldDefs(dirHandle?: FileSystemDirectoryHandle): Promise<void> {
  const defs = useDataStore.getState().customFieldDefs;
  if (defs.length === 0) return;

  const handle = dirHandle || (supportsFileSystemAccess()
    ? await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' })
    : null);

  // 字段定义
  const defRows = defs.map((d) => ({
    字段名称: d.name,
    字段标识: d.field_key,
    字段类型: d.field_type === 'text' ? '单行文本' : d.field_type === 'number' ? '数字' : '下拉选择',
     选项: (d.options || []).join('_'),
     是否必填: d.is_required ? '是' : '否',
     适用类型: (Array.isArray(d.applies_to) ? d.applies_to : [d.applies_to])
       .map((t: string) => t === 'part' ? '零件' : t === 'component' ? '部件' : '图文档')
       .join('_'),
    排序: d.sort_order,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(defRows);
  ws['!cols'] = [
    { wch: 16 }, { wch: 18 }, { wch: 12 }, { wch: 30 },
    { wch: 10 }, { wch: 20 }, { wch: 8 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, '字段定义');

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  if (handle) {
    await writeBlobToDirectory(handle, '自定义字段定义.xlsx', blob);
  } else {
    downloadBlob(blob, `自定义字段定义_${todayStr()}.xlsx`);
  }
}

/**
 * 从 Excel 文件导入自定义字段定义
 * 字段标识相同则更新，否则新增
 */
export async function importCustomFieldDefs(file: File): Promise<{ created: number; updated: number }> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets['字段定义'];
  if (!ws) throw new Error('未找到"字段定义" Sheet，请确认文件格式正确');

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
  if (rows.length === 0) throw new Error('文件中无字段定义数据');

  const existingDefs = useDataStore.getState().customFieldDefs;
  const existingMap = new Map<string, CustomFieldDefinition>();
  for (const d of existingDefs) {
    existingMap.set(d.field_key, d);
  }

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const name = String(row['字段名称'] || '').trim();
    const fieldKey = String(row['字段标识'] || '').trim();
    const fieldTypeRaw = String(row['字段类型'] || '').trim();

    if (!name || !fieldKey) continue;

    const fieldTypeMap: Record<string, string> = {
      '单行文本': 'text', '数字': 'number', '下拉选择': 'select',
    };
    const fieldType = fieldTypeMap[fieldTypeRaw] || 'text';

    const optionsRaw = String(row['选项'] || '');
    const options = optionsRaw ? optionsRaw.split('_').map(s => s.trim()).filter(Boolean) : [];

    const isRequired = String(row['是否必填'] || '').trim() === '是';

    const appliesToRaw = String(row['适用类型'] || '');
    const appliesToMap: Record<string, string> = {
      '零件': 'part', '部件': 'component', '图文档': 'document',
    };
    const appliesTo = appliesToRaw
      ? appliesToRaw.split('_').map(s => appliesToMap[s.trim()] || s.trim()).filter(Boolean)
      : ['part'];

    const sortOrder = Number(row['排序']) || 0;

    const payload = {
      name,
      field_key: fieldKey,
      field_type: fieldType,
      options,
      is_required: isRequired,
      applies_to: appliesTo,
      sort_order: sortOrder,
    };

    const existing = existingMap.get(fieldKey);
    if (existing) {
      await customFieldsApi.updateDefinition(existing.id, payload);
      updated++;
    } else {
      await customFieldsApi.createDefinition(payload);
      created++;
    }
  }

  // 刷新 store
  const res = await customFieldsApi.listDefinitions();
  useDataStore.getState().setCustomFieldDefs(Array.isArray(res.data) ? res.data : []);

  return { created, updated };
}

/** 角色中文→英文映射 */
const ROLE_ZH_TO_EN: Record<string, string> = {
  '管理员': 'admin',
  '工程师': 'engineer',
  '生产人员': 'production',
  '访客': 'guest',
};

/** 用户状态中文→英文 */
const USER_STATUS_ZH_TO_EN: Record<string, string> = {
  '启用': 'active',
  '禁用': 'inactive',
};

// ================================================================
// USER IMPORT
// ================================================================

/**
 * 预览用户导入
 */
export async function previewUsersImport(file: File): Promise<ImportPreview> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });

  const ws = wb.Sheets['用户清单'] || wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('Excel 中未找到用户数据 Sheet');

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
  if (rawRows.length === 0) throw new Error('Excel 中无用户数据');

  // 获取现有用户列表（按用户名索引）
  const existingRes = await usersApi.list({ page_size: 10000 });
  const existingAll = (existingRes.data as { items?: unknown[] } | unknown[]) || [];
  const existingList: any[] = Array.isArray(existingAll)
    ? existingAll
    : (existingAll as { items?: unknown[] }).items || [];
  const existingMap = new Map<string, any>();
  for (const u of existingList) {
    existingMap.set(u.username, u);
  }

  const rows: ImportRow[] = rawRows.map((raw) => {
    const username = String(raw['用户名'] || '').trim();
    const name = String(raw['姓名'] || '').trim();

    if (!username) {
      return {
        status: '错误' as const,
        code: username,
        name,
        version: '',
        error: '缺少必填字段（用户名）',
      };
    }

    const existing = existingMap.get(username);
    const status = existing ? ('更新' as const) : ('新增' as const);

    const roleZh = String(raw['角色'] || '').trim();
    const roleEn = ROLE_ZH_TO_EN[roleZh] || roleZh.toLowerCase();

    const statusZh = String(raw['状态'] || '').trim();
    const statusEn = USER_STATUS_ZH_TO_EN[statusZh] || 'active';

    return {
      status,
      code: username,
      name,
      version: '',
      remark: String(raw['部门'] || ''),
      _data: existing
        ? { username, id: existing.id }
        : {
            username,
            password: '123456',
            real_name: name,
            role: roleEn,
            department: String(raw['部门'] || ''),
            phone: String(raw['电话'] || ''),
            status: statusEn,
          } as Record<string, unknown>,
    };
  });

  return {
    type: 'user',
    rows,
  };
}

/**
 * 执行用户导入
 */
export async function executeUsersImport(preview: ImportPreview): Promise<void> {
  const results = await mapLimitSettled(
    preview.rows.filter((r) => r.status !== '错误'),
    async (row) => {
        const data = row._data!;
        try {
          if (row.status === '更新') {
            // 更新：只更新非密码字段
            const existingRes = await usersApi.list({ page_size: 10000 });
            const existingAll = (existingRes.data as { items?: unknown[] } | unknown[]) || [];
            const existingList: any[] = Array.isArray(existingAll)
              ? existingAll
              : (existingAll as { items?: unknown[] }).items || [];
            const existing = existingList.find((u: any) => u.username === row.code);
            if (existing) {
              await usersApi.update(existing.id, {
                real_name: data.real_name,
                role: data.role,
                department: data.department,
                phone: data.phone,
                status: data.status,
              });
            }
          } else {
            // 新增
            await usersApi.create(data);
          }
        } catch (err: any) {
          console.error(`导入用户失败: ${row.code}`, err);
          throw err;
        }
        return null;
      },
  );

  const errors = results.filter((r) => r.status === 'rejected');
  if (errors.length > 0) {
    throw new Error(`用户导入完成，但有 ${errors.length} 条记录导入失败（请查看控制台日志）`);
  }
}

// ================================================================
// CONFIGURATION ITEM EXPORT
// ================================================================

/**
 * 导出构型项为 Excel 文件
 * Sheet1: 构型项清单, Sheet2: 关联零部件, Sheet3: 子构型项, Sheet4: 关联图文档
 */
/**
 * 构建构型项导出工作簿（共享逻辑）
 * Sheet1: 构型项清单, Sheet2: 关联零部件, Sheet3: 子构型项, Sheet4: 关联图文档
 * 无数据返回 null
 */
async function _buildConfigItemsWorkbook(): Promise<XLSX.WorkBook | null> {
  const items: any[] = await fetchAllPages((page, pageSize) =>
    configurationApi.listItems({ page, page_size: pageSize }).then((r) => r.data),
  );
  if (items.length === 0) return null;

  // 并发获取每个构型项的详情（含关联数据）
  const details = await mapLimit(items, (i: any) => configurationApi.getItem(i.id));
  const detailData: any[] = details.map((r: any) => r.data);

  // 加载自定义字段
  const cfDefs = getCustomFieldDefs('configuration_item');
  const itemIds = items.map((i: any) => i.id);
  const cfValuesMap = cfDefs.length > 0
    ? await loadCustomFieldValues('configuration_item', itemIds)
    : new Map<string, Record<string, unknown>>();

  // Sheet1: 构型项清单
  const sheet1Rows = detailData.map((d: any) => {
    const row: Record<string, unknown> = {
      构型号: d.code || '',
      名称: d.name || '',
      备注: d.remark || '',
      创建时间: d.created_at || '',
      更新时间: d.updated_at || '',
    };
    const cfValues = cfValuesMap.get(d.id);
    if (cfValues) {
      for (const def of cfDefs) {
        row[def.name] = cfValues[def.id] ?? '';
      }
    }
    return row;
  });

  // Sheet2: 关联零部件（件号/版本取自 part_detail）
  const sheet2Rows: Record<string, unknown>[] = [];
  for (const d of detailData) {
    for (const p of d.parts || []) {
      sheet2Rows.push({
        构型号: d.code,
        零部件类型: p.part_type || 'part',
        零部件件号: p.part_detail?.code || '',
        零部件版本: p.part_detail?.version || '',
        用量: p.quantity ?? 1,
        是否必选: p.is_required ? 'TRUE' : 'FALSE',
      });
    }
  }

  // Sheet3: 子构型项（子构型号取自 child_detail）
  const sheet3Rows: Record<string, unknown>[] = [];
  for (const d of detailData) {
    for (const c of d.children || []) {
      sheet3Rows.push({
        父构型号: d.code,
        子构型号: c.child_detail?.code || '',
        用量: c.quantity ?? 1,
        是否必选: c.is_required ? 'TRUE' : 'FALSE',
      });
    }
  }

  // Sheet4: 关联图文档（后端字段为 documents，编号/版本取自 document）
  const sheet4Rows: Record<string, unknown>[] = [];
  for (const d of detailData) {
    for (const doc of d.documents || []) {
      sheet4Rows.push({
        构型号: d.code,
        图文档编号: doc.document?.code || '',
        图文档版本: doc.document?.version || '',
      });
    }
  }

  const wb = XLSX.utils.book_new();

  const s1 = XLSX.utils.json_to_sheet(sheet1Rows);
  s1['!cols'] = [{ wch: 20 }, { wch: 24 }, { wch: 30 }, { wch: 20 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, s1, '构型项清单');

  if (sheet2Rows.length > 0) {
    const s2 = XLSX.utils.json_to_sheet(sheet2Rows);
    s2['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 20 }, { wch: 12 }, { wch: 8 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, s2, '关联零部件');
  }

  if (sheet3Rows.length > 0) {
    const s3 = XLSX.utils.json_to_sheet(sheet3Rows);
    s3['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 8 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, s3, '子构型项');
  }

  if (sheet4Rows.length > 0) {
    const s4 = XLSX.utils.json_to_sheet(sheet4Rows);
    s4['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, s4, '关联图文档');
  }

  return wb;
}

export async function exportConfigurationItems(): Promise<void> {
  const wb = await _buildConfigItemsWorkbook();
  if (!wb) throw new Error('没有可导出的构型项数据');
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, `构型项数据_${todayStr()}.xlsx`);
}

// ================================================================
// CONFIGURATION PROFILE EXPORT / IMPORT
// ================================================================

/**
 * 导出构型配置
 */
/**
 * 构建构型配置导出工作簿（共享逻辑）
 * Sheet1: 配置清单, Sheet2: 配置清单项
 * 无数据返回 null
 */
async function _buildConfigProfilesWorkbook(): Promise<XLSX.WorkBook | null> {
  const profiles: any[] = await fetchAllPages((page, pageSize) =>
    configurationProfileApi.list({ page, page_size: pageSize }).then((r) => r.data),
  );
  if (profiles.length === 0) return null;

  // 构型项 id→code 映射，用于还原清单项的来源构型号
  const ciItems: any[] = await fetchAllPages((page, pageSize) =>
    configurationApi.listItems({ page, page_size: pageSize }).then((r) => r.data),
  );
  const ciIdToCode = new Map<string, string>();
  for (const ci of ciItems) ciIdToCode.set(String(ci.id), ci.code);

  // 并发获取每个 Profile 的详情（含完整配置清单 items，每项带真实 is_selected）
  const details = await mapLimit(profiles, (p: any) => configurationProfileApi.get(p.id));
  const detailData: any[] = details.map((r: any) => r.data);

  // Sheet1: 配置清单
  const sheet1Rows = detailData.map((d: any) => ({
    配置编号: d.code || '',
    配置名称: d.name || '',
    关联构型号: d.configuration_item?.code || d.configuration_item_code || '',
    状态: d.status || '',
    起始架次号: d.effectivity_start || '',
    结束架次号: d.effectivity_end || '',
    备注: d.remark || '',
    创建时间: d.created_at || '',
    更新时间: d.updated_at || '',
  }));

  // Sheet2: 配置清单项（导出完整工作清单 items，含未选中项，是否选用按真实 is_selected）
  const sheet2Rows: Record<string, unknown>[] = [];
  for (const d of detailData) {
    for (const it of d.items || []) {
      sheet2Rows.push({
        配置编号: d.code,
        来源构型号: it.source_config_item_id
          ? ciIdToCode.get(String(it.source_config_item_id)) || ''
          : '',
        项类型: it.item_type || '',
        项编号: it.item_code || '',
        项名称: it.item_name || '',
        是否必选: it.is_required ? 'TRUE' : 'FALSE',
        是否选用: it.is_selected ? 'TRUE' : 'FALSE',
        来源类型: it.source_type || '',
        排序: it.sort_order ?? 0,
      });
    }
  }

  const wb = XLSX.utils.book_new();

  const s1 = XLSX.utils.json_to_sheet(sheet1Rows);
  s1['!cols'] = [
    { wch: 20 }, { wch: 24 }, { wch: 20 }, { wch: 10 },
    { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 20 }, { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, s1, '配置清单');

  if (sheet2Rows.length > 0) {
    const s2 = XLSX.utils.json_to_sheet(sheet2Rows);
    s2['!cols'] = [
      { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 20 },
      { wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 8 },
    ];
    XLSX.utils.book_append_sheet(wb, s2, '配置清单项');
  }

  return wb;
}

export async function exportConfigurationProfiles(): Promise<void> {
  const wb = await _buildConfigProfilesWorkbook();
  if (!wb) throw new Error('没有可导出的构型配置数据');
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, `构型配置数据_${todayStr()}.xlsx`);
}

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
import api, {
  partsApi,
  assembliesApi,
  documentsApi,
  entityDocumentsApi,
  assemblyPartsApi,
  customFieldsApi,
  usersApi,
  configurationApi,
  configurationProfileApi,
  ecrApi,
  ecoApi,
} from './api';
import { useDataStore } from '../stores/data';
import type {
  Part,
  Assembly,
  Document,
  CustomFieldDefinition,
  CustomFieldValue,
  AssemblyPartItem,
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

/** 导入执行结果汇总 */
export interface ImportResult {
  created: number;
  updated: number;
  /** 关联引用未找到等告警信息 */
  warnings: string[];
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

/** 实体类型 中英文 映射 */
const ENTITY_TYPE_TO_ZH: Record<string, string> = {
  part: '零件',
  assembly: '部件',
  document: '图文档',
  configuration: '构型项',
};
const ENTITY_TYPE_FROM_ZH: Record<string, string> = {
  '零件': 'part',
  '部件': 'assembly',
  '图文档': 'document',
  '构型项': 'configuration',
};

/** 存储导入时的目录句柄（在 preview 阶段打开，execute 阶段复用） */
let _importDirHandle: FileSystemDirectoryHandle | null = null;

/** 获取存储的目录句柄 */
export function getImportDirHandle(): FileSystemDirectoryHandle | null {
  return _importDirHandle;
}

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

/** 状态中文→英文映射 */
const STATUS_ZH_TO_EN: Record<string, string> = {
  '草稿': 'draft',
  '冻结': 'frozen',
  '发布': 'released',
  '作废': 'obsolete',
};

/** 将状态转为中文 */
function statusToZh(s: string | undefined | null): string {
  return STATUS_EN_TO_ZH[s || ''] || s || 'draft';
}

/** 将中文状态转为英文 */
function statusFromZh(s: string | undefined | null): string {
  return STATUS_ZH_TO_EN[(s || '').trim()] || (s || 'draft');
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

/** 将文件 handle 读取为 ArrayBuffer */
async function readFileAsBuffer(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<ArrayBuffer | null> {
  try {
    const fileHandle = await dirHandle.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    return await file.arrayBuffer();
  } catch {
    return null;
  }
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

/** 扫描目录中所有以指定前缀开头的文件，返回文件名数组 */
async function listFilesInDirectory(
  dirHandle: FileSystemDirectoryHandle,
  prefix?: string,
): Promise<string[]> {
  const names: string[] = [];
  for await (const [name] of (dirHandle as any).entries()) {
    if (!prefix || name.startsWith(prefix)) {
      names.push(name);
    }
  }
  return names;
}

/** 解析 BOM 文件名：BOM_ASM-001_A.xlsx → { code: 'ASM-001', version: 'A' } */
function parseBOMFilename(filename: string): { code: string; version: string } | null {
  if (!filename.startsWith('BOM_') || !filename.endsWith('.xlsx')) return null;
  const name = filename.slice(4, -5); // Remove 'BOM_' and '.xlsx'
  // 从右往左用 "_" 拆分，最后一段为版本
  const lastUnderscore = name.lastIndexOf('_');
  if (lastUnderscore === -1) return null;
  const version = name.slice(lastUnderscore + 1);
  const code = name.slice(0, lastUnderscore);
  return { code, version };
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

/**
 * 从 Excel 行中提取自定义字段值
 * @param row Excel 行数据
 * @param defs 自定义字段定义
 * @returns 提取的自定义字段值 { field_id: value }
 */
function extractCustomFieldsFromRow(
  row: Record<string, unknown>,
  defs: CustomFieldDefinition[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const def of defs) {
    if (row[def.name] !== undefined && row[def.name] !== null && row[def.name] !== '') {
      result[def.id] = row[def.name];
    }
  }
  return result;
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
  entityType: 'part' | 'assembly',
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
  const parts = useDataStore.getState().parts;
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
// PART IMPORT
// ================================================================

/**
 * 从 Excel 文件导入零件
 * 返回预览数据供用户确认
 */
export async function previewPartsImport(
  file: File,
): Promise<ImportPreview> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });

  // Sheet 1: 零件数据
  const sheet1 = wb.Sheets['零件数据'];
  if (!sheet1) throw new Error('Excel 中未找到 "零件数据" Sheet');

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet1);
  if (rawRows.length === 0) throw new Error('Excel 中无数据');

  const defs = getCustomFieldDefs('part');
  const existingParts = useDataStore.getState().parts;

  // 构建已存在映射：key = code|version
  const existingMap = new Map<string, Part>();
  for (const p of existingParts) {
    existingMap.set(`${p.code}|${p.version || ''}`, p);
  }

  // 解析 Sheet 2: 关联图文档（如果有）
  const sheet2 = wb.Sheets['关联图文档'];
  const docRelationRows = sheet2
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet2)
    : [];

  // 按件号+零件版本分组关联图文档
  const docRelationsByPart = new Map<string, { docCode: string; docVersion: string }[]>();
  for (const r of docRelationRows) {
    const code = String(r['件号'] || '').trim();
    const pv = String(r['零件版本'] || '').trim();
    const dc = String(r['图文档编号'] || '').trim();
    const dv = String(r['图文档版本'] || '').trim();
    if (code && dc) {
      const key = `${code}|${pv}`;
      if (!docRelationsByPart.has(key)) docRelationsByPart.set(key, []);
      docRelationsByPart.get(key)!.push({ docCode: dc, docVersion: dv });
    }
  }

  let docWarnings = 0;

  const rows: ImportRow[] = rawRows.map((raw) => {
    const code = String(raw['件号'] || '').trim();
    const name = String(raw['中文名称'] || '').trim();
    const version = String(raw['版本'] || 'A').trim();

    if (!code || !name) {
      return {
        status: '错误' as const,
        code,
        name,
        version,
        error: '缺少必填字段（件号或中文名称）',
      };
    }

    const key = `${code}|${version}`;
    const existing = existingMap.get(key);
    const status = existing ? ('更新' as const) : ('新增' as const);

    // 提取自定义字段
    const customFields = extractCustomFieldsFromRow(raw, defs);

    // 提取关联图文档
    const relations = docRelationsByPart.get(key) || [];
    if (relations.length > 0) {
      // 检查图文档是否在系统中存在
      const allDocs = useDataStore.getState().documents;
      for (const rel of relations) {
        const found = allDocs.find(
          (d) => d.code === rel.docCode && (d.version || '') === rel.docVersion,
        );
        if (!found) docWarnings++;
      }
    }

    return {
      status,
      code,
      name,
      version,
      remark: String(raw['备注'] || ''),
      _data: {
        code,
        name,
        spec: String(raw['规格型号'] || ''),
        version,
        status: existing ? existing.status : statusFromZh(String(raw['状态'] || '')),
        remark: String(raw['备注'] || ''),
      } as Record<string, unknown>,
      _customFields: customFields,
      _docRelations: relations,
    };
  });

  return {
    type: 'part',
    rows,
    docWarnings,
    docRelationCount: docRelationRows.length,
  };
}

/** 为零件关联图文档 */
async function linkPartDocuments(
  partId: string,
  relations: { docCode: string; docVersion: string }[],
) {
  const allDocs = useDataStore.getState().documents;
  for (const rel of relations) {
    const doc = allDocs.find(
      (d) => d.code === rel.docCode && (d.version || '') === rel.docVersion,
    );
    if (doc) {
      try {
        await entityDocumentsApi.add('part', partId, { document_id: doc.id });
      } catch {
        // 跳过重复关联
      }
    }
  }
}

/**
 * 执行零件导入（用户确认后调用）
 */
export async function executePartsImport(preview: ImportPreview): Promise<void> {
  const results = await mapLimitSettled(
    preview.rows.filter((r) => r.status !== '错误'),
    async (row) => {
        const data = row._data!;
        try {
          if (row.status === '更新') {
            const existing = useDataStore
              .getState()
              .parts.find(
                (p) =>
                  p.code === row.code && (p.version || '') === row.version,
              );
            if (existing) {
              const res = await partsApi.update(existing.id, data);
              const updated = res.data;
              // 保存自定义字段
              if (row._customFields && Object.keys(row._customFields).length > 0) {
                const fieldValues = Object.entries(row._customFields)
                  .filter(([, v]) => v !== null && v !== '' && v !== undefined)
                  .map(([fieldId, value]) => ({ field_id: fieldId, value }));
                if (fieldValues.length > 0) {
                  await customFieldsApi.setValues('part', existing.id, fieldValues);
                }
              }
              // 关联图文档
              if (row._docRelations && row._docRelations.length > 0) {
                await linkPartDocuments(existing.id, row._docRelations);
              }
              return updated;
            }
          } else {
            const res = await partsApi.create(data);
            const created = res.data;
            // 自定义字段
            if (row._customFields && Object.keys(row._customFields).length > 0) {
              const fieldValues = Object.entries(row._customFields)
                .filter(([, v]) => v !== null && v !== '' && v !== undefined)
                .map(([fieldId, value]) => ({ field_id: fieldId, value }));
              if (fieldValues.length > 0) {
                await customFieldsApi.setValues('part', created.id, fieldValues);
              }
            }
            // 关联图文档
            if (row._docRelations && row._docRelations.length > 0) {
              await linkPartDocuments(created.id, row._docRelations);
            }
            return created;
          }
        } catch (err: any) {
          console.error(`导入零件失败: ${row.code}`, err);
          throw err;
        }
        return null;
      },
  );

  const errors = results.filter((r) => r.status === 'rejected');
  if (errors.length > 0) {
    throw new Error(`导入完成，但有 ${errors.length} 条记录导入失败（请查看控制台日志）`);
  }

  // 刷新 store
  await useDataStore.getState().syncAll();
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
  assemblyId: string,
  level: number = 1,
): Promise<{ rows: BOMRow[]; refs: BOMEntityRef[] }> {
  const rows: BOMRow[] = [];
  const refs: BOMEntityRef[] = [];
  try {
    const res = await assemblyPartsApi.list(assemblyId);
    const items: AssemblyPartItem[] = res.data || [];

    for (const item of items) {
      const detail = item.child_detail;
      refs.push({ type: item.childType as 'part' | 'component', id: detail?.id || '' });
      rows.push({
        层级: level,
        类型: item.childType === 'part' ? '零件' : '部件',
        件号: detail?.code || '',
        中文名称: detail?.name || '',
        规格型号: detail?.spec || '',
        版本: detail?.version || '',
        状态: statusToZh(detail?.status),
        用量: item.quantity,
      });

      // 如果是部件，递归收集子项
      if (item.childType === 'component' && detail?.id) {
        const child = await gatherBOMTree(detail.id, level + 1);
        rows.push(...child.rows);
        refs.push(...child.refs);
      }
    }
  } catch (err) {
    console.error(`获取 BOM 树失败: ${assemblyId}`, err);
  }
  return { rows, refs };
}

/**
 * 导出部件到文件夹
 * 使用 File System Access API 写入本地文件夹
 */
export async function exportAssembliesToFolder(dirHandle?: FileSystemDirectoryHandle): Promise<void> {
  if (!dirHandle && !supportsFileSystemAccess()) {
    throw new Error('您的浏览器不支持文件夹操作，请使用 Chrome 86+ 或 Edge 86+');
  }

  const assemblies = useDataStore.getState().assemblies;
  if (assemblies.length === 0) {
    throw new Error('没有可导出的部件数据');
  }

  const handle = dirHandle || await window.showDirectoryPicker({
    mode: 'readwrite',
    startIn: 'downloads',
  });

  const defs = getCustomFieldDefs('component');
  const asmIds = assemblies.map((a) => a.id);
  const [cfValuesMap, docMap] = await Promise.all([
    defs.length > 0
      ? loadCustomFieldValues('component', asmIds)
      : Promise.resolve(new Map()),
    loadEntityDocuments('assembly', asmIds),
  ]);

  // ===== 1. 部件清单.xlsx =====
  const sheet1Rows = assemblies.map((a) => {
    const row: Record<string, unknown> = {
      件号: a.code,
      中文名称: a.name,
      规格型号: a.spec || '',
      版本: a.version || '',
      状态: statusToZh(a.status),
      备注: a.remark || '',
      创建时间: a.created_at || '',
      更新时间: a.updated_at || '',
    };
    const cfValues = cfValuesMap.get(a.id);
    if (cfValues) {
      for (const def of defs) {
        row[def.name] = cfValues[def.id] ?? '';
      }
    }
    return row;
  });

  const sheet2Rows: Record<string, unknown>[] = [];
  for (const asm of assemblies) {
    const docs = docMap.get(asm.id) || [];
    if (docs.length > 0) {
      for (const ed of docs) {
        sheet2Rows.push({
          件号: asm.code,
          版本: asm.version || '',
          图文档编号: ed.document?.code || '',
          图文档名称: ed.document?.name || '',
          图文档版本: ed.document?.version || '',
        });
      }
    }
  }

  const wb1 = XLSX.utils.book_new();
  const s1 = XLSX.utils.json_to_sheet(sheet1Rows);
  s1['!cols'] = [
    { wch: 18 }, { wch: 24 }, { wch: 20 }, { wch: 8 },
    { wch: 10 }, { wch: 30 }, { wch: 20 }, { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb1, s1, '部件清单');

  if (sheet2Rows.length > 0) {
    const s2 = XLSX.utils.json_to_sheet(sheet2Rows);
    s2['!cols'] = [
      { wch: 18 }, { wch: 8 }, { wch: 20 }, { wch: 30 }, { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb1, s2, '关联图文档');
  }

  const buf1 = XLSX.write(wb1, { bookType: 'xlsx', type: 'array' });
  await writeBlobToDirectory(
    handle,
    '部件清单.xlsx',
    new Blob([buf1], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );

  // ===== 2. 每个部件的 BOM_xxx.xlsx =====
  for (const asm of assemblies) {
    const { rows: bomRows } = await gatherBOMTree(asm.id);
    // 加上自身行（层级0）
    const allRows: BOMRow[] = [
      {
        层级: 0,
        类型: '部件',
        件号: asm.code,
        中文名称: asm.name,
        规格型号: asm.spec || '',
        版本: asm.version || '',
        状态: statusToZh(asm.status),
        用量: 1,
      },
      ...bomRows,
    ];

    const bomSheet = XLSX.utils.json_to_sheet(allRows);
    bomSheet['!cols'] = [
      { wch: 6 }, { wch: 8 }, { wch: 18 }, { wch: 24 },
      { wch: 20 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
    ];
    const bomWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(bomWb, bomSheet, 'BOM');

    const bufBom = XLSX.write(bomWb, { bookType: 'xlsx', type: 'array' });
    const bomFilename = `BOM_${asm.code}_${asm.version || 'A'}.xlsx`;
    await writeBlobToDirectory(
      handle,
      bomFilename,
      new Blob([bufBom], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
  }
}

/**
 * 导出单个部件的完整信息
 * 包含 Sheet1: 部件信息(含自定义字段), Sheet2: BOM(含自定义字段), Sheet3: 关联图文档
 */
export async function exportSingleAssemblyBOM(assemblyId: string): Promise<void> {
  const assemblies = useDataStore.getState().assemblies;
  const asm = assemblies.find((a) => a.id === assemblyId);
  if (!asm) {
    throw new Error('未找到该部件');
  }

  const asmDefs = getCustomFieldDefs('component');
  const [cfValuesMap, docMap, bomResult] = await Promise.all([
    asmDefs.length > 0 ? loadCustomFieldValues('component', [asm.id]) : Promise.resolve(new Map()),
    loadEntityDocuments('assembly', [asm.id]),
    gatherBOMTree(asm.id),
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

  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const filename = `BOM_${asm.code}_${asm.version || 'A'}.xlsx`;
  downloadBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  );
}

// ================================================================
// ASSEMBLY IMPORT
// ================================================================

/**
 * 预览部件导入
 * 用户选择文件夹后解析数据
 */
export async function previewAssembliesImport(dirHandle?: FileSystemDirectoryHandle): Promise<ImportPreview> {
  if (!dirHandle && !supportsFileSystemAccess()) {
    throw new Error('您的浏览器不支持文件夹操作，请使用 Chrome 86+ 或 Edge 86+');
  }

  const handle = dirHandle || await window.showDirectoryPicker({
    mode: 'read',
  });
  _importDirHandle = handle;

  const existingAssemblies = useDataStore.getState().assemblies;
  const existingParts = useDataStore.getState().parts;

  // 读取部件清单.xlsx
  const manifestBuf = await readFileAsBuffer(handle, '部件清单.xlsx');
  if (!manifestBuf) throw new Error('文件夹中未找到 "部件清单.xlsx"');

  const wb = XLSX.read(manifestBuf, { type: 'array' });
  const ws1 = wb.Sheets['部件清单'];
  if (!ws1) throw new Error('Excel 中未找到 "部件清单" Sheet');

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws1);
  if (rawRows.length === 0) throw new Error('Excel 中无数据');

  const defs = getCustomFieldDefs('component');

  // 已存在映射
  const existingMap = new Map<string, Assembly>();
  for (const a of existingAssemblies) {
    existingMap.set(`${a.code}|${a.version || ''}`, a);
  }

  // 解析关联图文档 Sheet
  const wsRel = wb.Sheets['关联图文档'];
  const relRows = wsRel
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wsRel)
    : [];
  const docRelationsByAsm = new Map<string, { docCode: string; docVersion: string }[]>();
  for (const r of relRows) {
    const code = String(r['件号'] || '').trim();
    const ver = String(r['版本'] || '').trim();
    const dc = String(r['图文档编号'] || '').trim();
    const dv = String(r['图文档版本'] || '').trim();
    if (code && dc) {
      const key = `${code}|${ver}`;
      if (!docRelationsByAsm.has(key)) docRelationsByAsm.set(key, []);
      docRelationsByAsm.get(key)!.push({ docCode: dc, docVersion: dv });
    }
  }

  // 扫描 BOM_*.xlsx 文件
  const allFiles = await listFilesInDirectory(handle!);
  const bomFiles = allFiles.filter((f) => f.startsWith('BOM_') && f.endsWith('.xlsx'));

  // 解析 BOM 文件，建立 (件号|版本) → BOM 行 映射
  const bomDataMap = new Map<string, Record<string, unknown>[]>();
  for (const bf of bomFiles) {
    const parsed = parseBOMFilename(bf);
    if (!parsed) continue;
    const buf = await readFileAsBuffer(handle!, bf);
    if (!buf) continue;
    const bomWb = XLSX.read(buf, { type: 'array' });
    const bomWs = bomWb.Sheets['BOM'];
    if (!bomWs) continue;
    const bomRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(bomWs);
    bomDataMap.set(`${parsed.code}|${parsed.version}`, bomRows);
  }

  let docWarnings = 0;
  let bomMatched = 0;

  const rows: ImportRow[] = rawRows.map((raw) => {
    const code = String(raw['件号'] || '').trim();
    const name = String(raw['中文名称'] || '').trim();
    const version = String(raw['版本'] || 'A').trim();

    if (!code || !name) {
      return {
        status: '错误' as const,
        code,
        name,
        version,
        error: '缺少必填字段（件号或中文名称）',
      };
    }

    const key = `${code}|${version}`;
    const existing = existingMap.get(key);
    const status = existing ? ('更新' as const) : ('新增' as const);

    // 检查是否有 BOM 数据
    const matchedBomRows = bomDataMap.get(key);
    const bomCount = matchedBomRows ? matchedBomRows.filter((r) => Number(r['层级']) === 1).length : 0;
    if (matchedBomRows && matchedBomRows.length > 0) bomMatched++;

    // 自定义字段
    const customFields = extractCustomFieldsFromRow(raw, defs);

    // 关联图文档
    const relations = docRelationsByAsm.get(key) || [];
    if (relations.length > 0) {
      const allDocs = useDataStore.getState().documents;
      for (const rel of relations) {
        const found = allDocs.find(
          (d) => d.code === rel.docCode && (d.version || '') === rel.docVersion,
        );
        if (!found) docWarnings++;
      }
    }

    return {
      status,
      code,
      name,
      version,
      remark: String(raw['备注'] || ''),
      _data: {
        code,
        name,
        spec: String(raw['规格型号'] || ''),
        version,
        status: existing ? existing.status : statusFromZh(String(raw['状态'] || '')),
        remark: String(raw['备注'] || ''),
      } as Record<string, unknown>,
      _customFields: customFields,
      _docRelations: relations,
      _bomChildren: bomCount,
    };
  });

  return {
    type: 'assembly',
    rows,
    docWarnings,
    bomFiles: bomFiles.length,
    bomMatched,
    docRelationCount: relRows.length,
  };
}

/**
 * 执行部件导入（三阶段处理）
 */
export async function executeAssembliesImport(
  preview: ImportPreview,
): Promise<void> {
  const validRows = preview.rows.filter((r) => r.status !== '错误');

  // ===== 阶段1: 创建/更新所有部件 =====
  const codeVersionToId = new Map<string, string>();
  const codeVersionToNew = new Map<string, boolean>();

  for (const row of validRows) {
    const data = row._data!;
    const key = `${row.code}|${row.version}`;

    try {
      if (row.status === '更新') {
        const existing = useDataStore
          .getState()
          .assemblies.find(
            (a) => a.code === row.code && (a.version || '') === row.version,
          );
        if (existing) {
          const res = await assembliesApi.update(existing.id, data);
          codeVersionToId.set(key, existing.id);
          codeVersionToNew.set(key, false);

          // 自定义字段
          if (row._customFields && Object.keys(row._customFields).length > 0) {
            const fieldValues = Object.entries(row._customFields)
              .filter(([, v]) => v !== null && v !== '' && v !== undefined)
              .map(([fieldId, value]) => ({ field_id: fieldId, value }));
            if (fieldValues.length > 0) {
              await customFieldsApi.setValues('component', existing.id, fieldValues);
            }
          }
        }
      } else {
        const res = await assembliesApi.create(data);
        const created = res.data;
        codeVersionToId.set(key, created.id);
        codeVersionToNew.set(key, true);

        // 自定义字段
        if (row._customFields && Object.keys(row._customFields).length > 0) {
          const fieldValues = Object.entries(row._customFields)
            .filter(([, v]) => v !== null && v !== '' && v !== undefined)
            .map(([fieldId, value]) => ({ field_id: fieldId, value }));
          if (fieldValues.length > 0) {
            await customFieldsApi.setValues('component', created.id, fieldValues);
          }
        }
      }
    } catch (err: any) {
      console.error(`导入部件失败: ${row.code}`, err);
    }
  }

  // ===== 阶段2: 建立 BOM 子项关系 =====
  const dirHandle = _importDirHandle;
  if (dirHandle) {
    const bomFiles = await listFilesInDirectory(dirHandle, 'BOM_');
    for (const bf of bomFiles) {
      const parsed = parseBOMFilename(bf);
      if (!parsed) continue;
      const parentKey = `${parsed.code}|${parsed.version}`;
      const parentId = codeVersionToId.get(parentKey);
      if (!parentId) continue;

    const buf = await readFileAsBuffer(dirHandle!, bf);
      if (!buf) continue;
      const bomWb = XLSX.read(buf, { type: 'array' });
      const bomWs = bomWb.Sheets['BOM'];
      if (!bomWs) continue;
      const bomRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(bomWs);

      // 只处理层级=1（直接子项）
      const level1Rows = bomRows.filter((r) => Number(r['层级']) === 1);

      for (const bomRow of level1Rows) {
        const childCode = String(bomRow['件号'] || '').trim();
        const childTypeStr = String(bomRow['类型'] || '').trim();
        const childVersion = String(bomRow['版本'] || '').trim();
        const quantity = Math.floor(Number(bomRow['用量'])) || 1;
        if (!childCode) continue;

        const isPart = childTypeStr === '零件';
        const childKey = `${childCode}|${childVersion}`;

        // 查找子项 ID
        let childId: string | null = null;

        // 1. 先在本次新建/更新中查找
        if (codeVersionToId.has(childKey)) {
          childId = codeVersionToId.get(childKey)!;
        }

        // 2. 在 store 中查找已有部件或零件
        if (!childId && isPart) {
          const found = useDataStore
            .getState()
            .parts.find(
              (p) => p.code === childCode && (p.version || '') === childVersion,
            );
          if (found) childId = found.id;
        }
        if (!childId && !isPart) {
          const found = useDataStore
            .getState()
            .assemblies.find(
              (a) => a.code === childCode && (a.version || '') === childVersion,
            );
          if (found) childId = found.id;
        }

        // 3. 如果是零件且未找到，自动创建草稿零件
        if (!childId && isPart) {
          try {
            const res = await partsApi.create({
              code: childCode,
              name: String(bomRow['中文名称'] || childCode),
              spec: String(bomRow['规格型号'] || ''),
              version: childVersion || 'A',
              status: 'draft',
            });
            childId = res.data.id;
          } catch (err) {
            console.error(`自动创建零件失败: ${childCode}`, err);
            continue;
          }
        }

        if (!childId) continue;

        // 4. 检查是否已存在关联关系（去重）
        try {
          const existingItems = await assemblyPartsApi.list(parentId);
          const existingChildren: AssemblyPartItem[] = existingItems.data || [];
          const alreadyExists = existingChildren.some(
            (item) => item.child_id === childId,
          );
          if (alreadyExists) continue;

          // 5. 添加子项
          await assemblyPartsApi.add(parentId, {
            child_type: isPart ? 'part' : 'component',
            child_id: childId,
            quantity,
          });
        } catch (err) {
          console.error(`添加 BOM 子项失败: ${parentKey} → ${childKey}`, err);
        }
      }
    }
  }

  // ===== 阶段3: 建立关联图文档 =====
  const allDocs = useDataStore.getState().documents;
  for (const row of validRows) {
    if (!row._docRelations || row._docRelations.length === 0) continue;
    const key = `${row.code}|${row.version}`;
    const asmId = codeVersionToId.get(key);
    if (!asmId) continue;

    for (const rel of row._docRelations) {
      const doc = allDocs.find(
        (d) => d.code === rel.docCode && (d.version || '') === rel.docVersion,
      );
      if (doc) {
        try {
          await entityDocumentsApi.add('assembly', asmId, {
            document_id: doc.id,
          });
        } catch {
          // 跳过重复
        }
      }
    }
  }

  // 刷新 store
  await useDataStore.getState().syncAll();
}

// ================================================================
// DOCUMENT EXPORT
// ================================================================

/**
 * 导出图文档到文件夹
 * 包含 图文档清单.xlsx + attachments/ 附件子文件夹
 */
export async function exportDocumentsToFolder(dirHandle?: FileSystemDirectoryHandle): Promise<void> {
  if (!dirHandle && !supportsFileSystemAccess()) {
    throw new Error('您的浏览器不支持文件夹操作，请使用 Chrome 86+ 或 Edge 86+');
  }

  const documents = useDataStore.getState().documents;
  if (documents.length === 0) {
    throw new Error('没有可导出的图文档数据');
  }

  const handle = dirHandle || await window.showDirectoryPicker({
    mode: 'readwrite',
    startIn: 'downloads',
  });

  const defs = getCustomFieldDefs('document');
  const docIds = documents.map((d) => d.id);
  const cfValuesMap =
    defs.length > 0 ? await loadCustomFieldValues('document', docIds) : new Map();

  // ===== 图文档清单.xlsx =====
  const sheetRows = documents.map((d) => {
    const row: Record<string, unknown> = {
      图文档编号: d.code,
      名称: d.name,
      版本: d.version || '',
      状态: statusToZh(d.status),
      备注: d.remark || '',
      创建时间: d.created_at || '',
      更新时间: d.updated_at || '',
      附件文件名: d.file_name || '',
    };
    const cfValues = cfValuesMap.get(d.id);
    if (cfValues) {
      for (const def of defs) {
        row[def.name] = cfValues[def.id] ?? '';
      }
    }
    return row;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  ws['!cols'] = [
    { wch: 18 }, { wch: 30 }, { wch: 8 }, { wch: 10 },
    { wch: 30 }, { wch: 20 }, { wch: 20 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, '图文档清单');

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  await writeBlobToDirectory(
    handle,
    '图文档清单.xlsx',
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );

  // ===== attachments/ 子文件夹 =====
  try {
    const attDirHandle = await handle.getDirectoryHandle('attachments', {
      create: true,
    });

    for (const doc of documents) {
      if (!doc.file_id) continue;

      try {
        // 下载附件
        const res = await documentsApi.getAttachment(doc.id, doc.file_id);
        const data = res.data as { file_data?: string; file_name?: string };

        if (data?.file_data) {
          const fileName = doc.file_name || 'unknown';
          // 格式: 编号#版本#文件名
          const exportName = `${doc.code}#${doc.version || 'A'}#${fileName}`;
          // 解码 base64 并写入
          const binaryStr = atob(data.file_data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          const blob = new Blob([bytes]);

          // 如果文件 > 1GB 给出警告（但这里只是提示，仍然写入）
          if (blob.size > 1024 * 1024 * 1024) {
            console.warn(`警告: 文件 ${exportName} 超过 1GB`);
          }

          await writeBlobToDirectory(attDirHandle, exportName, blob);
        }
      } catch (err) {
        console.error(`下载附件失败: ${doc.code}`, err);
      }
    }
  } catch (err) {
    console.error('创建 attachments 目录失败', err);
  }
}

// ================================================================
// DOCUMENT IMPORT
// ================================================================

/**
 * 预览图文档导入
 */
export async function previewDocumentsImport(dirHandle?: FileSystemDirectoryHandle): Promise<ImportPreview> {
  if (!dirHandle && !supportsFileSystemAccess()) {
    throw new Error('您的浏览器不支持文件夹操作，请使用 Chrome 86+ 或 Edge 86+');
  }

  const handle = dirHandle || await window.showDirectoryPicker({ mode: 'read' });
  _importDirHandle = handle;

  const manifestBuf = await readFileAsBuffer(handle, '图文档清单.xlsx');
  if (!manifestBuf) throw new Error('文件夹中未找到 "图文档清单.xlsx"');

  const wb = XLSX.read(manifestBuf, { type: 'array' });
  const ws = wb.Sheets['图文档清单'];
  if (!ws) throw new Error('Excel 中未找到 "图文档清单" Sheet');

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
  if (rawRows.length === 0) throw new Error('Excel 中无数据');

  const existingDocs = useDataStore.getState().documents;
  const existingMap = new Map<string, Document>();
  for (const d of existingDocs) {
    existingMap.set(`${d.code}|${d.version || ''}`, d);
  }

  const defs = getCustomFieldDefs('document');

  // 扫描 attachments/ 目录
  let attDirHandle: FileSystemDirectoryHandle | null = null;
  try {
    attDirHandle = await handle.getDirectoryHandle('attachments');
  } catch {
    // 没有附件目录也继续
  }

  const attFileNames = attDirHandle ? await listFilesInDirectory(attDirHandle) : [];

  const rows: ImportRow[] = rawRows.map((raw) => {
    const code = String(raw['图文档编号'] || '').trim();
    const name = String(raw['名称'] || '').trim();
    const version = String(raw['版本'] || 'A').trim();

    if (!code || !name) {
      return {
        status: '错误' as const,
        code,
        name,
        version,
        error: '缺少必填字段（编号或名称）',
      };
    }

    const key = `${code}|${version}`;
    const existing = existingMap.get(key);
    const status = existing ? ('更新' as const) : ('新增' as const);

    const customFields = extractCustomFieldsFromRow(raw, defs);

    return {
      status,
      code,
      name,
      version,
      remark: String(raw['备注'] || ''),
      _data: {
        code,
        name,
        version,
        status: existing ? existing.status : statusFromZh(String(raw['状态'] || '')),
        remark: String(raw['备注'] || ''),
      } as Record<string, unknown>,
      _customFields: customFields,
    };
  });

  return { type: 'document', rows };
}

/**
 * 执行图文档导入
 */
export async function executeDocumentsImport(preview: ImportPreview): Promise<void> {
  const dirHandle = _importDirHandle;
  if (!dirHandle) {
    throw new Error('导入会话已过期，请重新选择文件夹');
  }

  let attDirHandle: FileSystemDirectoryHandle | null = null;
  try {
    attDirHandle = await dirHandle.getDirectoryHandle('attachments');
  } catch {
    // 没有附件目录
  }

  const validRows = preview.rows.filter((r) => r.status !== '错误');

  for (const row of validRows) {
    const data = row._data!;
    try {
      let docId: string | null = null;

      if (row.status === '更新') {
        const existing = useDataStore
          .getState()
          .documents.find(
            (d) => d.code === row.code && (d.version || '') === row.version,
          );
        if (existing) {
          const res = await documentsApi.update(existing.id, data);
          docId = existing.id;

          if (row._customFields && Object.keys(row._customFields).length > 0) {
            const fieldValues = Object.entries(row._customFields)
              .filter(([, v]) => v !== null && v !== '' && v !== undefined)
              .map(([fieldId, value]) => ({ field_id: fieldId, value }));
            if (fieldValues.length > 0) {
              await customFieldsApi.setValues('document', existing.id, fieldValues);
            }
          }
        }
      } else {
        const res = await documentsApi.create(data);
        docId = res.data.id;

        if (row._customFields && Object.keys(row._customFields).length > 0) {
          const fieldValues = Object.entries(row._customFields)
            .filter(([, v]) => v !== null && v !== '' && v !== undefined)
            .map(([fieldId, value]) => ({ field_id: fieldId, value }));
          if (fieldValues.length > 0 && docId) {
            await customFieldsApi.setValues('document', docId, fieldValues);
          }
        }
      }

      // 上传附件
      if (docId && attDirHandle) {
        const expectedPrefix = `${row.code}#${row.version || 'A'}#`;
        const attFiles = await listFilesInDirectory(attDirHandle);
        const matchingFiles = attFiles.filter((f) => f.startsWith(expectedPrefix));

        for (const attFileName of matchingFiles) {
          try {
            const buf = await readFileAsBuffer(attDirHandle!, attFileName);
            if (!buf) continue;

            // 读取文件内容
            const fileHandle = await attDirHandle!.getFileHandle(attFileName);
            const file = await fileHandle.getFile();
            const fileBuffer = await file.arrayBuffer();

            // 转为 base64
            const bytes = new Uint8Array(fileBuffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);

            // 提取原始文件名（去掉编号#版本#前缀）
            const originalName = attFileName.slice(expectedPrefix.length);

            // 如果 > 1GB 给出警告
            if (fileBuffer.byteLength > 1024 * 1024 * 1024) {
              alert(`警告: 文件 ${attFileName} 超过 1GB`);
            }

            await documentsApi.uploadAttachment(docId, {
              file_name: originalName,
              file_data: base64,
            });
          } catch (err: any) {
            // 单个附件失败不中断整批导入，记录服务端给出的原因（如不允许的文件类型）后跳过
            const detail = err?.response?.data?.detail || err?.message || '';
            console.error(`上传附件失败(已跳过): ${attFileName} — ${detail}`, err);
          }
        }
      }
    } catch (err: any) {
      console.error(`导入图文档失败: ${row.code}`, err);
    }
  }

  await useDataStore.getState().syncAll();
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

// ================================================================
// USER EXPORT
// ================================================================

/** 角色英文→中文映射 */
const ROLE_EN_TO_ZH: Record<string, string> = {
  admin: '管理员',
  engineer: '工程师',
  production: '生产人员',
  guest: '访客',
};

/** 角色中文→英文映射 */
const ROLE_ZH_TO_EN: Record<string, string> = {
  '管理员': 'admin',
  '工程师': 'engineer',
  '生产人员': 'production',
  '访客': 'guest',
};

/** 用户状态英文→中文 */
const USER_STATUS_EN_TO_ZH: Record<string, string> = {
  active: '启用',
  inactive: '禁用',
};

/** 用户状态中文→英文 */
const USER_STATUS_ZH_TO_EN: Record<string, string> = {
  '启用': 'active',
  '禁用': 'inactive',
};

/**
 * 导出用户到目录
 */
export async function exportUsers(dirHandle?: FileSystemDirectoryHandle): Promise<void> {
  if (!dirHandle && !supportsFileSystemAccess()) {
    throw new Error('您的浏览器不支持文件夹操作，请使用 Chrome 86+ 或 Edge 86+');
  }

  const res = await usersApi.list({ page_size: 10000 });
  const users = (res.data as { items?: unknown[] } | unknown[]) || [];
  const userList: unknown[] = Array.isArray(users)
    ? users
    : (users as { items?: unknown[] }).items || [];

  if (userList.length === 0) return;

  const handle = dirHandle || await window.showDirectoryPicker({
    mode: 'readwrite',
    startIn: 'downloads',
  });

  const rows = userList.map((u: any) => ({
    '用户名': u.username || '',
    '姓名': u.real_name || '',
    '角色': ROLE_EN_TO_ZH[u.role] || u.role || '',
    '部门': u.department || '',
    '电话': u.phone || '',
    '状态': USER_STATUS_EN_TO_ZH[u.status] || u.status || '启用',
    '创建时间': u.created_at || '',
    '更新时间': u.updated_at || '',
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 16 },
    { wch: 16 }, { wch: 8 }, { wch: 20 }, { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, '用户清单');

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  if (dirHandle) {
    await writeBlobToDirectory(dirHandle, '用户清单.xlsx', blob);
  } else {
    await writeBlobToDirectory(handle, '用户清单.xlsx', blob);
  }
}

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
// DASHBOARD EXPORT
// ================================================================

/**
 * 导出用户看板到目录
 */
export async function exportDashboard(dirHandle?: FileSystemDirectoryHandle): Promise<void> {
  if (!dirHandle && !supportsFileSystemAccess()) {
    throw new Error('您的浏览器不支持文件夹操作，请使用 Chrome 86+ 或 Edge 86+');
  }

  const res = await api.get('/dashboard/export-all');
  const dashboardData: any[] = Array.isArray(res.data) ? res.data : [];

  if (dashboardData.length === 0) return;

  const handle = dirHandle || await window.showDirectoryPicker({
    mode: 'readwrite',
    startIn: 'downloads',
  });

  // Sheet 1: 看板概览
  const overviewRows: Record<string, unknown>[] = [];
  // Sheet 2: 文件夹（使用 文件夹路径 替代 UUID）
  const folderRows: Record<string, unknown>[] = [];
  // Sheet 3: 关联项目（使用 文件夹路径 + 实体编码+版本 替代 UUID）
  const itemRows: Record<string, unknown>[] = [];
  // Sheet 4: 共享（使用 文件夹路径 + 共享给用户名 替代 UUID）
  const shareRows: Record<string, unknown>[] = [];

  /** 从 folders 列表构建 folder_id → 路径 的映射 */
  function buildFolderPaths(folders: any[]): Map<string, string> {
    const idToName = new Map<string, string>();
    const idToParent = new Map<string, string | null>();
    for (const f of folders) {
      idToName.set(f.id || '', f.name || '');
      idToParent.set(f.id || '', f.parent_id || null);
    }
    const pathMap = new Map<string, string>();
    function getPath(fid: string): string {
      if (pathMap.has(fid)) return pathMap.get(fid)!;
      const name = idToName.get(fid) || fid;
      const parentId = idToParent.get(fid);
      if (parentId && idToName.has(parentId)) {
        const parentPath = getPath(parentId);
        const p = parentPath ? `${parentPath}/${name}` : name;
        pathMap.set(fid, p);
        return p;
      }
      pathMap.set(fid, name);
      return name;
    }
    for (const fid of idToName.keys()) {
      getPath(fid);
    }
    return pathMap;
  }

  for (const entry of dashboardData) {
    const username = entry.username || '';
    const realName = entry.real_name || '';
    const dashboardName = entry.dashboard?.name || '';

    overviewRows.push({
      '用户名': username,
      '姓名': realName,
      '看板名称': dashboardName,
    });

    const folders = Array.isArray(entry.folders) ? entry.folders : [];
    const folderPaths = buildFolderPaths(folders);

    // 文件夹：使用路径替代 UUID
    for (const folder of folders) {
      const fid = folder.id || '';
      const fname = folder.name || '';
      const fpath = folderPaths.get(fid) || fname;
      folderRows.push({
        '用户名': username,
        '文件夹路径': fpath,
        '排序': folder.sort_order ?? 0,
      });
    }

    // 关联项目：使用 文件夹路径 + 实体编码+版本 替代 UUID
    if (Array.isArray(entry.items)) {
      for (const item of entry.items) {
        const fid = item.folder_id || '';
        const fpath = folderPaths.get(fid) || fid;
        const eversion = item.entity_version || '';
        itemRows.push({
          '用户名': username,
          '文件夹路径': fpath,
          '实体类型': ENTITY_TYPE_TO_ZH[item.entity_type] || item.entity_type || '',
          '实体编码': item.entity_code || '',
          '实体版本': eversion,
          '实体名称': item.entity_name || '',
        });
      }
    }

    // 共享：使用 文件夹路径 + 共享给用户名 替代 UUID
    if (Array.isArray(entry.shares)) {
      for (const share of entry.shares) {
        const fid = share.folder_id || '';
        const fpath = folderPaths.get(fid) || fid;
        shareRows.push({
          '文件夹路径': fpath,
          '共享给用户名': share.shared_with_username || '',
          '权限': share.permission || '',
        });
      }
    }
  }

  const wb = XLSX.utils.book_new();

  // Sheet: 看板概览
  const ws1 = XLSX.utils.json_to_sheet(overviewRows);
  ws1['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws1, '看板概览');

  // Sheet: 文件夹
  if (folderRows.length > 0) {
    const ws2 = XLSX.utils.json_to_sheet(folderRows);
    ws2['!cols'] = [{ wch: 16 }, { wch: 50 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws2, '文件夹');
  }

  // Sheet: 关联项目
  if (itemRows.length > 0) {
    const ws3 = XLSX.utils.json_to_sheet(itemRows);
    ws3['!cols'] = [{ wch: 16 }, { wch: 50 }, { wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws3, '关联项目');
  }

  // Sheet: 共享
  if (shareRows.length > 0) {
    const ws4 = XLSX.utils.json_to_sheet(shareRows);
    ws4['!cols'] = [{ wch: 50 }, { wch: 16 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws4, '共享');
  }

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  if (dirHandle) {
    await writeBlobToDirectory(dirHandle, '用户看板.xlsx', blob);
  } else {
    await writeBlobToDirectory(handle, '用户看板.xlsx', blob);
  }
}

/**
 * 直接导出用户看板为文件下载（不选文件夹）
 */
export async function exportDashboardFile(): Promise<void> {
  const res = await api.get('/dashboard/export-all');
  const dashboardData: any[] = Array.isArray(res.data) ? res.data : [];
  if (dashboardData.length === 0) {
    throw new Error('没有可导出的看板数据');
  }

  // 复用 exportDashboard 的 XLSX 构建逻辑
  const overviewRows: Record<string, unknown>[] = [];
  const folderRows: Record<string, unknown>[] = [];
  const itemRows: Record<string, unknown>[] = [];
  const shareRows: Record<string, unknown>[] = [];

  function buildFolderPaths(folders: any[]): Map<string, string> {
    const idToName = new Map<string, string>();
    const idToParent = new Map<string, string | null>();
    for (const f of folders) {
      idToName.set(f.id || '', f.name || '');
      idToParent.set(f.id || '', f.parent_id || null);
    }
    const pathMap = new Map<string, string>();
    function getPath(fid: string): string {
      if (pathMap.has(fid)) return pathMap.get(fid)!;
      const name = idToName.get(fid) || fid;
      const parentId = idToParent.get(fid);
      if (parentId && idToName.has(parentId)) {
        const pp = getPath(parentId);
        pathMap.set(fid, pp ? `${pp}/${name}` : name);
        return pathMap.get(fid)!;
      }
      pathMap.set(fid, name);
      return name;
    }
    for (const fid of idToName.keys()) getPath(fid);
    return pathMap;
  }

  for (const entry of dashboardData) {
    const username = entry.username || '';
    overviewRows.push({
      '用户名': username,
      '姓名': entry.real_name || '',
      '看板名称': entry.dashboard?.name || '',
    });
    const folders = Array.isArray(entry.folders) ? entry.folders : [];
    const folderPaths = buildFolderPaths(folders);
    for (const f of folders) {
      const fpath = folderPaths.get(f.id || '') || f.name || '';
      folderRows.push({ '用户名': username, '文件夹路径': fpath, '排序': f.sort_order ?? 0 });
    }
    if (Array.isArray(entry.items)) {
      for (const it of entry.items) {
        const fpath = folderPaths.get(it.folder_id || '') || it.folder_id || '';
        itemRows.push({
          '用户名': username,
          '文件夹路径': fpath,
          '实体类型': ENTITY_TYPE_TO_ZH[it.entity_type] || it.entity_type || '',
          '实体编码': it.entity_code || '',
          '实体版本': it.entity_version || '',
          '实体名称': it.entity_name || '',
        });
      }
    }
    if (Array.isArray(entry.shares)) {
      for (const s of entry.shares) {
        const fpath = folderPaths.get(s.folder_id || '') || s.folder_id || '';
        shareRows.push({
          '文件夹路径': fpath,
          '共享给用户名': s.shared_with_username || '',
          '权限': s.permission || '',
        });
      }
    }
  }

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(overviewRows);
  ws1['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws1, '看板概览');
  if (folderRows.length) {
    const ws2 = XLSX.utils.json_to_sheet(folderRows);
    ws2['!cols'] = [{ wch: 16 }, { wch: 50 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws2, '文件夹');
  }
  if (itemRows.length) {
    const ws3 = XLSX.utils.json_to_sheet(itemRows);
    ws3['!cols'] = [{ wch: 16 }, { wch: 50 }, { wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, ws3, '关联项目');
  }
  if (shareRows.length) {
    const ws4 = XLSX.utils.json_to_sheet(shareRows);
    ws4['!cols'] = [{ wch: 50 }, { wch: 16 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws4, '共享');
  }

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadBlob(blob, `用户看板_${todayStr()}.xlsx`);
}

// ================================================================
// DASHBOARD IMPORT
// ================================================================

/**
 * 预览用户看板导入（从目录读取 XLSX 并转换为后端所需 JSON）
 */
export async function previewDashboardImport(
  dirHandle: FileSystemDirectoryHandle,
): Promise<ImportPreview> {
  const buffer = await readFileAsBuffer(dirHandle, '用户看板.xlsx');
  if (!buffer) throw new Error('未找到"用户看板.xlsx"文件');

  const wb = XLSX.read(buffer, { type: 'array' });

  // 读取各 Sheet
  const overviewSheet = wb.Sheets['看板概览'];
  const folderSheet = wb.Sheets['文件夹'];
  const itemSheet = wb.Sheets['关联项目'];
  const shareSheet = wb.Sheets['共享'];

  const overviewRows = overviewSheet
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(overviewSheet)
    : [];
  const folderRows = folderSheet
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(folderSheet)
    : [];
  const itemRows = itemSheet
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(itemSheet)
    : [];
  const shareRows = shareSheet
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(shareSheet)
    : [];

  // 按用户名分组
  const userMap = new Map<string, {
    username: string;
    real_name: string;
    dashboard_name: string;
    folders: any[];
    items: any[];
    shares: any[];
  }>();

  for (const row of overviewRows) {
    const username = String(row['用户名'] || '').trim();
    if (!username) continue;
    userMap.set(username, {
      username,
      real_name: String(row['姓名'] || '').trim(),
      dashboard_name: String(row['看板名称'] || '').trim(),
      folders: [],
      items: [],
      shares: [],
    });
  }

  // 解析文件夹（路径格式: "根/子1/子2"，按路径重建层级）
  for (const row of folderRows) {
    const username = String(row['用户名'] || '').trim();
    const entry = userMap.get(username);
    if (!entry) continue;
    const folderPath = String(row['文件夹路径'] || '').trim();
    if (!folderPath) continue;
    const sortOrder = Number(row['排序']) || 0;
    const parts = folderPath.split('/').map(p => p.trim()).filter(Boolean);
    // 为路径上每一段生成或查找已有的 folder
    let parentId: string | null = null;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const existing = entry.folders.find(
        (f: any) => f.name === name && f._parentId === parentId,
      );
      if (existing) {
        parentId = existing._id;
        continue;
      }
      const fid = crypto.randomUUID();
      entry.folders.push({
        _id: fid,
        _parentId: parentId,
        name,
        parent_id: parentId,
        sort_order: i === parts.length - 1 ? sortOrder : 0,
      });
      parentId = fid;
    }
  }

  // 解析关联项目（使用 文件夹路径 + 实体编码+版本 定位）
  for (const row of itemRows) {
    const username = String(row['用户名'] || '').trim();
    const entry = userMap.get(username);
    if (!entry) continue;
    const folderPath = String(row['文件夹路径'] || '').trim();
    const entityTypeRaw = String(row['实体类型'] || '').trim();
    const entityType = ENTITY_TYPE_FROM_ZH[entityTypeRaw] || entityTypeRaw;
    const entityCode = String(row['实体编码'] || '').trim();
    const entityVersion = String(row['实体版本'] || '').trim();
    if (!entityCode) continue;
    // 查找文件夹：路径完全匹配
    let folderId = '';
    if (folderPath) {
      const parts = folderPath.split('/').map(p => p.trim()).filter(Boolean);
      let parentId: string | null = null;
      for (const name of parts) {
        const f = entry.folders.find(
          (ff: any) => ff.name === name && ff._parentId === parentId,
        );
        if (f) {
          folderId = f._id;
          parentId = f._id;
        } else {
          folderId = '';
          break;
        }
      }
    }
    entry.items.push({
      folder_id: folderId,
      entity_type: entityType,
      entity_code: entityCode,
      entity_version: entityVersion,
    });
  }

  // 解析共享（使用 文件夹路径 + 共享给用户名 定位）
  for (const row of shareRows) {
    const folderPath = String(row['文件夹路径'] || '').trim();
    const sharedUsername = String(row['共享给用户名'] || '').trim();
    const permission = String(row['权限'] || 'view').trim();
    if (!folderPath || !sharedUsername) continue;
    // 查找文件夹：路径完全匹配
    let folderId = '';
    for (const [, entry] of userMap) {
      const parts = folderPath.split('/').map(p => p.trim()).filter(Boolean);
      let parentId: string | null = null;
      for (const name of parts) {
        const f = entry.folders.find(
          (ff: any) => ff.name === name && ff._parentId === parentId,
        );
        if (f) {
          folderId = f._id;
          parentId = f._id;
        } else {
          folderId = '';
          break;
        }
      }
      if (folderId) {
        entry.shares.push({
          folder_id: folderId,
          shared_with_username: sharedUsername,
          shared_with_user_id: '', // 稍后按 username 查找
          permission,
        });
        break;
      }
    }
  }

  // 获取所有用户，将 username 映射到 user_id
  const usersRes = await usersApi.list({ page_size: 10000 });
  const usersAll = (usersRes.data as { items?: unknown[] } | unknown[]) || [];
  const usersList: any[] = Array.isArray(usersAll) ? usersAll : (usersAll as { items?: unknown[] }).items || [];
  const usernameToUserId: Record<string, string> = {};
  for (const u of usersList) {
    usernameToUserId[u.username] = u.id;
  }

  // 构建后端所需格式的数据（将可读标识转换为 UUID）
  const dashboardData: any[] = [];

  // 获取所有实体用于按 code+version 解析 entity_id
  // 优先从 store，兜底从 API
  const partMap = new Map<string, string>();
  const asmMap = new Map<string, string>();
  const docMap = new Map<string, string>();
  for (const p of useDataStore.getState().parts) partMap.set(`${p.code}|${p.version || ''}`, p.id);
  for (const a of useDataStore.getState().assemblies) asmMap.set(`${a.code}|${a.version || ''}`, a.id);
  for (const d of useDataStore.getState().documents) docMap.set(`${d.code}|${d.version || ''}`, d.id);

  function resolveEntityId(entityType: string, code: string, version: string): string {
    const key = `${code}|${version}`;
    const map = entityType === 'part' ? partMap : entityType === 'assembly' ? asmMap : docMap;
    return map.get(key) || '';
  }

  for (const [username, userEntry] of userMap) {
    const userId = usernameToUserId[username];
    if (!userId) continue; // 跳过不存在的用户

    // 文件夹：使用解析时生成的 _id 和 _parentId
    const folders = (userEntry.folders || []).map((f: any) => ({
      id: f._id || crypto.randomUUID(),
      parent_id: f._parentId || null,
      name: f.name || '',
      sort_order: f.sort_order ?? 0,
    }));

    // 关联项目：按 entity_code + entity_version 查找 entity_id
    const items = (userEntry.items || []).map((it: any) => ({
      id: crypto.randomUUID(),
      folder_id: it.folder_id || '',
      entity_type: it.entity_type || 'part',
      entity_id: resolveEntityId(it.entity_type || 'part', it.entity_code || '', it.entity_version || ''),
      entity_code: it.entity_code || '',
    }));

    // 共享：按 shared_with_username 解析 shared_with_user_id
    const shares = (userEntry.shares || []).map((sh: any) => ({
      id: crypto.randomUUID(),
      folder_id: sh.folder_id || '',
      shared_with_user_id: usernameToUserId[sh.shared_with_username] || '',
      permission: sh.permission || 'view',
    }));

    dashboardData.push({
      user_id: userId,
      username,
      real_name: userEntry.real_name,
      dashboard: { name: userEntry.dashboard_name || '我的看板' },
      folders,
      items,
      shares,
    });
  }

  const totalEntries = overviewRows.length;

  const rows: ImportRow[] = overviewRows.map((row) => {
    const username = String(row['用户名'] || '').trim();
    const name = String(row['姓名'] || '');
    return {
      status: '新增' as const,
      code: username,
      name,
      version: '',
      remark: `看板: ${row['看板名称'] || ''}`,
    };
  });

  return {
    type: 'dashboard',
    rows,
    docRelationCount: totalEntries,
    _dashboardData: dashboardData,
  };
}

/**
 * 从单个文件导入用户看板（不选文件夹）
 */
export async function previewDashboardImportFromFile(file: File): Promise<ImportPreview> {
  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: 'array' });

  // 读取各 Sheet
  const overviewRows = wb.Sheets['看板概览']
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['看板概览'])
    : [];
  const folderRows = wb.Sheets['文件夹']
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['文件夹'])
    : [];
  const itemRows = wb.Sheets['关联项目']
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['关联项目'])
    : [];
  const shareRows = wb.Sheets['共享']
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['共享'])
    : [];

  if (overviewRows.length === 0) throw new Error('文件中无看板数据');

  // 以下与 previewDashboardImport 的解析逻辑完全一致
  // 获取所有用户
  const usersRes = await usersApi.list({ page_size: 10000 });
  const usersAll = (usersRes.data as { items?: unknown[] } | unknown[]) || [];
  const usersList: any[] = Array.isArray(usersAll) ? usersAll : (usersAll as { items?: unknown[] }).items || [];
  const usernameToUserId: Record<string, string> = {};
  for (const u of usersList) {
    usernameToUserId[u.username] = u.id;
  }

  // 按用户名分组
  const userMap = new Map<string, {
    username: string;
    real_name: string;
    dashboard_name: string;
    folders: any[];
    items: any[];
    shares: any[];
  }>();

  for (const row of overviewRows) {
    const username = String(row['用户名'] || '').trim();
    if (!username) continue;
    userMap.set(username, {
      username,
      real_name: String(row['姓名'] || '').trim(),
      dashboard_name: String(row['看板名称'] || '').trim(),
      folders: [],
      items: [],
      shares: [],
    });
  }

  // 解析文件夹
  for (const row of folderRows) {
    const username = String(row['用户名'] || '').trim();
    const entry = userMap.get(username);
    if (!entry) continue;
    const folderPath = String(row['文件夹路径'] || '').trim();
    if (!folderPath) continue;
    const sortOrder = Number(row['排序']) || 0;
    const parts = folderPath.split('/').map(p => p.trim()).filter(Boolean);
    let parentId: string | null = null;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const existing = entry.folders.find(
        (f: any) => f.name === name && f._parentId === parentId,
      );
      if (existing) {
        parentId = existing._id;
        continue;
      }
      const fid = crypto.randomUUID();
      entry.folders.push({
        _id: fid,
        _parentId: parentId,
        name,
        parent_id: parentId,
        sort_order: i === parts.length - 1 ? sortOrder : 0,
      });
      parentId = fid;
    }
  }

  // 解析关联项目
  for (const row of itemRows) {
    const username = String(row['用户名'] || '').trim();
    const entry = userMap.get(username);
    if (!entry) continue;
    const folderPath = String(row['文件夹路径'] || '').trim();
    const entityTypeRaw = String(row['实体类型'] || '').trim();
    const entityType = ENTITY_TYPE_FROM_ZH[entityTypeRaw] || entityTypeRaw;
    const entityCode = String(row['实体编码'] || '').trim();
    const entityVersion = String(row['实体版本'] || '').trim();
    if (!entityCode) continue;
    let folderId = '';
    if (folderPath) {
      const parts = folderPath.split('/').map(p => p.trim()).filter(Boolean);
      let parentId: string | null = null;
      for (const name of parts) {
        const f = entry.folders.find((ff: any) => ff.name === name && ff._parentId === parentId);
        if (f) { folderId = f._id; parentId = f._id; }
        else { folderId = ''; break; }
      }
    }
    entry.items.push({ folder_id: folderId, entity_type: entityType, entity_code: entityCode, entity_version: entityVersion });
  }

  // 解析共享
  for (const row of shareRows) {
    const folderPath = String(row['文件夹路径'] || '').trim();
    const sharedUsername = String(row['共享给用户名'] || '').trim();
    const permission = String(row['权限'] || 'view').trim();
    if (!folderPath || !sharedUsername) continue;
    let folderId = '';
    for (const [, entry] of userMap) {
      const parts = folderPath.split('/').map(p => p.trim()).filter(Boolean);
      let parentId: string | null = null;
      for (const name of parts) {
        const f = entry.folders.find((ff: any) => ff.name === name && ff._parentId === parentId);
        if (f) { folderId = f._id; parentId = f._id; }
        else { folderId = ''; break; }
      }
      if (folderId) {
        entry.shares.push({ folder_id: folderId, shared_with_username: sharedUsername, shared_with_user_id: '', permission });
        break;
      }
    }
  }

  // 构建后端数据
  const dashboardData: any[] = [];
  const partMap = new Map<string, string>();
  const asmMap = new Map<string, string>();
  const docMap = new Map<string, string>();
  for (const p of useDataStore.getState().parts) partMap.set(`${p.code}|${p.version || ''}`, p.id);
  for (const a of useDataStore.getState().assemblies) asmMap.set(`${a.code}|${a.version || ''}`, a.id);
  for (const d of useDataStore.getState().documents) docMap.set(`${d.code}|${d.version || ''}`, d.id);

  for (const [username, userEntry] of userMap) {
    const userId = usernameToUserId[username];
    if (!userId) continue;
    const folders = (userEntry.folders || []).map((f: any) => ({
      id: f._id || crypto.randomUUID(), parent_id: f._parentId || null,
      name: f.name || '', sort_order: f.sort_order ?? 0,
    }));
    const items = (userEntry.items || []).map((it: any) => {
      const key = `${it.entity_code || ''}|${it.entity_version || ''}`;
      const map = it.entity_type === 'part' ? partMap : it.entity_type === 'assembly' ? asmMap : docMap;
      return {
        id: crypto.randomUUID(), folder_id: it.folder_id || '',
        entity_type: it.entity_type || 'part', entity_id: map.get(key) || '', entity_code: it.entity_code || '',
      };
    });
    const shares = (userEntry.shares || []).map((sh: any) => ({
      id: crypto.randomUUID(), folder_id: sh.folder_id || '',
      shared_with_user_id: usernameToUserId[sh.shared_with_username] || '',
      permission: sh.permission || 'view',
    }));
    dashboardData.push({
      user_id: userId, username, real_name: userEntry.real_name,
      dashboard: { name: userEntry.dashboard_name || '我的看板' }, folders, items, shares,
    });
  }

  const rows: ImportRow[] = overviewRows.map((row) => ({
    status: '新增' as const,
    code: String(row['用户名'] || '').trim(),
    name: String(row['姓名'] || ''),
    version: '',
    remark: `看板: ${row['看板名称'] || ''}`,
  }));

  return { type: 'dashboard', rows, docRelationCount: overviewRows.length, _dashboardData: dashboardData };
}

/**
 * 执行用户看板导入
 */
export async function executeDashboardImport(preview: ImportPreview): Promise<void> {
  const dashboardData = preview._dashboardData;
  if (!dashboardData || dashboardData.length === 0) {
    throw new Error('无看板数据可导入');
  }

  const totalItems = dashboardData.reduce((s, e: any) => s + ((e as any).items?.length || 0), 0);
  console.log('[dashboardImport] sending to backend:', dashboardData.length, 'entries,', totalItems, 'items');

  try {
    const res = await api.post('/dashboard/import-all', dashboardData);
    console.log('[dashboardImport] backend response:', res.data);
    return res.data;
  } catch (err: any) {
    console.error('导入用户看板失败', err);
    throw err;
  }
}

// ================================================================
// EXPORT ALL DATA (统一导出)
// ================================================================

/**
 * 导出零件到指定目录
 */
async function exportPartsToDir(dirHandle: FileSystemDirectoryHandle): Promise<void> {
  const parts = useDataStore.getState().parts;
  if (parts.length === 0) return;

  const wb = await _buildPartsWorkbook();
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  await writeBlobToDirectory(
    dirHandle,
    '零件清单.xlsx',
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
}

export type ExportProgressCallback = (message: string) => void;

/**
 * 统一导出全部数据到同一个文件夹
 * 顺序：自定义字段 → 用户 → 看板 → 图文档 → 零件 → 部件 → 构型项 → 构型配置
 * 通过 onProgress 回调报告进度
 */
export async function exportAllData(
  onProgress?: ExportProgressCallback,
): Promise<void> {
  if (!supportsFileSystemAccess()) {
    throw new Error('您的浏览器不支持文件夹操作，请使用 Chrome 86+ 或 Edge 86+');
  }

  const dirHandle = await window.showDirectoryPicker({
    mode: 'readwrite',
    startIn: 'downloads',
  });

  // 先刷新数据确保最新
  onProgress?.('正在同步最新数据...');
  await useDataStore.getState().syncAll();

  // 0. 导出自定义字段定义
  const defs = useDataStore.getState().customFieldDefs;
  if (defs.length > 0) {
    onProgress?.(`正在导出自定义字段定义 (${defs.length} 个字段)...`);
    await exportCustomFieldDefs(dirHandle);
  }

  // 0.5. 导出用户
  const userRes = await usersApi.list({ page_size: 10000 });
  const userList: unknown[] = Array.isArray(userRes.data)
    ? userRes.data
    : ((userRes.data as { items?: unknown[] })?.items || []);
  if (userList.length > 0) {
    onProgress?.(`正在导出用户 (${userList.length} 条记录)...`);
    await exportUsers(dirHandle);
  } else {
    onProgress?.('用户: 无数据，跳过');
  }

  // 0.6. 导出用户看板
  onProgress?.('正在导出用户看板...');
  await exportDashboard(dirHandle);

  // 1. 导出图文档（含附件）
  const docs = useDataStore.getState().documents;
  if (docs.length > 0) {
    const attCount = docs.filter((d) => d.file_id).length;
    onProgress?.(`正在导出图文档 (${docs.length} 条记录, ${attCount} 个附件)...`);
    await exportDocumentsToFolder(dirHandle);
  } else {
    onProgress?.('图文档: 无数据，跳过');
  }

  // 2. 导出零件
  const parts = useDataStore.getState().parts;
  if (parts.length > 0) {
    onProgress?.(`正在导出零件 (${parts.length} 条记录)...`);
    await exportPartsToDir(dirHandle);
  } else {
    onProgress?.('零件: 无数据，跳过');
  }

  // 3. 导出部件
  const assemblies = useDataStore.getState().assemblies;
  if (assemblies.length > 0) {
    onProgress?.(`正在导出部件 (${assemblies.length} 条记录)...`);
    await exportAssembliesToFolder(dirHandle);
  } else {
    onProgress?.('部件: 无数据，跳过');
  }

  // 4. 导出构型项
  onProgress?.('正在导出构型项...');
  const ciExported = await exportConfigItemsToDir(dirHandle);
  onProgress?.(ciExported ? '构型项导出完成' : '构型项: 无数据，跳过');

  // 5. 导出构型配置
  onProgress?.('正在导出构型配置...');
  const cpExported = await exportConfigProfilesToDir(dirHandle);
  onProgress?.(cpExported ? '构型配置导出完成' : '构型配置: 无数据，跳过');

  onProgress?.('全部数据导出完成');
}

// ================================================================
// IMPORT ALL DATA (统一导入)
// ================================================================

/**
 * 从目录中读取 xlsx 文件并解析为 JSON 行
 */
async function _readXlsxFromDir(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<Record<string, unknown>[]> {
  const buf = await readFileAsBuffer(dirHandle, fileName);
  if (!buf) return [];
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
}

/** 从目录中读取 xlsx 文件并返回为 File（用于 importCustomFieldDefs） */
async function _readXlsxAsFile(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
): Promise<File | null> {
  try {
    const fileHandle = await dirHandle.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    return file;
  } catch {
    return null;
  }
}

/**
 * 统一导入全部数据
 * 顺序：自定义字段 → 用户 → 图文档 → 零件 → 部件 → 构型项 → 构型配置 → 用户看板
 */
export async function importAllData(
  onProgress?: ExportProgressCallback,
): Promise<void> {
  if (!supportsFileSystemAccess()) {
    throw new Error('您的浏览器不支持文件夹操作，请使用 Chrome 86+ 或 Edge 86+');
  }

  const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
  // 设置全局目录句柄，供 executeXxxImport 使用（附件上传、BOM 文件读取）
  _importDirHandle = dirHandle;

  // ===== 1. 导入自定义字段 =====
  onProgress?.('正在导入自定义字段...');
  const cfFile = await _readXlsxAsFile(dirHandle, '自定义字段定义.xlsx');
  if (cfFile) {
    const result = await importCustomFieldDefs(cfFile);
    onProgress?.(`自定义字段: 新增 ${result.created} 个, 更新 ${result.updated} 个`);
  } else {
    onProgress?.('自定义字段: 无文件，跳过');
  }

  // ===== 1.5. 导入用户 =====
  const userFile = await _readXlsxAsFile(dirHandle, '用户清单.xlsx');
  if (userFile) {
    onProgress?.('正在导入用户...');
    const userPreview = await previewUsersImport(userFile);
    await executeUsersImport(userPreview);
    onProgress?.('用户导入完成');
  } else {
    onProgress?.('用户: 无文件，跳过');
  }

  // ===== 2. 导入图文档 =====
  const docRows = await _readXlsxFromDir(dirHandle, '图文档清单.xlsx');
  if (docRows.length > 0) {
    onProgress?.(`正在导入图文档 (${docRows.length} 条)...`);
    const preview = await previewDocumentsImport(dirHandle);
    await executeDocumentsImport(preview);
    onProgress?.('图文档导入完成');
  } else {
    onProgress?.('图文档: 无数据，跳过');
  }

  // ===== 3. 导入零件 =====
  const partRows = await _readXlsxFromDir(dirHandle, '零件清单.xlsx');
  if (partRows.length > 0) {
    onProgress?.(`正在导入零件 (${partRows.length} 条)...`);
    const partFile = await _readXlsxAsFile(dirHandle, '零件清单.xlsx');
    if (partFile) {
      const preview = await previewPartsImport(partFile);
      await executePartsImport(preview);
    }
    onProgress?.('零件导入完成');
  } else {
    onProgress?.('零件: 无数据，跳过');
  }

  // ===== 4. 导入部件（含 BOM） =====
  const asmRows = await _readXlsxFromDir(dirHandle, '部件清单.xlsx');
  if (asmRows.length > 0) {
    onProgress?.(`正在导入部件 (${asmRows.length} 条)...`);
    const preview = await previewAssembliesImport(dirHandle);
    await executeAssembliesImport(preview);
    onProgress?.('部件导入完成');
  } else {
    onProgress?.('部件: 无数据，跳过');
  }

  // ===== 5. 导入构型项（依赖零件/部件/图文档，故在其后） =====
  const ciFile = await _readXlsxAsFile(dirHandle, '构型项.xlsx');
  if (ciFile) {
    onProgress?.('正在导入构型项...');
    const ciPreview = await previewConfigurationItemsImport(ciFile);
    const ciResult = await executeConfigurationItemsImport(ciPreview);
    onProgress?.(`构型项: 新增 ${ciResult.created} 个, 更新 ${ciResult.updated} 个`);
  } else {
    onProgress?.('构型项: 无文件，跳过');
  }

  // ===== 6. 导入构型配置（依赖构型项，故在构型项后） =====
  const cpFile = await _readXlsxAsFile(dirHandle, '构型配置.xlsx');
  if (cpFile) {
    onProgress?.('正在导入构型配置...');
    const cpPreview = await previewConfigurationProfilesImport(cpFile);
    const cpResult = await executeConfigurationProfilesImport(cpPreview);
    onProgress?.(`构型配置: 新增 ${cpResult.created} 个, 更新 ${cpResult.updated} 个`);
  } else {
    onProgress?.('构型配置: 无文件，跳过');
  }

  // ===== 7. 导入用户看板（最后导入，因为关联了图文档、零部件和构型项） =====
  const dashFile = await _readXlsxAsFile(dirHandle, '用户看板.xlsx');
  if (dashFile) {
    onProgress?.('正在导入用户看板...');
    const dashPreview = await previewDashboardImport(dirHandle);
    await executeDashboardImport(dashPreview);
    onProgress?.('用户看板导入完成');
  } else {
    onProgress?.('用户看板: 无文件，跳过');
  }

  onProgress?.('全部数据导入完成');
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

  // Sheet1: 构型项清单
  const sheet1Rows = detailData.map((d: any) => ({
    构型号: d.code || '',
    名称: d.name || '',
    备注: d.remark || '',
    创建时间: d.created_at || '',
    更新时间: d.updated_at || '',
  }));

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

/** 导出构型项到指定目录（固定文件名 构型项.xlsx），无数据则跳过 */
async function exportConfigItemsToDir(dirHandle: FileSystemDirectoryHandle): Promise<boolean> {
  const wb = await _buildConfigItemsWorkbook();
  if (!wb) return false;
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  await writeBlobToDirectory(
    dirHandle,
    '构型项.xlsx',
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
  return true;
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
// CONFIGURATION ITEM IMPORT
// ================================================================

/**
 * 预览构型项导入
 */
export async function previewConfigurationItemsImport(file: File): Promise<ImportPreview> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });

  const ws1 = wb.Sheets['构型项清单'];
  if (!ws1) throw new Error('Excel 中未找到 "构型项清单" Sheet');

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws1);
  if (rawRows.length === 0) throw new Error('Excel 中无数据');

  // 获取现有构型项列表
  const existingItems: any[] = await fetchAllPages((page, pageSize) =>
    configurationApi.listItems({ page, page_size: pageSize }).then((r) => r.data),
  );
  const existingMap = new Map<string, any>();
  for (const item of existingItems) {
    existingMap.set(item.code, item);
  }

  // 解析各关联 Sheet
  const partRelRows = wb.Sheets['关联零部件']
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['关联零部件'])
    : [];
  const childRelRows = wb.Sheets['子构型项']
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['子构型项'])
    : [];
  const docRelRows = wb.Sheets['关联图文档']
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['关联图文档'])
    : [];

  // 预查关联对象
  const store = useDataStore.getState();
  let partWarnings = 0;
  let childWarnings = 0;

  // 按构型号分组关联数据
  const partsByCode = new Map<string, any[]>();
  for (const r of partRelRows) {
    const code = String(r['构型号'] || '').trim();
    if (!partsByCode.has(code)) partsByCode.set(code, []);
    const partCode = String(r['零部件件号'] || '').trim();
    const partVer = String(r['零部件版本'] || '').trim();
    const found = store.parts.find((p: Part) => p.code === partCode && (p.version || '') === partVer)
               || store.assemblies.find((a: Assembly) => a.code === partCode && (a.version || '') === partVer);
    if (!found) partWarnings++;
    partsByCode.get(code)!.push(r);
  }

  const childrenByCode = new Map<string, any[]>();
  const allCodes = new Set(rawRows.map((r) => String(r['构型号'] || '').trim()));
  const orphanParents = new Set<string>();
  const orphanChildren = new Set<string>();
  for (const r of childRelRows) {
    const code = String(r['父构型号'] || '').trim();
    if (!childrenByCode.has(code)) childrenByCode.set(code, []);
    const childCode = String(r['子构型号'] || '').trim();
    const found = existingMap.has(childCode);
    if (!found) childWarnings++;
    // 检查父构型号是否存在于此批导入的构型项清单中
    if (!allCodes.has(code)) orphanParents.add(code);
    // 检查子构型号是否存在于此批导入的构型项清单中
    if (!allCodes.has(childCode)) orphanChildren.add(childCode);
    childrenByCode.get(code)!.push(r);
  }

  const docsByCode = new Map<string, any[]>();
  for (const r of docRelRows) {
    const code = String(r['构型号'] || '').trim();
    if (!docsByCode.has(code)) docsByCode.set(code, []);
    docsByCode.get(code)!.push(r);
  }

  const rows: ImportRow[] = rawRows.map((raw) => {
    const code = String(raw['构型号'] || '').trim();
    const name = String(raw['名称'] || '').trim();

    if (!code || !name) {
      return {
        status: '错误' as const,
        code, name, version: '',
        error: '缺少必填字段（构型号或名称）',
      };
    }

    const existing = existingMap.get(code);
    const status = existing ? ('更新' as const) : ('新增' as const);

    return {
      status,
      code,
      name,
      version: '',
      remark: String(raw['备注'] || ''),
      _partCount: (partsByCode.get(code) || []).length,
      _childCount: (childrenByCode.get(code) || []).length,
      _docCount: (docsByCode.get(code) || []).length,
      _data: {
        code,
        name,
        spec: String(raw['规格型号'] || ''),
        remark: String(raw['备注'] || ''),
        _parts: (partsByCode.get(code) || []).map((r: any) => ({
          part_type: String(r['零部件类型'] || 'part').trim(),
          part_code: String(r['零部件件号'] || '').trim(),
          part_version: String(r['零部件版本'] || '').trim(),
          quantity: parseInt(String(r['用量'] ?? '')) || 1,
          is_required: String(r['是否必选'] || '').trim().toUpperCase() === 'TRUE',
        })),
        _children: (childrenByCode.get(code) || []).map((r: any) => ({
          child_code: String(r['子构型号'] || '').trim(),
          quantity: parseInt(String(r['用量'] ?? '')) || 1,
          is_required: String(r['是否必选'] || '').trim().toUpperCase() === 'TRUE',
        })),
        _docLinks: (docsByCode.get(code) || []).map((r: any) => ({
          doc_code: String(r['图文档编号'] || '').trim(),
          doc_version: String(r['图文档版本'] || '').trim(),
        })),
      },
    };
  });

  return {
    type: 'configuration_item',
    rows,
    partWarnings,
    childWarnings,
    partRelationCount: partRelRows.length,
    childRelationCount: childRelRows.length,
    docRelationCount: docRelRows.length,
    orphanParentCodes: orphanParents.size > 0 ? [...orphanParents] : undefined,
    orphanChildCodes: orphanChildren.size > 0 ? [...orphanChildren] : undefined,
  };
}

/**
 * 执行构型项导入
 */
export async function executeConfigurationItemsImport(preview: ImportPreview): Promise<ImportResult> {
  const validRows = preview.rows.filter(r => r.status !== '错误');
  const warnings: string[] = [];
  let createdCount = 0;
  let updatedCount = 0;

  // 获取现有构型项列表（重新查询确保最新）
  const existingItems: any[] = await fetchAllPages((page, pageSize) =>
    configurationApi.listItems({ page, page_size: pageSize }).then((r) => r.data),
  );
  const existingMap = new Map<string, any>();
  for (const item of existingItems) existingMap.set(item.code, item);

  // 第一轮：创建/更新构型项主记录，建立 code→id Map
  const codeToId = new Map<string, string>();
  for (const row of validRows) {
    const data = row._data!;
    // 构造主记录 payload，去掉内部关联字段
    const mainPayload = { code: data.code, name: data.name, spec: data.spec, remark: data.remark };
    try {
      if (row.status === '更新') {
        const existing = existingMap.get(row.code);
        if (existing) {
          await configurationApi.updateItem(existing.id, mainPayload as any);
          codeToId.set(row.code, existing.id);
          updatedCount++;
        }
      } else {
        const res = await configurationApi.createItem(mainPayload as any);
        const created = res.data;
        codeToId.set(row.code, created.id);
        row._newId = created.id;
        createdCount++;
      }
    } catch (err: any) {
      warnings.push(`构型项 ${row.code}: 主记录写入失败 ${err?.message || ''}`);
      console.error(`导入构型项失败: ${row.code}`, err);
    }
  }

  // 重建 codeToId 以包含本次新增之前已存在的项
  for (const item of existingItems) {
    if (!codeToId.has(item.code)) codeToId.set(item.code, item.id);
  }

  const store = useDataStore.getState();

  // 第二轮：处理关联零部件
  for (const row of validRows) {
    const data = row._data!;
    const ciId = codeToId.get(row.code);
    if (!ciId) continue;
    const parts: any[] = (data._parts as any[]) || [];
    if (parts.length === 0) continue;

    try {
      // 更新模式：先清空旧关联
      if (row.status === '更新') {
        try {
          const detailRes = await configurationApi.getItem(ciId);
          const oldParts: any[] = detailRes.data.parts || [];
          for (const op of oldParts) {
            await configurationApi.removePart(ciId, op.id);
          }
        } catch (err) {
          console.warn(`清除构型项旧零部件关联失败: ${row.code}`, err);
        }
      }

      // 解析零部件件号+版本→entity_id，构造 addParts 参数
      const partsToAdd: { part_type: string; part_id: string; is_required: boolean; quantity: number }[] = [];
      for (const p of parts) {
        const pc = p.part_code as string;
        const pv = p.part_version as string;
        const entity = store.parts.find((e: Part) => e.code === pc && (e.version || '') === pv)
                    || store.assemblies.find((e: Assembly) => e.code === pc && (e.version || '') === pv);
        if (!entity) {
          warnings.push(`构型项 ${row.code}: 关联零部件未找到 ${pc}@${pv}`);
          console.warn(`构型项 ${row.code} 关联零部件未找到，跳过: ${pc}@${pv}`);
          continue;
        }
        partsToAdd.push({
          part_type: p.part_type as string || 'part',
          part_id: entity.id,
          is_required: p.is_required as boolean,
          quantity: (p.quantity as number) || 1,
        });
      }

      if (partsToAdd.length > 0) {
        await configurationApi.addParts(ciId, partsToAdd);
      }
    } catch (err) {
      console.warn(`处理构型项零部件关联失败: ${row.code}`, err);
    }
  }

  // 第三轮：处理子构型项
  for (const row of validRows) {
    const data = row._data!;
    const ciId = codeToId.get(row.code);
    if (!ciId) continue;
    const children: any[] = (data._children as any[]) || [];
    if (children.length === 0) continue;

    try {
      // 更新模式：先清空旧子项
      if (row.status === '更新') {
        try {
          const detailRes = await configurationApi.getItem(ciId);
          const oldChildren: any[] = detailRes.data.children || [];
          for (const oc of oldChildren) {
            await configurationApi.removeChild(ciId, oc.id);
          }
        } catch (err) {
          console.warn(`清除构型项旧子项关联失败: ${row.code}`, err);
        }
      }

      // 解析子构型号→子构型项 id
      const childrenToAdd: { child_id: string; is_required: boolean; quantity: number }[] = [];
      for (const c of children) {
        const childCode = c.child_code as string;
        const childId = codeToId.get(childCode);
        if (!childId) {
          warnings.push(`构型项 ${row.code}: 子构型项未找到 ${childCode}`);
          console.warn(`构型项 ${row.code} 子构型项未找到，跳过: ${childCode}`);
          continue;
        }
        childrenToAdd.push({ child_id: childId, is_required: c.is_required as boolean, quantity: (c.quantity as number) ?? 1 });
      }

      if (childrenToAdd.length > 0) {
        await configurationApi.addChildren(ciId, childrenToAdd);
      }
    } catch (err: any) {
      warnings.push(`构型项 ${row.code}: 子项关联写入失败 ${err?.message || ''}`);
      console.warn(`处理构型项子项关联失败: ${row.code}`, err);
    }
  }

  // 第四轮：处理关联图文档
  for (const row of validRows) {
    const data = row._data!;
    const ciId = codeToId.get(row.code);
    if (!ciId) continue;
    const docLinks: any[] = (data._docLinks as any[]) || [];
    if (docLinks.length === 0) continue;

    try {
      // 更新模式：先清空旧文档关联
      if (row.status === '更新') {
        try {
          const oldDocsRes = await entityDocumentsApi.list('configuration', ciId);
          const oldDocs: any[] = oldDocsRes.data || [];
          for (const od of oldDocs) {
            await entityDocumentsApi.remove('configuration', ciId, od.id);
          }
        } catch (err) {
          console.warn(`清除构型项旧图文档关联失败: ${row.code}`, err);
        }
      }

      // 添加新图文档关联
      for (const dl of docLinks) {
        const dc = dl.doc_code as string;
        const dv = dl.doc_version as string;
        const doc = store.documents.find(
          (d: Document) => d.code === dc && (d.version || '') === dv
        );
        if (!doc) {
          warnings.push(`构型项 ${row.code}: 关联图文档未找到 ${dc}@${dv}`);
          console.warn(`构型项 ${row.code} 关联图文档未找到，跳过: ${dc}@${dv}`);
          continue;
        }
        try {
          await entityDocumentsApi.add('configuration', ciId, {
            document_id: doc.id,
          });
        } catch (err) {
          console.warn(`添加构型项图文档关联失败: ${row.code} → ${dc}`, err);
        }
      }
    } catch (err) {
      console.warn(`处理构型项图文档关联失败: ${row.code}`, err);
    }
  }

  // 刷新 store
  await useDataStore.getState().syncAll();
  return { created: createdCount, updated: updatedCount, warnings };
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

/** 导出构型配置到指定目录（固定文件名 构型配置.xlsx），无数据则跳过 */
async function exportConfigProfilesToDir(dirHandle: FileSystemDirectoryHandle): Promise<boolean> {
  const wb = await _buildConfigProfilesWorkbook();
  if (!wb) return false;
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  await writeBlobToDirectory(
    dirHandle,
    '构型配置.xlsx',
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
  return true;
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

/**
 * 预览构型配置导入
 */
export async function previewConfigurationProfilesImport(file: File): Promise<ImportPreview> {
  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: 'array' });

  // 配置清单 Sheet（兼容旧文件名"构型配置"）
  const mainSheetName =
    wb.SheetNames.find((n) => n.includes('配置清单') || n.includes('构型配置')) ?? wb.SheetNames[0];
  const ws = wb.Sheets[mainSheetName];
  const rawRows: Record<string, string>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  if (rawRows.length === 0) throw new Error('Excel 中无数据');

  // 正式配置清单项 Sheet，按配置编号分组
  const itemSheetName = wb.SheetNames.find((n) => n.includes('清单项'));
  const itemRows: Record<string, string>[] = itemSheetName
    ? XLSX.utils.sheet_to_json(wb.Sheets[itemSheetName], { defval: '' })
    : [];
  const itemsByCode = new Map<string, any[]>();
  for (const r of itemRows) {
    const code = String(r['配置编号'] || '').trim();
    if (!code) continue;
    if (!itemsByCode.has(code)) itemsByCode.set(code, []);
    itemsByCode.get(code)!.push({
      source_ci_code: String(r['来源构型号'] || '').trim(),
      item_type: String(r['项类型'] || '').trim(),
      item_code: String(r['项编号'] || '').trim(),
      item_name: String(r['项名称'] || '').trim(),
      is_required: String(r['是否必选'] || '').trim().toUpperCase() === 'TRUE',
      is_selected: String(r['是否选用'] || '').trim().toUpperCase() === 'TRUE',
      source_type: String(r['来源类型'] || '').trim(),
      sort_order: Number(r['排序']) || 0,
    });
  }

  // 获取现有构型项列表，建立 code→item map
  const ciItems: any[] = await fetchAllPages((page, pageSize) =>
    configurationApi.listItems({ page, page_size: pageSize }).then((r) => r.data),
  );
  const ciMap = new Map<string, any>();
  for (const ci of ciItems) ciMap.set(ci.code, ci);

  // 获取现有 Profile 列表，建立 code→profile map（匹配键为配置编号）
  const existingProfiles: any[] = await fetchAllPages((page, pageSize) =>
    configurationProfileApi.list({ page, page_size: pageSize }).then((r) => r.data),
  );
  const profileCodeMap = new Map<string, any>();
  for (const p of existingProfiles) profileCodeMap.set(p.code, p);

  let ciWarnings = 0;
  let profileItemCount = 0;
  const rows: ImportRow[] = rawRows.map((raw) => {
    const name = String(raw['配置名称'] || '').trim();
    const code = String(raw['配置编号'] || '').trim();
    const ciCode = String(raw['关联构型号'] || '').trim();
    const remark = String(raw['备注'] || '').trim();

    if (!code || !name) {
      return {
        status: '错误' as const,
        code: code || '—',
        name: name || '—',
        version: '',
        error: '缺少必填字段（配置编号或配置名称）',
      };
    }

    // 关联构型号可空；填了但找不到则告警
    if (ciCode && !ciMap.has(ciCode)) ciWarnings++;

    const items = itemsByCode.get(code) || [];
    profileItemCount += items.length;

    const existing = profileCodeMap.get(code);
    const rowStatus: '新增' | '更新' = existing ? '更新' : '新增';

    return {
      status: rowStatus,
      code,
      name,
      version: '',
      remark,
      _ciCode: ciCode || undefined,
      _itemCount: items.length,
      _data: {
        code,
        name,
        remark,
        status: String(raw['状态'] || '').trim(),
        effectivity_start: String(raw['起始架次号'] || '').trim(),
        effectivity_end: String(raw['结束架次号'] || '').trim(),
        _items: items,
      },
    };
  });

  return {
    type: 'configuration_profile',
    rows,
    ciWarnings,
    profileItemCount,
  };
}

/**
 * 执行构型配置导入
 */
export async function executeConfigurationProfilesImport(preview: ImportPreview): Promise<ImportResult> {
  const validRows = preview.rows.filter((r) => r.status !== '错误');
  const warnings: string[] = [];
  let created = 0;
  let updated = 0;

  // 最新构型项列表：code→id 与 id→code（清单项匹配用）
  const ciItems: any[] = await fetchAllPages((page, pageSize) =>
    configurationApi.listItems({ page, page_size: pageSize }).then((r) => r.data),
  );
  const ciMap = new Map<string, any>();
  const ciIdToCode = new Map<string, string>();
  for (const ci of ciItems) {
    ciMap.set(ci.code, ci);
    ciIdToCode.set(String(ci.id), ci.code);
  }

  // 现有 Profile 列表：code→profile（匹配键为配置编号）
  const existingProfiles: any[] = await fetchAllPages((page, pageSize) =>
    configurationProfileApi.list({ page, page_size: pageSize }).then((r) => r.data),
  );
  const profileCodeMap = new Map<string, any>();
  for (const p of existingProfiles) profileCodeMap.set(p.code, p);

  // 清单项匹配键：项类型 + 项编号 + 来源构型号
  const itemKey = (itemType: string, itemCode: string, sourceCiCode: string) =>
    `${itemType}|${itemCode}|${sourceCiCode}`;

  for (const row of validRows) {
    const data = row._data!;
    const ciCode = row._ciCode;
    const ciId = ciCode ? ciMap.get(ciCode)?.id : undefined;
    if (ciCode && !ciId) warnings.push(`配置 ${row.code}: 关联构型项未找到 ${ciCode}`);

    const payload: Record<string, unknown> = {
      code: data.code,
      name: data.name,
      configuration_item_id: ciId ?? null,
      effectivity_start: (data.effectivity_start as string) || undefined,
      effectivity_end: (data.effectivity_end as string) || undefined,
      remark: (data.remark as string) || undefined,
    };

    let profileId: string | undefined;
    try {
      if (row.status === '更新') {
        const existing = profileCodeMap.get(row.code);
        if (!existing) continue;
        profileId = existing.id;
        if (existing.status !== 'draft') {
          warnings.push(`配置 ${row.code}: 非草稿状态（${existing.status}）跳过更新`);
          continue;
        }
        await configurationProfileApi.update(profileId!, payload as any);
        updated++;
      } else {
        const res = await configurationProfileApi.create(payload as any);
        profileId = res.data.id;
        row._newId = profileId;
        created++;
      }
    } catch (err: any) {
      warnings.push(`配置 ${row.code}: 主记录写入失败 ${err?.message || ''}`);
      console.error(`导入构型配置失败: ${row.code}`, err);
      continue;
    }

    if (!profileId) continue;

    // 还原正式清单的勾选状态（仅在关联构型项存在时有清单可还原）
    const items = (data._items as any[]) || [];
    if (ciId) {
      try {
        // 反向检查：导出"选中/必选"项是否在当前构型项有对应工作表项，否则视为未能恢复
        const detail = await configurationProfileApi.get(profileId);
        const working: any[] = detail.data.items || [];
        const workingKeys = new Set<string>();
        for (const wi of working) {
          const wiSourceCode = wi.source_config_item_id
            ? ciIdToCode.get(String(wi.source_config_item_id)) || ''
            : '';
          workingKeys.add(itemKey(wi.item_type, wi.item_code, wiSourceCode));
        }
        const missing: string[] = [];
        for (const it of items) {
          if (it.is_selected || it.is_required) {
            const k = itemKey(it.item_type, it.item_code, it.source_ci_code);
            if (!workingKeys.has(k)) missing.push(it.item_code || k);
          }
        }
        if (missing.length > 0) {
          warnings.push(
            `配置 ${row.code}: ${missing.length} 个清单项在当前构型项中无对应、未能恢复（${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}）`,
          );
        }

        // 强制按导入的 is_selected 还原整棵清单（含必选件、子构型项节点取消的级联），后端同步正式清单
        await configurationProfileApi.restoreChecklist(
          profileId,
          items.map((it) => ({
            item_type: it.item_type,
            item_code: it.item_code,
            source_ci_code: it.source_ci_code || '',
            is_selected: !!it.is_selected,
          })),
        );
      } catch (err: any) {
        warnings.push(`配置 ${row.code}: 清单项勾选还原失败 ${err?.message || ''}`);
        console.warn(`还原构型配置清单项失败: ${row.code}`, err);
      }
    }

    // 恢复状态（导出为 active/archived 时；勾选还原须在草稿态完成，故放最后）
    const targetStatus = (data.status as string) || '';
    if (targetStatus && targetStatus !== 'draft') {
      try {
        if (targetStatus === 'active') {
          await configurationProfileApi.submit(profileId);
        } else if (targetStatus === 'archived') {
          await configurationProfileApi.archive(profileId);
        }
      } catch (err: any) {
        warnings.push(`配置 ${row.code}: 状态恢复为 ${targetStatus} 失败（可能权限不足或不允许的状态转换）${err?.message || ''}`);
        console.warn(`恢复构型配置状态失败: ${row.code}`, err);
      }
    }
  }

  await useDataStore.getState().syncAll();
  return { created, updated, warnings };
}

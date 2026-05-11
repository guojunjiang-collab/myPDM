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
  assembliesApi,
  documentsApi,
  entityDocumentsApi,
  assemblyPartsApi,
  customFieldsApi,
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
}

/** 导入预览结果 */
export interface ImportPreview {
  type: 'part' | 'assembly' | 'document';
  rows: ImportRow[];
  /** 关联图文档未找到数 */
  docWarnings?: number;
  /** BOM 文件数 */
  bomFiles?: number;
  /** BOM 匹配数 */
  bomMatched?: number;
  /** 关联图文档数 */
  docRelationCount?: number;
}

// ================================================================
// Utilities
// ================================================================

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
  const results = await Promise.allSettled(
    entityIds.map((id) => customFieldsApi.getValues(entityType, id)),
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
  const results = await Promise.allSettled(
    entityIds.map((id) => entityDocumentsApi.list(entityType, id)),
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
  const results = await Promise.allSettled(
    preview.rows
      .filter((r) => r.status !== '错误')
      .map(async (row) => {
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
      }),
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
  _entityType?: string;
  _entityId?: string;
}

/** 递归收集 BOM 树 */
async function gatherBOMTree(
  assemblyId: string,
  level: number = 1,
): Promise<BOMRow[]> {
  const rows: BOMRow[] = [];
  try {
    const res = await assemblyPartsApi.list(assemblyId);
    const items: AssemblyPartItem[] = res.data || [];

    for (const item of items) {
      const detail = item.child_detail;
      rows.push({
        层级: level,
        类型: item.childType === 'part' ? '零件' : '部件',
        件号: detail?.code || '',
        中文名称: detail?.name || '',
        规格型号: detail?.spec || '',
        版本: detail?.version || '',
        状态: statusToZh(detail?.status),
        用量: item.quantity,
        _entityType: item.childType,
        _entityId: detail?.id || '',
      });

      // 如果是部件，递归收集子项
      if (item.childType === 'component' && detail?.id) {
        const children = await gatherBOMTree(detail.id, level + 1);
        rows.push(...children);
      }
    }
  } catch (err) {
    console.error(`获取 BOM 树失败: ${assemblyId}`, err);
  }
  return rows;
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
    const bomRows = await gatherBOMTree(asm.id);
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
  const [cfValuesMap, docMap, bomRows] = await Promise.all([
    asmDefs.length > 0 ? loadCustomFieldValues('component', [asm.id]) : Promise.resolve(new Map()),
    loadEntityDocuments('assembly', [asm.id]),
    gatherBOMTree(asm.id),
  ]);

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
    _entityType: 'component',
    _entityId: asm.id,
  };
  const allBomRows = [selfRow, ...bomRows];

  // 收集 BOM 中所有实体的 ID（按类型分组）
  const partIds: string[] = [];
  const componentIds: string[] = [];
  for (const row of allBomRows) {
    if (row._entityId) {
      if (row._entityType === 'part') {
        partIds.push(row._entityId);
      } else if (row._entityType === 'component') {
        componentIds.push(row._entityId);
      }
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

  // 构建带自定义字段的 BOM 行
  const bomSheetRows: Record<string, unknown>[] = allBomRows.map((row) => {
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
    const defsForType = row._entityType === 'part' ? partDefs : asmDefs;
    const cfMap = row._entityType === 'part' ? partCfMap : compCfMap;
    if (row._entityId && defsForType.length > 0) {
      const values = cfMap.get(row._entityId) || {};
      for (const def of defsForType) {
        r[def.name] = values[def.id] ?? '';
      }
    }

    // 对于该实体不存在的字段类型，填充空值
    const otherDefs = row._entityType === 'part' ? asmDefs : partDefs;
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
        const quantity = Number(bomRow['用量']) || 1;
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
          // 格式: 编号_版本_文件名
          const exportName = `${doc.code}_${doc.version || 'A'}_${fileName}`;
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
        const expectedPrefix = `${row.code}_${row.version || 'A'}_`;
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

            // 提取原始文件名（去掉编号_版本_前缀）
            const originalName = attFileName.slice(expectedPrefix.length);

            // 如果 > 1GB 给出警告
            if (fileBuffer.byteLength > 1024 * 1024 * 1024) {
              alert(`警告: 文件 ${attFileName} 超过 1GB`);
            }

            await documentsApi.uploadAttachment(docId, {
              file_name: originalName,
              file_data: base64,
            });
          } catch (err) {
            console.error(`上传附件失败: ${attFileName}`, err);
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
 * 顺序：图文档 → 零件 → 部件
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
 * 顺序：自定义字段 → 图文档 → 零件 → 部件
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

  onProgress?.('全部数据导入完成');
}

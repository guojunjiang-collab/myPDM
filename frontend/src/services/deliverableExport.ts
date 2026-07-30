/**
 * 项目交付物汇总 - Excel 导出
 * 单文件四个 sheet，导出全量四类，不受当前 TAB 与搜索/筛选影响。
 */
import * as XLSX from 'xlsx';
import { downloadBlob } from '../lib/file';
import { DELIVERABLE_TABS, statusLabel } from '../pages/Project/deliverableUtils';
import type { DeliverableSummary } from '../types/project';

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export function exportDeliverables(summary: DeliverableSummary, projectCode: string): void {
  const wb = XLSX.utils.book_new();

  for (const tab of DELIVERABLE_TABS) {
    const headers = [
      '编号',
      tab.nameLabel,
      ...(tab.showVersion ? ['版本'] : []),
      tab.extraLabel,
      '状态',
      '创建人',
      '来源任务',
    ];
    const rows = summary[tab.key].map((i) => [
      i.code,
      i.name,
      ...(tab.showVersion ? [i.version || ''] : []),
      i.extra || '',
      statusLabel(i.status),
      i.creator_name || '',
      i.tasks.map((t) => `${t.code} ${t.name}`).join('; '),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((h) => ({ wch: h === '来源任务' ? 36 : h === '编号' ? 18 : 16 }));
    XLSX.utils.book_append_sheet(wb, ws, tab.label);
  }

  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, `项目交付物汇总_${projectCode}_${todayStr()}.xlsx`);
}

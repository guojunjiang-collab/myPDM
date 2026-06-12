/**
 * 构型配置详情 导出 PDF
 * 路线：内存数据 → 富 HTML（卡片/徽章/彩色表）→ 隐藏 iframe 打印另存为 PDF
 */

import type { ConfigurationProfileDetail, ConfigTreeNode } from '../types';
import * as XLSX from 'xlsx';

// ─── 标签字典 ──────────────────────────────────────────────────
const SP: Record<string, string> = { draft: '草稿', active: '生效', archived: '归档' };
const SE: Record<string, string> = { draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废' };

// ─── 工具 ──────────────────────────────────────────────────────
const hsc2 = (v: unknown): string => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') || '-';
const lb2 = (m: Record<string, string>, k: unknown): string => m[String(k ?? '')] || String(k ?? '') || '-';

// ─── CSS 样式（与 ECO/ECR 导出共用视觉风格）────────────────────
const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Microsoft YaHei","PingFang SC","Segoe UI",sans-serif;color:#1f2937;padding:20px;font-size:12px;line-height:1.5}
.header{border-bottom:1px solid #e5e7eb;padding-bottom:14px;margin-bottom:16px}
.header h1{font-size:18px;margin-bottom:4px}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500;margin-left:6px;vertical-align:middle}
.bg-b{background:#dbeafe;color:#1d4ed8}.bg-g{background:#dcfce7;color:#15803d}
.bg-o{background:#ffedd5;color:#c2410c}.bg-gr{background:#f3f4f6;color:#4b5563}
.section{margin-bottom:18px}
.section h2{font-size:14px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin-bottom:10px;color:#374151}
.info-g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.info-c{background:#f9fafb;border:1px solid #f3f4f6;border-radius:6px;padding:8px 10px}
.info-c label{display:block;font-size:10px;color:#9ca3af;margin-bottom:2px}
.info-c .v{font-size:12px;font-weight:500;word-break:break-word}
table{width:100%;border-collapse:collapse;margin:8px 0}
th,td{border:1px solid #e5e7eb;padding:5px 8px;text-align:left;vertical-align:top;font-size:11px}
th{background:#f3f4f6;font-weight:600;color:#6b7280}
tr{page-break-inside:avoid}
.footer{margin-top:20px;padding-top:10px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:10px}
@page{size:A4 landscape;margin:10mm}
@media print{body{padding:0}}
`;

function htag2(cls: string, text: string): string {
  return `<span class="badge ${cls}">${hsc2(text)}</span>`;
}

// ─── 构建 HTML ─────────────────────────────────────────────────
function buildProfileHtml(
  profile: ConfigurationProfileDetail,
  configTree: ConfigTreeNode | null,
): string {
  const p: string[] = [];
  const ciCode = profile.configuration_item?.code || '';
  const ciName = profile.configuration_item?.name || '';
  const ci = ciCode ? `${ciCode}${ciName ? ' ' + ciName : ''}` : '-';
  const effectivity =
    profile.effectivity_start || profile.effectivity_end
      ? `${profile.effectivity_start || '-'} ~ ${profile.effectivity_end || '-'}`
      : '-';

  // Status badge
  const stBadge = (s: string) => {
    const m: Record<string, string> = { draft: 'bg-gr', active: 'bg-g', archived: 'bg-b' };
    return htag2(m[s] || 'bg-gr', lb2(SP, s));
  };

  // Header
  p.push(`<div class="header"><h1>构型配置：${hsc2(profile.code || '')} ${stBadge(profile.status)}</h1><div style="font-size:13px;color:#6b7280;margin-top:4px">${hsc2(profile.name || '')}</div></div>`);

  // 基本信息
  p.push(`<div class="section"><h2>基本信息</h2><div class="info-g">`);
  p.push(`<div class="info-c"><label>编号</label><div class="v">${hsc2(profile.code)}</div></div>`);
  p.push(`<div class="info-c"><label>名称</label><div class="v">${hsc2(profile.name)}</div></div>`);
  p.push(`<div class="info-c"><label>关联构型项</label><div class="v">${hsc2(ci)}</div></div>`);
  p.push(`<div class="info-c"><label>架次范围</label><div class="v">${hsc2(effectivity)}</div></div>`);
  p.push(`<div class="info-c"><label>状态</label><div class="v">${stBadge(profile.status)}</div></div>`);
  p.push(`<div class="info-c"><label>备注</label><div class="v">${hsc2(profile.remark || '-')}</div></div>`);
  p.push(`</div></div>`);

  // 正式配置清单
  p.push(`<div class="section"><h2>正式配置清单</h2>`);
  interface Row { level: string; code: string; name: string; type: string; partCode: string; version: string; status: string; quantity: string; }
  const rows: Row[] = [];
  const walk = (node: ConfigTreeNode, lvl: number) => {
    if (!node.is_selected && !node.is_required) return;
    const lp = lvl > 0 ? '-'.repeat(lvl) : '';
    // 构型项行
    rows.push({ level: `${lp}${lvl}`, code: node.code, name: node.name, type: '构型项', partCode: '', version: '', status: '', quantity: String(node.quantity ?? 1) });
    // 选中零部件
    for (const part of node.parts) {
      if (part.item_type === 'config_item') continue;
      if (!part.is_selected) continue;
      rows.push({
        level: '-'.repeat(lvl),
        code: '',
        name: part.item_name || '',
        type: part.item_type === 'assembly' ? '部件' : '零件',
        partCode: part.item_code || '',
        version: part.item_version || '',
        status: lb2(SE, part.item_status),
        quantity: String(part.quantity ?? 1),
      });
    }
    for (const child of node.children) walk(child, lvl + 1);
  };
  if (configTree) walk(configTree, 0);

  if (rows.length === 0) {
    p.push(`<div style="color:#9ca3af;font-size:11px;padding:12px 0">暂无配置清单</div>`);
  } else {
    p.push(`<table><thead><tr><th>层级</th><th>构型号/零部件件号</th><th>名称</th><th>类型</th><th>版本</th><th>状态</th><th>数量</th></tr></thead><tbody>`);
    for (const r of rows) {
      const entityType = r.type === '构型项' ? '构型项' : (r.type === '部件' ? '部件' : '零件');
      const color = entityType === '构型项' ? '#7c3aed' : (entityType === '部件' ? '#15803d' : '#1d4ed8');
      p.push(`<tr><td>${hsc2(r.level)}</td><td>${hsc2(r.code || r.partCode)}</td><td>${hsc2(r.name)}</td><td style="color:${color};font-weight:600">${hsc2(entityType)}</td><td>${hsc2(r.version)}</td><td>${hsc2(r.status)}</td><td>${hsc2(r.quantity)}</td></tr>`);
    }
    p.push(`</tbody></table>`);
  }
  p.push(`</div>`);

  p.push(`<div class="footer">导出时间：${new Date().toLocaleString('zh-CN')}</div>`);
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + hsc2(`构型配置_${profile.code || ''}`) + '</title><style>' + CSS + '</style></head><body>' + p.join('\n') + '</body></html>';
}

/**
 * 导出构型配置详情为 PDF：生成富 HTML → 隐藏 iframe 打印
 */
export function exportProfilePdf(
  profile: ConfigurationProfileDetail,
  configTree: ConfigTreeNode | null,
): void {
  const html = buildProfileHtml(profile, configTree);
  const title = `构型配置_${profile.code || ''}`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed'; iframe.style.right = '0'; iframe.style.bottom = '0';
  iframe.style.width = '0'; iframe.style.height = '0'; iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) { iframe.parentNode?.removeChild(iframe); throw new Error('无法创建打印文档'); }

  const cleanup = () => { setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 1000); };

  doc.open(); doc.write(html); doc.close();
  iframe.contentWindow!.onafterprint = cleanup;
  setTimeout(() => { iframe.contentWindow!.focus(); iframe.contentWindow!.print(); cleanup(); }, 400);
}

/**
 * 导出正式配置清单为 Excel（.xlsx）
 */
export function exportProfileExcel(
  profile: ConfigurationProfileDetail,
  configTree: ConfigTreeNode | null,
): void {
  const header = ['层级', '构型号/零部件件号', '名称', '类型', '版本', '状态', '数量'];
  const rows: string[][] = [];

  const walk = (node: ConfigTreeNode, lvl: number) => {
    if (!node.is_selected && !node.is_required) return;
    const lp = lvl > 0 ? '-'.repeat(lvl) : '';
    rows.push([`${lp}${lvl}`, node.code, node.name, '构型项', '', '', String(node.quantity ?? 1)]);
    for (const part of node.parts) {
      if (part.item_type === 'config_item' || !part.is_selected) continue;
      rows.push([
        '-'.repeat(lvl),
        part.item_code || '',
        part.item_name || '',
        part.item_type === 'assembly' ? '部件' : '零件',
        part.item_version || '',
        SE[part.item_status || ''] || part.item_status || '',
        String(part.quantity ?? 1),
      ]);
    }
    for (const child of node.children) walk(child, lvl + 1);
  };
  if (configTree) walk(configTree, 0);

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws['!cols'] = [{ wch: 8 }, { wch: 22 }, { wch: 24 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '正式配置清单');
  XLSX.writeFile(wb, `正式配置清单_${profile.code || ''}.xlsx`);
}

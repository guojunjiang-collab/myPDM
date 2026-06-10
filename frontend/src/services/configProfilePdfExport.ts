/**
 * 构型配置详情 导出 PDF
 * 路线：内存数据 → Markdown（中间产物）→ HTML（marked）→ 浏览器打印另存为 PDF
 * 正式配置清单全层级展开，不受界面折叠状态影响。
 */

import { marked } from 'marked';
import type { ConfigurationProfileDetail, ConfigTreeNode } from '../types';

const STATUS_PROFILE_ZH: Record<string, string> = {
  draft: '草稿',
  active: '生效',
  archived: '归档',
};

const STATUS_ENTITY_ZH: Record<string, string> = {
  draft: '草稿',
  frozen: '冻结',
  released: '发布',
  obsolete: '作废',
};

/** 转义 Markdown 管道表格单元格内容（| 与换行） */
function cell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/** 正式配置清单的一行 */
interface FormalRow {
  level: string;
  code: string;
  name: string;
  type: string;
  partCode: string;
  version: string;
  status: string;
  quantity: string;
}

/**
 * 递归收集正式配置清单行（规则与 ProfileEditModal.renderFormalRows 一致）
 */
function collectFormalRows(node: ConfigTreeNode, level: number, out: FormalRow[]): void {
  if (!node.is_selected && !node.is_required) return;

  const levelPrefix = level > 0 ? '-'.repeat(level) : '';
  // 构型项行
  out.push({
    level: `${levelPrefix}${level}`,
    code: node.code,
    name: node.name,
    type: '构型项',
    partCode: '',
    version: '',
    status: '',
    quantity: String(node.quantity ?? 1),
  });

  // 选中的零部件行
  for (const part of node.parts) {
    if (part.item_type === 'config_item') continue;
    if (!part.is_selected) continue;
    out.push({
      level: '-'.repeat(level),
      code: '',
      name: part.item_name || '',
      type: part.item_type === 'assembly' ? '部件' : '零件',
      partCode: part.item_code || '',
      version: part.item_version || '',
      status: STATUS_ENTITY_ZH[part.item_status || ''] || part.item_status || '',
      quantity: String(part.quantity ?? 1),
    });
  }

  // 递归子构型项
  for (const child of node.children) {
    collectFormalRows(child, level + 1, out);
  }
}

/**
 * 生成构型配置详情的 Markdown（基本信息 + 全展开正式配置清单）
 */
export function buildProfileMarkdown(
  profile: ConfigurationProfileDetail,
  configTree: ConfigTreeNode | null,
): string {
  const lines: string[] = [];

  lines.push(`# 构型配置：${profile.code || ''} ${profile.name || ''}`.trim());
  lines.push('');

  // 基本信息
  const ciCode = profile.configuration_item?.code || '';
  const ciName = profile.configuration_item?.name || '';
  const ci = ciCode ? `${ciCode}${ciName ? ' ' + ciName : ''}` : '-';
  const effectivity =
    profile.effectivity_start || profile.effectivity_end
      ? `${profile.effectivity_start || '-'} ~ ${profile.effectivity_end || '-'}`
      : '-';

  lines.push('## 基本信息');
  lines.push('');
  lines.push('| 项目 | 内容 |');
  lines.push('| --- | --- |');
  lines.push(`| 编号 | ${cell(profile.code)} |`);
  lines.push(`| 名称 | ${cell(profile.name)} |`);
  lines.push(`| 关联构型项 | ${cell(ci)} |`);
  lines.push(`| 架次范围 | ${cell(effectivity)} |`);
  lines.push(`| 状态 | ${cell(STATUS_PROFILE_ZH[profile.status] || profile.status)} |`);
  lines.push(`| 备注 | ${cell(profile.remark || '-')} |`);
  lines.push('');

  // 正式配置清单
  lines.push('## 正式配置清单');
  lines.push('');
  const rows: FormalRow[] = [];
  if (configTree) collectFormalRows(configTree, 0, rows);

  if (rows.length === 0) {
    lines.push('（暂无配置清单）');
  } else {
    lines.push('| 层级 | 构型号/零部件 件号 | 名称 | 类型 | 版本 | 状态 | 数量 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows) {
      lines.push(
        `| ${cell(r.level)} | ${cell(r.code || r.partCode)} | ${cell(r.name)} | ${cell(r.type)} | ${cell(r.version)} | ${cell(r.status)} | ${cell(r.quantity)} |`,
      );
    }
  }
  lines.push('');

  return lines.join('\n');
}

/** 打印用 HTML 模板的样式 */
const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif; color: #1f2937; margin: 0; padding: 24px; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  h2 { font-size: 15px; margin: 20px 0 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; }
  th, td { border: 1px solid #d1d5db; padding: 5px 8px; text-align: left; vertical-align: top; word-break: break-word; }
  th { background: #f3f4f6; font-weight: 600; }
  tr { page-break-inside: avoid; }
  @page { size: A4; margin: 14mm; }
  @media print { body { padding: 0; } }
`;

/**
 * 导出构型配置详情为 PDF：生成 MD → HTML → 隐藏 iframe 打印（用户另存为 PDF）
 */
export function exportProfilePdf(
  profile: ConfigurationProfileDetail,
  configTree: ConfigTreeNode | null,
): void {
  const md = buildProfileMarkdown(profile, configTree);
  const bodyHtml = marked.parse(md, { async: false }) as string;
  const title = `构型配置_${profile.code || ''}`;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${title}</title><style>${PRINT_CSS}</style></head>
<body>${bodyHtml}</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const cleanup = () => {
    // 延迟移除，确保打印任务已开始
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 1000);
  };

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    iframe.parentNode?.removeChild(iframe);
    throw new Error('无法创建打印文档');
  }
  doc.open();
  doc.write(html);
  doc.close();

  const win = iframe.contentWindow!;
  win.onafterprint = cleanup;
  // 等待内容渲染后再打印
  setTimeout(() => {
    win.focus();
    win.print();
    // 兜底清理（部分浏览器不触发 onafterprint）
    cleanup();
  }, 200);
}

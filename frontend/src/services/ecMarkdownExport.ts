/**
 * ECR / ECO 详情导出为 Markdown 文档
 * ------------------------------------------------------------------
 * 纯前端：直接把详情接口已加载的数据按详情界面的分区渲染成 .md 文本并下载。
 * 不依赖后端，不做导入（这类单据是过程记录，导出留档即可）。
 */

// ─── 标签字典（与详情界面一致）──────────────────────────────────
const REASON_LABELS: Record<string, string> = {
  quality_defect: '质量缺陷',
  design_opt: '设计优化',
  cost_reduce: '成本降低',
  customer_req: '客户要求',
  supplier_change: '供应商变更',
  process_improve: '工艺改进',
  other: '其他',
};
const CATEGORY_LABELS: Record<string, string> = {
  design_change: '设计变更',
  process_change: '工艺变更',
  material_change: '材料变更',
  other: '其他',
};
const PRIORITY_LABELS: Record<string, string> = {
  urgent: '紧急', high: '高', normal: '普通', low: '低',
};
const ECR_STATUS_LABELS: Record<string, string> = {
  draft: '草稿', created: '创建', submitted: '提交评审', reviewing: '审核中',
  approved: '审批通过', rejected: '审批驳回', returned: '退回修改', closed: '关闭',
};
const DECISION_LABELS: Record<string, string> = {
  approved: '通过', rejected: '驳回', returned: '退回',
};
const ACTION_LABELS: Record<string, string> = {
  upgrade: '升版', qty_change: '数量修改', delete: '删除', no_change: '不变',
  create: '新建', add_existing: '增选已有', add_new: '新增子项',
};

// ─── 工具 ──────────────────────────────────────────────────────
const lbl = (map: Record<string, string>, k: unknown): string =>
  map[String(k ?? '')] || String(k ?? '') || '-';

const dt = (v: unknown): string => {
  if (!v) return '-';
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('zh-CN');
};

/** 转义 markdown 表格单元格内容（去换行、转义竖线） */
const cell = (v: unknown): string =>
  String(v ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim() || '-';

const targetQty = (n: any): string => {
  const to = n?.quantity_change?.to;
  if (to != null && to !== '') return String(to);
  return n?.quantity != null ? String(n.quantity) : '-';
};

function mdTable(headers: string[], rows: (unknown[])[]): string {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}`;
}

function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── BOM 影响链表格 ────────────────────────────────────────────
// 用彩色圆点区分动作（纯文本，MarkText/GitHub/各查看器都能显示）：
//   🔵升版  🟠数量修改  🔴删除  ⚪不变  🟢新建/新增子项
const ACTION_DOT: Record<string, string> = {
  upgrade: '🔵', qty_change: '🟠', delete: '🔴', no_change: '⚪',
  create: '🟢', add_existing: '🟢', add_new: '🟢',
};
const actionCell = (a: string): string => `${ACTION_DOT[a] || ''} ${lbl(ACTION_LABELS, a)}`.trim();

function bomImpactSection(item: any): string {
  const out: string[] = [];
  const impact = item.bom_impact || {};
  const up: any[] = impact.upward_chain || [];
  const down: any[] = impact.downward_items || [];

  if (up.length > 0) {
    out.push('**📊 向上溯源链**\n');
    out.push(mdTable(
      ['层级', '类型', '件号', '名称', '版本', '动作', '数量', '目标数量', '变更描述'],
      up.map((n) => [
        n.level ?? '-',
        n.entity_type === 'part' ? '零件' : '部件',
        n.entity_code, n.entity_name, n.entity_version,
        actionCell(n.action), n.quantity ?? '-', targetQty(n),
        n.change_description || '',
      ]),
    ));
    out.push('');
  }
  if (down.length > 0) {
    out.push('**📋 向下子项**\n');
    out.push(mdTable(
      ['类型', '件号', '名称', '版本', '动作', '数量', '目标数量', '变更描述'],
      down.map((n) => [
        n.entity_type === 'part' ? '零件' : '部件',
        n.entity_code, n.entity_name, n.entity_version,
        actionCell(n.action), n.quantity ?? '-', targetQty(n),
        n.change_description || '',
      ]),
    ));
    out.push('');
  }
  if (up.length === 0 && down.length === 0) {
    out.push('_（无 BOM 影响分析数据）_\n');
  }
  return out.join('\n');
}

// ─── ECR 导出 ──────────────────────────────────────────────────
export function exportEcrMarkdown(detail: any, statusLogs: any[] = []): void {
  const d = detail || {};
  const out: string[] = [];

  out.push(`# ${d.ecr_number || 'ECR'} ${d.title || ''}`.trim());
  out.push('');
  out.push(`> 状态：${lbl(ECR_STATUS_LABELS, d.status)} ｜ 优先级：${lbl(PRIORITY_LABELS, d.priority)}`);
  out.push('');

  // 基本信息
  out.push('## 基本信息\n');
  out.push(mdTable(['项', '值'], [
    ['变更原因', lbl(REASON_LABELS, d.reason)],
    ['变更类别', lbl(CATEGORY_LABELS, d.category)],
    ['优先级', lbl(PRIORITY_LABELS, d.priority)],
    ['审批模式', d.review_mode === 'all' ? '会签' : (d.review_mode === 'any' ? '或签' : '-')],
    ['创建人', d.creator_name || '-'],
    ['创建时间', dt(d.created_at)],
    ['更新时间', dt(d.updated_at)],
    ['审批时间', dt(d.reviewed_at)],
  ]));
  out.push('');

  // 变更描述
  if (d.description) {
    out.push('## 变更描述\n');
    out.push(d.description);
    out.push('');
  }

  // 审批进度
  const reviewers: any[] = d.reviewers || [];
  if (reviewers.length > 0) {
    const recByUser = new Map<string, any>();
    for (const r of d.review_records || []) recByUser.set(String(r.reviewer_id), r);
    out.push(`## 审批进度（${d.approved_count || 0}/${d.reviewers_count || reviewers.length} 已审批）\n`);
    out.push(mdTable(
      ['顺序', '审批人', '结果', '意见', '时间'],
      reviewers
        .slice()
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
        .map((r) => {
          const rec = recByUser.get(String(r.user_id));
          return [
            r.seq ?? '-',
            r.user_name || '-',
            rec ? lbl(DECISION_LABELS, rec.decision) : '待审批',
            rec?.comment || '',
            rec ? dt(rec.created_at) : '-',
          ];
        }),
    ));
    out.push('');
  }

  // 受影响物料 + 影响分析
  const affected: any[] = d.affected_items || [];
  if (affected.length > 0) {
    out.push(`## 受影响物料（${affected.length}）\n`);
    for (const item of affected) {
      const typeLabel = item.entity_type === 'part' ? '零件' : '部件';
      out.push(`### 📦 ${item.entity_code} ${item.entity_name || ''} v${item.entity_version || ''}（${typeLabel}）`);
      if (item.change_type || item.change_description) {
        out.push(`变更：${item.change_type || ''} ${item.change_description || ''}`.trim());
      }
      out.push('');
      out.push(bomImpactSection(item));
    }
  }

  // 关联图文档
  const docs: any[] = d.document_links || [];
  if (docs.length > 0) {
    out.push('## 关联图文档\n');
    out.push(mdTable(
      ['图文档编号', '名称', '版本'],
      docs.map((l) => [
        l.document_code || l.document?.code || '-',
        l.document_name || l.document?.name || '-',
        l.document_version || l.document?.version || '-',
      ]),
    ));
    out.push('');
  }

  // 知会人
  const cc: any[] = d.cc_users || [];
  if (cc.length > 0) {
    out.push('## 知会人\n');
    out.push(cc.map((c) => c.user_name).filter(Boolean).join('、') || '-');
    out.push('');
  }

  // 状态记录
  const logs: any[] = statusLogs && statusLogs.length > 0 ? statusLogs : (d.status_logs || []);
  if (logs.length > 0) {
    out.push('## 状态记录\n');
    for (const log of logs) {
      const time = dt(log.created_at);
      const to = lbl(ECR_STATUS_LABELS, log.to_status);
      const op = log.operator_name || '';
      const comment = log.comment ? ` —— ${log.comment}` : '';
      out.push(`- ${time}  **${to}**（${op}）${comment}`);
    }
    out.push('');
  }

  out.push('');
  out.push(`_导出时间：${new Date().toLocaleString('zh-CN')}_`);

  downloadMarkdown(`${d.ecr_number || 'ECR'}_${d.title || ''}.md`, out.join('\n'));
}

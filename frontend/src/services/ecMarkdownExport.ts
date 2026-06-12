/**
 * ECR / ECO 详情导出为 Markdown 文档
 * ------------------------------------------------------------------
 * 纯前端：直接把详情接口已加载的数据按详情界面的分区渲染成 .md 文本并下载。
 * 不做导入（这类单据是过程记录，导出留档即可）。
 * ECO 的「ECR 变更分析」与详情界面一致：拉源 ECR 的 BOM 拓扑 + 叠加执行项编辑值。
 */
import { ecrApi } from './api';

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
const ECO_STATUS_LABELS: Record<string, string> = {
  draft: '草稿', reviewing: '评审中', approved: '已批准', rejected: '已驳回',
  executing: '执行中', completed: '已完成', closed: '已关闭', returned: '退回修改',
};
// 零部件状态（工程变更结果列表）
const ENTITY_STATUS_LABELS: Record<string, string> = {
  draft: '草稿', frozen: '冻结', released: '发布', obsolete: '作废',
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
/** 构建 ECR 详情的 Markdown 文本（PDF 导出复用此中间产物） */
export function buildEcrMarkdown(detail: any, statusLogs: any[] = []): string {
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

  return out.join('\n');
}

export function exportEcrMarkdown(detail: any, statusLogs: any[] = []): void {
  const d = detail || {};
  downloadMarkdown(`${d.ecr_number || 'ECR'}_${d.title || ''}.md`, buildEcrMarkdown(detail, statusLogs));
}

// ─── ECO 导出 ──────────────────────────────────────────────────
const DOWNWARD_ACTIONS = ['qty_change', 'delete', 'add_existing', 'add_new'];
const CHANGING_ACTIONS = ['upgrade', 'qty_change', 'delete'];
const EXEC_STATUS_LABELS: Record<string, string> = {
  released: '已发布', frozen: '已冻结', draft: '已升版',
};

/** 计算下一个版本号（A→B→…→Z→AA），与 ECOEditView.nextVer 一致 */
function nextVer(v: string): string {
  if (!v) return 'A';
  const c = [...v.toUpperCase()];
  let i = c.length - 1;
  while (i >= 0) {
    if (c[i] === 'Z') { c[i] = 'A'; i--; }
    else { c[i] = String.fromCharCode(c[i].charCodeAt(0) + 1); return c.join(''); }
  }
  return 'A' + c.join('');
}

/** ECO 执行后版本：已执行用 new_version，否则变更类动作预览 nextVer */
function resultVersion(action: string, version: string, newVersion?: string): string {
  if (newVersion) return newVersion;
  if (CHANGING_ACTIONS.includes(action)) return nextVer(version || 'A');
  return version || '-';
}

/** ECO 执行后状态标签（对应详情 StatusBadge） */
function execStatusLabel(action: string, newStatus?: string): string {
  if (action === 'no_change') return '不变更';
  return EXEC_STATUS_LABELS[newStatus || ''] || '未执行';
}

const byCode = (a: any, b: any) => String(a.entity_code || '').localeCompare(String(b.entity_code || ''), 'zh-CN');

/**
 * 向上溯源链按层级树展开排序，与 ECOEditView 详情界面一致：
 * 按 chain 原始顺序建树（父子嵌套依赖 level 序列），只对同级兄弟按件号排序，
 * 再前序遍历展平 —— 保证父→子→孙相邻，而非全局按件号打散。
 */
function orderUpwardHierarchically(items: any[]): any[] {
  interface T { node: any; children: T[]; }
  const roots: T[] = [];
  const stack: T[] = [];
  for (const item of items) {
    const t: T = { node: item, children: [] };
    while (stack.length > 0 && (stack[stack.length - 1].node.level ?? 0) >= (item.level ?? 0)) stack.pop();
    if (stack.length > 0) stack[stack.length - 1].children.push(t);
    else roots.push(t);
    stack.push(t);
  }
  const sortSiblings = (ns: T[]) => { ns.sort((a, b) => byCode(a.node, b.node)); ns.forEach((n) => sortSiblings(n.children)); };
  sortSiblings(roots);
  const out: any[] = [];
  const walk = (ns: T[]) => { for (const t of ns) { out.push(t.node); walk(t.children); } };
  walk(roots);
  return out;
}

/** 把 ECR bom_impact 节点叠加 ECO 执行项编辑值 + 执行结果（与 ECOEditView 一致） */
function ecoOverlayNode(n: any, saved: any): any {
  return {
    ...n,
    action: saved?.action || n.action || 'no_change',
    _targetQty: saved?.detail?._targetQty ?? (n.quantity_change?.to ?? n.quantity ?? ''),
    _desc: saved?.detail?._desc || n.change_description || '',
    _newVersion: saved?.new_version || '',
    _newStatus: saved?.new_entity_status || '',
  };
}

/**
 * 导出 ECO 详情为 Markdown。
 * BOM 变更分析与详情界面一致：拉源 ECR 的 bom_impact 拓扑（含版本/层级），
 * 再叠加 ECO 自身 execution_items 的编辑内容（动作/目标数量/变更描述）。
 */
export async function buildEcoMarkdown(eco: any): Promise<string> {
  const e = eco || {};
  const out: string[] = [];

  out.push(`# ${e.eco_number || 'ECO'} ${e.title || ''}`.trim());
  out.push('');
  out.push(`> 状态：${lbl(ECO_STATUS_LABELS, e.status)} ｜ 优先级：${lbl(PRIORITY_LABELS, e.priority)}`);
  out.push('');

  // 基本信息
  out.push('## 基本信息\n');
  out.push(mdTable(['项', '值'], [
    ['变更原因', lbl(REASON_LABELS, e.reason)],
    ['变更类别', lbl(CATEGORY_LABELS, e.category)],
    ['优先级', lbl(PRIORITY_LABELS, e.priority)],
    ['审批模式', e.review_mode === 'all' ? '会签' : (e.review_mode === 'any' ? '或签' : '-')],
    ['创建人', e.creator_name || '-'],
    ['来源 ECR', e.ecr_number || '独立创建'],
    ['执行进度', `${e.execution_completed_count ?? 0}/${e.execution_count ?? (e.execution_items?.length ?? 0)}`],
    ['创建时间', dt(e.created_at)],
    ['更新时间', dt(e.updated_at)],
  ]));
  out.push('');

  // 变更描述
  if (e.description) {
    out.push('## 变更描述\n');
    out.push(e.description);
    out.push('');
  }

  // 审批进度
  const reviewers: any[] = e.reviewers || [];
  if (reviewers.length > 0) {
    const recByUser = new Map<string, any>();
    for (const r of e.review_records || []) recByUser.set(String(r.reviewer_id), r);
    out.push(`## 审批进度（${e.approved_count || 0}/${e.reviewers_count || reviewers.length} 已审批）\n`);
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

  // ECR 变更分析（拉源 ECR + 叠加执行项）
  const execItems: any[] = e.execution_items || [];
  let ecrData: any = null;
  if (e.ecr_id) {
    try { ecrData = (await ecrApi.get(e.ecr_id)).data; } catch { ecrData = null; }
  }

  if (ecrData && (ecrData.affected_items || []).length > 0) {
    // 执行项编辑值索引
    const savedMap = new Map<string, any>();
    for (const ei of execItems) {
      const aff = ei.detail?._affectedCode || '';
      const key = ei.entity_id || ei.entity_code;
      if (!key) continue;
      savedMap.set(key + '|' + aff, ei);
      if (!aff) savedMap.set(String(key), ei);
    }
    const lookup = (n: any, affCode: string) =>
      savedMap.get((n.entity_id || n.entity_code || '') + '|' + (affCode || '')) ||
      savedMap.get(n.entity_id) ||
      savedMap.get(n.entity_code);
    const usedKeys = new Set<string>();

    out.push(`## ECR 变更分析（${e.ecr_number || ecrData.ecr_number || 'ECR'}）\n`);
    for (const ai of ecrData.affected_items || []) {
      const bi = ai.bom_impact || {};
      const up = (bi.upward_chain || [])
        .filter((n: any) => (n.level ?? 0) > 0)
        .map((n: any) => { const s = lookup(n, ai.entity_code); if (s) usedKeys.add((s.entity_id || s.entity_code) + '|' + (s.detail?._affectedCode || '')); return ecoOverlayNode(n, s); });
      const down = (bi.downward_items || [])
        .map((n: any) => { const s = lookup(n, ai.entity_code); if (s) usedKeys.add((s.entity_id || s.entity_code) + '|' + (s.detail?._affectedCode || '')); return ecoOverlayNode(n, s); });

      // 手动新增子项（不在 ECR 链中）补到对应受影响对象下
      for (const ei of execItems) {
        if (!DOWNWARD_ACTIONS.includes(ei.action)) continue;
        if ((ei.detail?._affectedCode || '') !== ai.entity_code) continue;
        const k = (ei.entity_id || ei.entity_code) + '|' + (ei.detail?._affectedCode || '');
        if (usedKeys.has(k)) continue;
        usedKeys.add(k);
        down.push({
          entity_type: ei.entity_type, entity_code: ei.entity_code, entity_name: ei.entity_name,
          entity_version: '', action: ei.action,
          _targetQty: ei.detail?._targetQty ?? '', _desc: ei.detail?._desc || '',
          _newVersion: ei.new_version || '', _newStatus: ei.new_entity_status || '',
        });
      }

      // 向上溯源链按层级树展开排序，向下子项按件号排序（与 ECO 详情一致）
      const upOrdered = orderUpwardHierarchically(up);
      down.sort(byCode);

      const typeLabel = ai.entity_type === 'part' ? '零件' : '部件';
      out.push(`### 📦 ${ai.entity_code} ${ai.entity_name || ''} v${ai.entity_version || ''}（${typeLabel}）`);
      out.push('');
      if (upOrdered.length > 0) {
        out.push('**📊 向上溯源链**（ECR 评估 → ECO 执行后）\n');
        out.push(mdTable(
          ['层级', '类型', '件号', '名称', '原版本', '动作', '原数量', '目标数量', '变更描述', '执行后版本', '变更状态'],
          upOrdered.map((n: any) => [
            n.level ?? '-', n.entity_type === 'part' ? '零件' : '部件',
            n.entity_code, n.entity_name, n.entity_version,
            actionCell(n.action), n.quantity ?? '-', n._targetQty ?? '-', n._desc || '',
            resultVersion(n.action, n.entity_version, n._newVersion), execStatusLabel(n.action, n._newStatus),
          ]),
        ));
        out.push('');
      }
      if (down.length > 0) {
        out.push('**📋 向下子项**（ECR 评估 → ECO 执行后）\n');
        out.push(mdTable(
          ['类型', '件号', '名称', '原版本', '动作', '原数量', '目标数量', '变更描述', '执行后版本', '变更状态'],
          down.map((n: any) => [
            n.entity_type === 'part' ? '零件' : '部件',
            n.entity_code, n.entity_name, n.entity_version || '-',
            actionCell(n.action), n.quantity ?? '-', n._targetQty ?? '-', n._desc || '',
            resultVersion(n.action, n.entity_version, n._newVersion), execStatusLabel(n.action, n._newStatus),
          ]),
        ));
        out.push('');
      }
      if (up.length === 0 && down.length === 0) out.push('_（无影响链节点）_\n');
    }
  } else if (execItems.length > 0) {
    // 无源 ECR：按执行项扁平列出（兜底）
    out.push('## 变更明细\n');
    out.push(mdTable(
      ['对象类型', '件号', '名称', '动作', '目标数量', '变更描述', '受影响对象'],
      execItems.map((ei) => [
        ei.entity_type === 'part' ? '零件' : '部件',
        ei.entity_code, ei.entity_name, actionCell(ei.action),
        ei.detail?._targetQty ?? '-', ei.detail?._desc || '', ei.detail?._affectedCode || '',
      ]),
    ));
    out.push('');
  }

  // 工程变更结果（关联零部件 release_items）
  const releaseItems: any[] = e.release_items || [];
  if (releaseItems.length > 0) {
    out.push('## 工程变更结果\n');
    out.push(mdTable(
      ['类型', '件号', '名称', '规格型号', '版本', '状态', '用量'],
      releaseItems.map((ri) => [
        ri.entity_type === 'assembly' ? '部件' : '零件',
        ri.entity_code, ri.entity_name, ri.spec || '-',
        ri.entity_version || 'A',
        lbl(ENTITY_STATUS_LABELS, ri.status),
        ri.quantity ?? 1,
      ]),
    ));
    out.push('');
  }

  // 关联图文档
  const docs: any[] = e.document_links || [];
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
  const cc: any[] = e.cc_users || [];
  if (cc.length > 0) {
    out.push('## 知会人\n');
    out.push(cc.map((c) => c.user_name).filter(Boolean).join('、') || '-');
    out.push('');
  }

  // 状态记录
  const logs: any[] = e.status_logs || [];
  if (logs.length > 0) {
    out.push('## 状态记录\n');
    for (const log of logs) {
      const to = lbl(ECO_STATUS_LABELS, log.to_status);
      const op = log.operator_name || '';
      const comment = log.comment ? ` —— ${log.comment}` : '';
      out.push(`- ${dt(log.created_at)}  **${to}**（${op}）${comment}`);
    }
    out.push('');
  }

  out.push('');
  out.push(`_导出时间：${new Date().toLocaleString('zh-CN')}_`);

  return out.join('\n');
}

export async function exportEcoMarkdown(eco: any): Promise<void> {
  const e = eco || {};
  downloadMarkdown(`${e.eco_number || 'ECO'}_${e.title || ''}.md`, await buildEcoMarkdown(eco));
}

/**
 * ECR / ECO 详情 导出 PDF
 *
 * 路线 1 (ECR): 内存数据 → Markdown → HTML → iframe 打印
 * 路线 2 (ECO): 内存数据 → 富 HTML（卡片/徽章/彩色表）→ iframe 打印
 */

import { marked } from 'marked';
import { buildEcrMarkdown, buildEcoMarkdown } from './ecMarkdownExport';
import { ecrApi } from './api';

/** 打印用 HTML 模板的样式（与构型配置 PDF 导出一致） */
const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif; color: #1f2937; margin: 0; padding: 24px; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  h2 { font-size: 15px; margin: 20px 0 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  h3 { font-size: 13px; margin: 14px 0 6px; }
  blockquote { margin: 8px 0; padding: 4px 12px; border-left: 3px solid #d1d5db; color: #4b5563; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; }
  th, td { border: 1px solid #d1d5db; padding: 5px 8px; text-align: left; vertical-align: top; word-break: break-word; }
  th { background: #f3f4f6; font-weight: 600; }
  tr { page-break-inside: avoid; }
  @page { size: A4; margin: 14mm; }
  @media print { body { padding: 0; } }
`;

/** 把 Markdown 文本渲染成 HTML → 隐藏 iframe 打印（用户另存为 PDF） */
function printMarkdownAsPdf(md: string, title: string): void {
  const bodyHtml = marked.parse(md, { async: false }) as string;

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

// ─── ECR 标签字典 ──────────────────────────────────────────────
const ECR_ST: Record<string,string> = { draft:'草稿',created:'创建',submitted:'提交评审',reviewing:'审核中',approved:'审批通过',rejected:'审批驳回',returned:'退回修改',closed:'关闭' };
const ECR_RV: Record<string,string> = { all:'会签',any:'或签' };

const de = (v:unknown):string => { if(!v)return '-'; const d=new Date(v as string); return Number.isNaN(d.getTime())?String(v):d.toLocaleString('zh-CN'); };

/** 导出 ECR 详情为 PDF：生成富 HTML → 隐藏 iframe 打印 */
export function exportEcrPdf(detail: any, statusLogs: any[] = []): void {
  const d = detail || {};
  const logs = statusLogs && statusLogs.length > 0 ? statusLogs : (d.status_logs || []);
  const html = buildEcrHtml(d, logs);
  const title = `${d.ecr_number || 'ECR'}_${d.title || ''}`;
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

function buildEcrHtml(d:any, logs:any[]): string {
  const p:string[]=[];
  const esBadge = (s:string) => { const m:Record<string,string>={draft:'bg-gr',created:'bg-b',submitted:'bg-o',reviewing:'bg-b',approved:'bg-g',rejected:'bg-r',returned:'bg-o',closed:'bg-gr'}; return htag(m[s]||'bg-gr',lb(ECR_ST,s)); };
  const pBadge = (v:string) => { const m:Record<string,string>={urgent:'bg-r',high:'bg-o',normal:'bg-b',low:'bg-gr'}; return htag(m[v]||'bg-gr',lb(P,v)); };

  p.push(`<div class="header"><h1>${hsc(d.ecr_number||'ECR')} ${esBadge(d.status)} ${pBadge(d.priority)}</h1><div class="t">${hsc(d.title||'')}</div></div>`);

  // 基本信息
  p.push(`<div class="section"><h2>基本信息</h2><div class="info-g">`);
  p.push(`<div class="info-c"><label>变更原因</label><div class="v">${hsc(lb(R,d.reason))}</div></div>`);
  p.push(`<div class="info-c"><label>变更类别</label><div class="v">${hsc(lb(C,d.category))}</div></div>`);
  p.push(`<div class="info-c"><label>优先级</label><div class="v">${lb(P,d.priority)}</div></div>`);
  p.push(`<div class="info-c"><label>审批模式</label><div class="v">${hsc(lb(ECR_RV,d.review_mode))}</div></div>`);
  p.push(`<div class="info-c"><label>创建人</label><div class="v">${hsc(d.creator_name||'-')}</div></div>`);
  p.push(`<div class="info-c"><label>创建时间</label><div class="v">${de(d.created_at)}</div></div>`);
  p.push(`<div class="info-c"><label>更新时间</label><div class="v">${de(d.updated_at)}</div></div>`);
  p.push(`<div class="info-c"><label>审批时间</label><div class="v">${de(d.reviewed_at)}</div></div>`);
  p.push(`</div></div>`);

  if(d.description){ p.push(`<div class="section"><h2>变更描述</h2><div class="desc">${hsc(d.description)}</div></div>`); }

  // 审批进度
  const reviewers:any[]=d.reviewers||[];
  if(reviewers.length>0){
    const rm=new Map<string,any>(); for(const r of d.review_records||[]) rm.set(String(r.reviewer_id),r);
    p.push(`<div class="section"><h2>审批进度（${d.approved_count||0}/${d.reviewers_count||reviewers.length} 已审批）</h2>`);
    p.push(`<table><thead><tr><th>顺序</th><th>审批人</th><th>结果</th><th>意见</th><th>时间</th></tr></thead><tbody>`);
    for(const r of reviewers.slice().sort((a:any,b:any)=>(a.seq??0)-(b.seq??0))){
      const rec=rm.get(String(r.user_id));
      const dl=rec?lb(DC,rec.decision):'待审批';
      p.push(`<tr><td>${r.seq??'-'}</td><td>${hsc(r.user_name||'-')}</td><td class="b1">${hsc(dl)}</td><td>${hsc(rec?.comment||'')}</td><td>${rec?de(rec.created_at):'-'}</td></tr>`);
    }
    p.push(`</tbody></table></div>`);
  }

  // 关联图文档
  const docs:any[]=d.document_links||[];
  if(docs.length>0){
    p.push(`<div class="section"><h2>关联图文档</h2><table><thead><tr><th>图文档编号</th><th>名称</th><th>版本</th></tr></thead><tbody>`);
    for(const dl of docs) p.push(`<tr><td>${hsc(dl.document_code||dl.document?.code||'-')}</td><td>${hsc(dl.document_name||dl.document?.name||'-')}</td><td>${hsc(dl.document_version||dl.document?.version||'-')}</td></tr>`);
    p.push(`</tbody></table></div>`);
  }

  // 知会人
  const cc:any[]=d.cc_users||[];
  if(cc.length>0){ p.push(`<div class="section"><h2>知会用户</h2><div class="cc-list">${cc.map((c:any)=>`<span class="cc-b">${hsc(c.user_name)}</span>`).join('')}</div></div>`); }

  // 受影响物料 + BOM 影响分析
  const affected:any[]=d.affected_items||[];
  if(affected.length>0){
    p.push(`<div class="section"><h2>受影响物料（${affected.length}）</h2>`);
    for(const ai of affected){
      const bi=ai.bom_impact||{};
      const up:any[]=(bi.upward_chain||[]).filter((n:any)=>(n.level??0)>0);
      const down:any[]=bi.downward_items||[];
      const tl=ai.entity_type==='part'?'零件':'部件';
      p.push(`<div class="bom-card"><h3>📦 ${hsc(ai.entity_code)} ${hsc(ai.entity_name||'')} v${hsc(ai.entity_version||'')}（${tl}）</h3>`);
      // 受影响物料本身
      p.push(`<table style="margin-bottom:10px"><thead><tr><th style="width:20%">件号</th><th style="width:40%">名称</th><th style="width:20%">当前版本</th><th style="width:20%">变更</th></tr></thead><tbody>`);
      p.push(`<tr><td>${hsc(ai.entity_code)}</td><td>${hsc(ai.entity_name||'')}</td><td>${hsc(ai.entity_version||'-')}</td><td style="color:#2563eb;font-weight:600">${ai.change_type?lb(AL,ai.change_type):'-'}</td></tr>`);
      p.push(`</tbody></table>`);
      if(up.length>0){
        p.push(`<h4>📊 向上溯源链</h4>`);
        p.push(`<table><thead><tr><th>层级</th><th>类型</th><th>件号</th><th>名称</th><th>版本</th><th>动作</th><th>数量</th><th>目标数量</th><th>说明</th></tr></thead><tbody>`);
        for(const n of up) p.push(`<tr class="${ROW_BG[n.action]||''}"><td>${n.level!=null?'-'.repeat(n.level)+n.level:'-'}</td><td>${n.entity_type==='part'?'零件':'部件'}</td><td>${hsc(n.entity_code)}</td><td>${hsc(n.entity_name)}</td><td>${hsc(n.entity_version)}</td><td>${acTag(n.action||'no_change')}</td><td>${n.quantity??'-'}</td><td>${n.quantity_change?.to??n.quantity??'-'}</td><td>${hsc(n.change_description||'')}</td></tr>`);
        p.push(`</tbody></table>`);
      }
      if(down.length>0){
        p.push(`<h4>📋 向下子项</h4>`);
        p.push(`<table><thead><tr><th>类型</th><th>件号</th><th>名称</th><th>版本</th><th>动作</th><th>数量</th><th>目标数量</th><th>说明</th></tr></thead><tbody>`);
        for(const n of down) p.push(`<tr class="${ROW_BG[n.action]||''}"><td>${n.entity_type==='part'?'零件':'部件'}</td><td>${hsc(n.entity_code)}</td><td>${hsc(n.entity_name)}</td><td>${hsc(n.entity_version)}</td><td>${acTag(n.action||'no_change')}</td><td>${n.quantity??'-'}</td><td>${n.quantity_change?.to??n.quantity??'-'}</td><td>${hsc(n.change_description||'')}</td></tr>`);
        p.push(`</tbody></table>`);
      }
      if(up.length===0&&down.length===0) p.push(`<div style="color:#9ca3af;font-size:11px">无影响链节点</div>`);
      p.push(`</div>`);
    }
  }

  // 状态日志
  if(logs.length>0){
    p.push(`<div class="section"><h2>状态日志</h2>`);
    for(const l of logs) p.push(`<div class="log-i"><span class="t">${de(l.created_at)}</span> ${hsc(l.from_status||'-')} → <b>${hsc(lb(ECR_ST,l.to_status))}</b> by ${hsc(l.operator_name)} ${l.comment?`—— ${hsc(l.comment)}`:''}</div>`);
    p.push(`</div>`);
  }

  p.push(`<div class="footer">导出时间：${new Date().toLocaleString('zh-CN')}</div>`);
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + hsc(`${d.ecr_number||'ECR'}_${d.title||''}`) + '</title><style>' + ECO_HTML_CSS + '</style></head><body>' + p.join('\n') + '</body></html>';
}

/**
 * 导出 ECO 详情为 PDF：拉源 ECR + 叠加执行项生成富 HTML → iframe 打印。
 */

// ─── ECO 标签字典（与 ecMarkdownExport / 页面一致）──────────────
const R: Record<string, string> = { quality_defect:'质量缺陷',design_opt:'设计优化',cost_reduce:'成本降低',customer_req:'客户要求',supplier_change:'供应商变更',process_improve:'工艺改进',new_release:'首次发布',other:'其他' };
const C: Record<string, string> = { design_change:'设计变更',process_change:'工艺变更',material_change:'物料变更',new_release:'新发布',other:'其他' };
const P: Record<string, string> = { urgent:'紧急',high:'高',normal:'普通',low:'低' };
const ES: Record<string, string> = { draft:'草稿',reviewing:'评审中',approved:'已批准',rejected:'已驳回',executing:'执行中',completed:'已完成',closed:'已关闭',returned:'退回修改' };
const DC: Record<string, string> = { approved:'通过',rejected:'驳回',returned:'退回' };
const ETS: Record<string, string> = { draft:'草稿',frozen:'冻结',released:'发布',obsolete:'作废' };
const AL: Record<string, string> = { upgrade:'升版',qty_change:'数量',delete:'删除',no_change:'不变',add_existing:'新增',add_new:'新增子项' };
const XS: Record<string, string> = { released:'已发布',frozen:'已冻结',draft:'已升版' };
const AC: Record<string,string> = { upgrade:'upgrade',qty_change:'qty_change',delete:'delete',no_change:'no_change',add_existing:'add_existing',add_new:'add_new' };
const ROW_BG: Record<string,string> = { upgrade:'row-blue',qty_change:'row-orange',delete:'row-red',add_existing:'row-green',add_new:'row-green' };

const lb = (m:Record<string,string>,k:unknown):string => m[String(k??'')]||String(k??'')||'-';
const dt2 = (v:unknown):string => { if(!v) return '-'; const d=new Date(v as string); return Number.isNaN(d.getTime())?String(v):d.toLocaleString('zh-CN'); };
const hsc = (v:unknown):string => String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')||'-';
function nxv(v:string):string { if(!v) return 'A'; const c=[...v.toUpperCase()]; let i=c.length-1; while(i>=0){ if(c[i]==='Z'){c[i]='A';i--;} else {c[i]=String.fromCharCode(c[i].charCodeAt(0)+1); return c.join('');}} return 'A'+c.join(''); }
function rv(a:string,v:string,isUp:boolean,nv?:string):string {
  if(nv) return nv;
  if(isUp){ return ['upgrade','qty_change','delete'].includes(a) ? nxv(v||'A') : (v||'-'); }
  // downward: 仅升版会变版本；删除/数量变更/新增保持原版本
  if(a==='upgrade') return nxv(v||'A');
  if(a==='delete') return v||'-';
  return v||'-';
}
function esl(a:string,s?:string):string { if(a==='no_change') return '不变更'; return XS[s||'']||'未执行'; }
const byc = (a:any,b:any)=>String(a.entity_code||'').localeCompare(String(b.entity_code||''),'zh-CN');

function orderUpHier(items:any[]):any[] {
  interface T { node:any; children:T[] }
  const roots:T[]=[]; const stack:T[]=[];
  for(const item of items){ const t:T={node:item,children:[]}; while(stack.length>0&&(stack[stack.length-1].node.level??0)>=(item.level??0))stack.pop(); if(stack.length>0)stack[stack.length-1].children.push(t); else roots.push(t); stack.push(t); }
  const ss=(ns:T[])=>{ns.sort((a,b)=>byc(a.node,b.node));ns.forEach(n=>ss(n.children));}; ss(roots);
  const out:any[]=[]; const w=(ns:T[])=>{for(const t of ns){out.push(t.node);w(t.children);}}; w(roots); return out;
}
function ecoOver(n:any,s:any):any { return {...n,action:s?.action||n.action||'no_change',_t:s?.detail?._targetQty??(n.quantity_change?.to??n.quantity??''),_d:s?.detail?._desc||n.change_description||'',_nv:s?.new_version||'',_ns:s?.new_entity_status||''}; }

// ─── 富 HTML 样式（仿网页布局）──────────────────────────────────
const ECO_HTML_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Microsoft YaHei","PingFang SC","Segoe UI",sans-serif;color:#1f2937;padding:20px;font-size:12px;line-height:1.5}
.header{border-bottom:1px solid #e5e7eb;padding-bottom:14px;margin-bottom:16px}
.header h1{font-size:18px;margin-bottom:4px}
.header .t{color:#6b7280;font-size:13px}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500;margin-left:6px;vertical-align:middle}
.bg-b{background:#dbeafe;color:#1d4ed8}.bg-g{background:#dcfce7;color:#15803d}
.bg-o{background:#ffedd5;color:#c2410c}.bg-r{background:#fee2e2;color:#b91c1c}
.bg-gr{background:#f3f4f6;color:#4b5563}.bg-p{background:#f3e8ff;color:#7c3aed}
.section{margin-bottom:18px}
.section h2{font-size:14px;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin-bottom:10px;color:#374151}
.info-g{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.info-c{background:#f9fafb;border:1px solid #f3f4f6;border-radius:6px;padding:8px 10px}
.info-c label{display:block;font-size:10px;color:#9ca3af;margin-bottom:2px}
.info-c .v{font-size:12px;font-weight:500;word-break:break-word}
.desc{background:#f9fafb;border:1px solid #f3f4f6;border-radius:6px;padding:10px;font-size:12px;white-space:pre-wrap;color:#374151}
table{width:100%;border-collapse:collapse;margin:8px 0}
th,td{border:1px solid #e5e7eb;padding:5px 8px;text-align:left;vertical-align:top;font-size:11px}
th{background:#f3f4f6;font-weight:600;color:#6b7280}
tr{page-break-inside:avoid}
.row-blue{background:#eff6ff}.row-orange{background:#fff7ed}.row-red{background:#fef2f2}.row-green{background:#f0fdf4}
.cc-list{display:flex;flex-wrap:wrap;gap:6px}.cc-b{background:#f3e8ff;color:#7c3aed;padding:2px 8px;border-radius:4px;font-size:11px}
.log-i{padding:4px 8px;background:#f9fafb;border-radius:4px;margin-bottom:3px;font-size:10px}
.log-i .t{color:#9ca3af}
.bom-card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:12px}
.bom-card h3{font-size:13px;margin-bottom:8px;color:#374151}
.bom-card h4{font-size:11px;margin:10px 0 4px;color:#6b7280}
.footer{margin-top:20px;padding-top:10px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:10px}
.b1{font-weight:600}
@page{size:A4 landscape;margin:10mm}
@media print{body{padding:0}}
`;

function htag(cls:string,text:string):string { return `<span class="badge ${cls}">${hsc(text)}</span>`; }
function acTag(a:string):string { const m:Record<string,[string,string]>={ upgrade:['bg-b','升版'],qty_change:['bg-o','数量'],delete:['bg-r','删除'],no_change:['bg-gr','不变'],add_existing:['bg-g','新增'],add_new:['bg-g','新增子项'] }; const [c,l]=m[a]||['bg-gr',lb(AL,a)]; return htag(c,l); }

// ─── 构建 ECO 富 HTML ──────────────────────────────────────────
async function buildEcoHtml(eco:any):Promise<string> {
  const e=eco||{}; const p: string[]=[];
  const esBadge = (s:string) => { const m:Record<string,string>={draft:'bg-gr',reviewing:'bg-b',approved:'bg-g',rejected:'bg-r',executing:'bg-o',completed:'bg-g',closed:'bg-r',returned:'bg-o'}; return htag(m[s]||'bg-gr',lb(ES,s)); };
  const pBadge = (v:string) => { const m:Record<string,string>={urgent:'bg-r',high:'bg-o',normal:'bg-b',low:'bg-gr'}; return htag(m[v]||'bg-gr',lb(P,v)); };

  // Header
  p.push(`<div class="header"><h1>${hsc(e.eco_number||'ECO')} ${esBadge(e.status)} ${pBadge(e.priority)}</h1><div class="t">${hsc(e.title||'')}</div></div>`);

  // 基本信息
  p.push(`<div class="section"><h2>基本信息</h2><div class="info-g">`);
  p.push(`<div class="info-c"><label>变更原因</label><div class="v">${hsc(lb(R,e.reason))}</div></div>`);
  p.push(`<div class="info-c"><label>变更类别</label><div class="v">${hsc(lb(C,e.category))}</div></div>`);
  p.push(`<div class="info-c"><label>优先级</label><div class="v">${lb(P,e.priority)}</div></div>`);
  p.push(`<div class="info-c"><label>审批模式</label><div class="v">${e.review_mode==='all'?'会签':e.review_mode==='any'?'或签':'-'}</div></div>`);
  p.push(`<div class="info-c"><label>创建人</label><div class="v">${hsc(e.creator_name||'-')}</div></div>`);
  p.push(`<div class="info-c"><label>来源 ECR</label><div class="v">${hsc(e.ecr_number||'独立创建')}</div></div>`);
  p.push(`<div class="info-c"><label>创建时间</label><div class="v">${dt2(e.created_at)}</div></div>`);
  p.push(`<div class="info-c"><label>更新时间</label><div class="v">${dt2(e.updated_at)}</div></div>`);
  p.push(`</div></div>`);

  // 变更描述
  if(e.description){ p.push(`<div class="section"><h2>变更描述</h2><div class="desc">${hsc(e.description)}</div></div>`); }

  // 审批进度
  const reviewers:any[]=e.reviewers||[];
  if(reviewers.length>0){
    const rm=new Map<string,any>(); for(const r of e.review_records||[]) rm.set(String(r.reviewer_id),r);
    p.push(`<div class="section"><h2>审批进度（${e.approved_count||0}/${e.reviewers_count||reviewers.length} 已审批）</h2>`);
    p.push(`<table><thead><tr><th>顺序</th><th>审批人</th><th>结果</th><th>意见</th><th>时间</th></tr></thead><tbody>`);
    for(const r of reviewers.slice().sort((a:any,b:any)=>(a.seq??0)-(b.seq??0))){
      const rec=rm.get(String(r.user_id));
      const d=rec?lb(DC,rec.decision):'待审批';
      p.push(`<tr><td>${r.seq??'-'}</td><td>${hsc(r.user_name||'-')}</td><td class="b1">${hsc(d)}</td><td>${hsc(rec?.comment||'')}</td><td>${rec?dt2(rec.created_at):'-'}</td></tr>`);
    }
    p.push(`</tbody></table></div>`);
  }

  // 关联图文档
  const docs:any[]=e.document_links||[];
  if(docs.length>0){
    p.push(`<div class="section"><h2>关联图文档</h2><table><thead><tr><th>图文档编号</th><th>名称</th><th>版本</th></tr></thead><tbody>`);
    for(const d of docs) p.push(`<tr><td>${hsc(d.document_code||d.document?.code||'-')}</td><td>${hsc(d.document_name||d.document?.name||'-')}</td><td>${hsc(d.document_version||d.document?.version||'-')}</td></tr>`);
    p.push(`</tbody></table></div>`);
  }

  // 知会人
  const cc:any[]=e.cc_users||[];
  if(cc.length>0){ p.push(`<div class="section"><h2>知会用户</h2><div class="cc-list">${cc.map((c:any)=>`<span class="cc-b">${hsc(c.user_name)}</span>`).join('')}</div></div>`); }

  // ECR 变更分析
  const execItems:any[]=e.execution_items||[];
  let ecrData:any=null;
  if(e.ecr_id){ try{ecrData=(await ecrApi.get(e.ecr_id)).data;}catch{ecrData=null;} }
  if(ecrData&&(ecrData.affected_items||[]).length>0){
    const sm=new Map<string,any>();
    for(const ei of execItems){ const aff=ei.detail?._affectedCode||''; const k=ei.entity_id||ei.entity_code; if(!k)continue; sm.set(k+'|'+aff,ei); if(!aff)sm.set(String(k),ei); }
    const lk=(n:any,af:string)=>sm.get((n.entity_id||n.entity_code||'')+'|'+(af||''))||sm.get(n.entity_id)||sm.get(n.entity_code);
    const uk=new Set<string>();
    p.push(`<div class="section"><h2>ECR 变更分析（${hsc(e.ecr_number||ecrData.ecr_number||'ECR')}）</h2>`);
    for(const ai of ecrData.affected_items||[]){
      const bi=ai.bom_impact||{};
      const up=(bi.upward_chain||[]).filter((n:any)=>(n.level??0)>0).map((n:any)=>{const s=lk(n,ai.entity_code);if(s)uk.add((s.entity_id||s.entity_code)+'|'+(s.detail?._affectedCode||''));return ecoOver(n,s);});
      const down=(bi.downward_items||[]).map((n:any)=>{const s=lk(n,ai.entity_code);if(s)uk.add((s.entity_id||s.entity_code)+'|'+(s.detail?._affectedCode||''));return ecoOver(n,s);});
      for(const ei of execItems){ if(!['qty_change','delete','add_existing','add_new'].includes(ei.action))continue; if((ei.detail?._affectedCode||'')!==ai.entity_code)continue; const k2=(ei.entity_id||ei.entity_code)+'|'+(ei.detail?._affectedCode||''); if(uk.has(k2))continue; uk.add(k2); down.push({entity_type:ei.entity_type,entity_code:ei.entity_code,entity_name:ei.entity_name,entity_version:ei.entity_version||'',action:ei.action,_t:ei.detail?._targetQty??'',_d:ei.detail?._desc||'',_nv:ei.new_version||'',_ns:ei.new_entity_status||''}); }
      const uo=orderUpHier(up); down.sort(byc);
      const tl = ai.entity_type === 'part' ? '零件' : '部件';
      p.push(`<div class="bom-card"><h3>📦 ${hsc(ai.entity_code)} ${hsc(ai.entity_name||'')} v${hsc(ai.entity_version||'')}（${tl}）</h3>`);
      // 受影响物料本身
      const affExec = lk(ai, ai.entity_code);
      const affNv = affExec?.new_version || '';
      p.push(`<table style="margin-bottom:10px"><thead><tr><th style="width:20%">件号</th><th style="width:40%">名称</th><th style="width:20%">当前版本</th><th style="width:20%">变更后版本</th></tr></thead><tbody>`);
      p.push(`<tr><td>${hsc(ai.entity_code)}</td><td>${hsc(ai.entity_name||'')}</td><td>${hsc(ai.entity_version||'-')}</td><td style="color:#2563eb;font-weight:600">${affNv||nxv(ai.entity_version||'A')}</td></tr>`);
      p.push(`</tbody></table>`);
      if(uo.length>0){
        p.push(`<h4>📊 向上溯源链</h4>`);
        p.push(`<table><thead><tr><th>层级</th><th>类型</th><th>件号</th><th>名称</th><th>原版本</th><th>动作</th><th>原数量</th><th>目标数量</th><th>说明</th><th>执行后版本</th><th>变更状态</th></tr></thead><tbody>`);
        for(const n of uo) p.push(`<tr class="${ROW_BG[n.action]||''}"><td>${n.level!=null?'-'.repeat(n.level)+n.level:'-'}</td><td>${n.entity_type==='part'?'零件':'部件'}</td><td>${hsc(n.entity_code)}</td><td>${hsc(n.entity_name)}</td><td>${hsc(n.entity_version)}</td><td>${acTag(n.action||'no_change')}</td><td>${n.quantity??'-'}</td><td>${n._t??'-'}</td><td>${hsc(n._d||'')}</td><td>${rv(n.action,n.entity_version,true,n._nv)}</td><td>${hsc(esl(n.action,n._ns))}</td></tr>`);
        p.push(`</tbody></table>`);
      }
      if(down.length>0){
        p.push(`<h4>📋 向下子项</h4>`);
        p.push(`<table><thead><tr><th>类型</th><th>件号</th><th>名称</th><th>原版本</th><th>动作</th><th>原数量</th><th>目标数量</th><th>说明</th><th>执行后版本</th><th>变更状态</th></tr></thead><tbody>`);
        for(const n of down) p.push(`<tr class="${ROW_BG[n.action]||''}"><td>${n.entity_type==='part'?'零件':'部件'}</td><td>${hsc(n.entity_code)}</td><td>${hsc(n.entity_name)}</td><td>${hsc(n.entity_version||'-')}</td><td>${acTag(n.action||'no_change')}</td><td>${n.quantity??'-'}</td><td>${n._t??'-'}</td><td>${hsc(n._d||'')}</td><td>${rv(n.action,n.entity_version,false,n._nv)}</td><td>${hsc(esl(n.action,n._ns))}</td></tr>`);
        p.push(`</tbody></table>`);
      }
      if(uo.length===0&&down.length===0) p.push(`<div style="color:#9ca3af;font-size:11px">无影响链节点</div>`);
      p.push(`</div>`);
    }
  }

  // 工程变更结果
  const ri:any[]=e.release_items||[];
  if(ri.length>0){
    p.push(`<div class="section"><h2>工程变更结果</h2><table><thead><tr><th>类型</th><th>件号</th><th>名称</th><th>规格型号</th><th>版本</th><th>状态</th><th>用量</th></tr></thead><tbody>`);
    for(const r of ri) p.push(`<tr><td>${r.entity_type==='assembly'?'部件':'零件'}</td><td>${hsc(r.entity_code)}</td><td>${hsc(r.entity_name)}</td><td>${hsc(r.spec||'-')}</td><td>${hsc(r.entity_version||'A')}</td><td>${hsc(lb(ETS,r.status))}</td><td>${r.quantity??1}</td></tr>`);
    p.push(`</tbody></table></div>`);
  }

  // 状态日志
  const logs:any[]=e.status_logs||[];
  if(logs.length>0){
    p.push(`<div class="section"><h2>状态日志</h2>`);
    for(const l of logs) p.push(`<div class="log-i"><span class="t">${dt2(l.created_at)}</span> ${hsc(l.from_status||'-')} → <b>${hsc(lb(ES,l.to_status))}</b> by ${hsc(l.operator_name)} ${l.comment?`—— ${hsc(l.comment)}`:''}</div>`);
    p.push(`</div>`);
  }

  p.push(`<div class="footer">导出时间：${new Date().toLocaleString('zh-CN')}</div>`);
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + hsc(`${e.eco_number||'ECO'}_${e.title||''}`) + '</title><style>' + ECO_HTML_CSS + '</style></head><body>' + p.join('\n') + '</body></html>';
}

/** 导出 ECO 详情为 PDF：生成富 HTML → 隐藏 iframe 打印 */
export async function exportEcoPdf(eco: any): Promise<void> {
  const html = await buildEcoHtml(eco);
  const title = `${eco?.eco_number || 'ECO'}_${eco?.title || ''}`;

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

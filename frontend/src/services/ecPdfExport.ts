/**
 * ECR / ECO 详情 导出 PDF
 * 路线：内存数据 → Markdown（中间产物，复用 ecMarkdownExport）→ HTML（marked）→ 浏览器打印另存为 PDF
 */

import { marked } from 'marked';
import { buildEcrMarkdown, buildEcoMarkdown } from './ecMarkdownExport';

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

/**
 * 导出 ECR 详情为 PDF：生成 MD → HTML → 打印另存为 PDF
 */
export function exportEcrPdf(detail: any, statusLogs: any[] = []): void {
  const md = buildEcrMarkdown(detail, statusLogs);
  printMarkdownAsPdf(md, `${detail?.ecr_number || 'ECR'}_${detail?.title || ''}`);
}

/**
 * 导出 ECO 详情为 PDF：拉源 ECR + 叠加执行项生成 MD → HTML → 打印另存为 PDF
 */
export async function exportEcoPdf(eco: any): Promise<void> {
  const md = await buildEcoMarkdown(eco);
  printMarkdownAsPdf(md, `${eco?.eco_number || 'ECO'}_${eco?.title || ''}`);
}

/**
 * 复刻详情界面：原地打印「实时、已渲染、已应用样式」的详情 DOM（不克隆、不移动 → 不会空白、样式一致）。
 * 打印时用 @media print：隐藏目标以外的一切；同时「解包」目标的祖先链（去掉弹窗的 fixed 定位、
 * 居中、max-height/overflow 裁剪、transform 等），让内容回到正常文档流 —— 从页首顶格、跨多页正常分页。
 * 所见即所得（含当前展开的溯源层级）；按钮等交互元素打印时隐藏（不改动 DOM 结构）。
 */
export function exportDetailDomPdf(rootEl: HTMLElement, title: string, landscape = true): void {
  const prevTitle = document.title;
  if (title) document.title = title;  // 影响打印页眉与「另存为 PDF」默认文件名

  // 标记目标 + 其所有祖先（到 body 为止）
  rootEl.setAttribute('data-pdf-root', '');
  const ancestors: HTMLElement[] = [];
  let el = rootEl.parentElement;
  while (el && el !== document.body) {
    el.setAttribute('data-pdf-ancestor', '');
    ancestors.push(el);
    el = el.parentElement;
  }

  // 沿祖先链把「路径之外」的兄弟节点用 display:none 移出布局，
  // 这样不会再留下空白占位（visibility:hidden 会保留占位，导致首页空白+顶部大段留白）。
  const onPath = new Set<Element>([rootEl, ...ancestors]);
  const hidden: HTMLElement[] = [];
  let cur: HTMLElement | null = rootEl;
  while (cur && cur !== document.body) {
    const p: HTMLElement | null = cur.parentElement;
    if (!p) break;
    Array.from(p.children).forEach((sib: Element) => {
      if (!onPath.has(sib)) {
        (sib as HTMLElement).setAttribute('data-pdf-hidden', '');
        hidden.push(sib as HTMLElement);
      }
    });
    cur = p;
  }

  const style = document.createElement('style');
  style.setAttribute('data-print-style', '');
  style.textContent = `
    @media print {
      /* 路径之外的内容移出布局，避免空白占位 */
      [data-pdf-hidden] { display: none !important; }
      /* 解包祖先链：去掉 fixed/居中/裁剪/阴影/限宽，让内容从页首正常铺排、跨页分页 */
      [data-pdf-ancestor] {
        position: static !important; display: block !important;
        max-height: none !important; max-width: none !important; height: auto !important; width: auto !important;
        overflow: visible !important; transform: none !important;
        margin: 0 !important; padding: 0 !important;
        background: #fff !important; box-shadow: none !important; border: 0 !important; border-radius: 0 !important;
      }
      [data-pdf-root] { max-height: none !important; overflow: visible !important; }
      /* 隐藏交互元素（导出/操作/展开钮） */
      [data-pdf-root] button { display: none !important; }
      tr { page-break-inside: avoid; }
      @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; }
    }
  `;
  document.head.appendChild(style);

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    rootEl.removeAttribute('data-pdf-root');
    ancestors.forEach((a) => a.removeAttribute('data-pdf-ancestor'));
    hidden.forEach((h) => h.removeAttribute('data-pdf-hidden'));
    if (style.parentNode) style.parentNode.removeChild(style);
    document.title = prevTitle;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  // 等一帧让打印样式生效后再唤起打印对话框
  setTimeout(() => window.print(), 80);
  // 兜底清理（个别浏览器不触发 afterprint）
  setTimeout(cleanup, 60000);
}

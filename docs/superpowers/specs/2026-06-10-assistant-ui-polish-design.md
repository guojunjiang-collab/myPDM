# AI 助手悬浮窗体验优化 — 设计

- **日期**: 2026-06-10
- **状态**: 已评审，待实现
- **关联**: [PDM AI 助手](2026-06-10-pdm-ai-assistant-design.md)

## 目标

对已上线的 AI 助手悬浮窗做两处体验优化：

1. **可拖拽缩放**：用户能手动调整窗口大小，尺寸持久化。
2. **Markdown 样式化**：AI 返回的 GFM Markdown（表格/加粗/列表/代码）渲染为有样式的富文本，而非原始符号。

## ① 拖拽缩放（零依赖）

- 面板锚定右下角（`fixed bottom-24 right-6`）。在**面板左上角**加一个拖拽手柄（↖ 图标，`cursor-nwse-resize`），按住向左上拖动即放大。
- 尺寸 `{ width, height }` 存入 assistant store，经 zustand `persist` + `partialize` **仅持久化尺寸**到 localStorage（键 `assistant-size`），下次打开保持。会话历史不持久化。
- 约束：最小 `320 × 360`；最大 `min(viewport*0.9, ...) `，即 `maxW = 90vw`、`maxH = 85vh`，运行时按 `window.innerWidth/Height` 夹取。默认 `384 × 512`（沿用现值）。
- 交互用原生 PointerEvent，抽成 `hooks/useResizable.ts`：`pointerdown` 记录起点与起始尺寸并 `setPointerCapture` → `pointermove` 计算 `width = start.w + (start.x - e.x)`、`height = start.h + (start.y - e.y)` 并夹取 → `pointerup` 结束。
- 面板从 Tailwind 固定宽高类（`w-96 h-[32rem]`）改为 inline `style={{ width, height }}`。

## ② Markdown 样式化

- 新增依赖：`react-markdown`、`remark-gfm`、`@tailwindcss/typography`（均为前端依赖）。
- `tailwind.config.js` 的 `plugins` 启用 `require('@tailwindcss/typography')`。
- 新建 `components/assistant/Markdown.tsx`：封装 `<ReactMarkdown remarkPlugins={[remarkGfm]}>`，外层套 `prose prose-sm max-w-none`，并对表格补边框/紧凑间距（通过 `components` 覆盖或 prose 修饰类）。
- `cards/TextCard.tsx`：用 `<Markdown>` 渲染 AI 文本，保留末尾流式光标 ▋。
- `cards/MarkdownCard.tsx`：预览区从 `<pre>` 改为 `<Markdown>`（保留 `max-h` 滚动、复制/下载按钮）。
- 流式期间逐 token 重渲染，体量小可接受。

## 影响文件

- 改：`frontend/package.json`、`frontend/tailwind.config.js`、`frontend/src/stores/assistant.ts`、`frontend/src/components/assistant/FloatingAssistant.tsx`、`frontend/src/components/assistant/cards/TextCard.tsx`、`frontend/src/components/assistant/cards/MarkdownCard.tsx`
- 新增：`frontend/src/components/assistant/Markdown.tsx`、`frontend/src/hooks/useResizable.ts`

## 验证

- `cd frontend; npm run build` 通过（无 TS/构建错误）。
- 浏览器手动：拖左上角可缩放并在刷新后保持；AI 回复的表格/加粗正确渲染；MarkdownCard 预览有样式。

## 非目标（YAGNI）

- 拖拽移动窗口位置、全屏按钮、多主题——本次不做。
- 会话历史持久化——维持现状（不存）。

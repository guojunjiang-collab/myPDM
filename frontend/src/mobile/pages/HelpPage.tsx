import { useHelpDrawer } from '../helpDrawer';
// 直接复用桌面端帮助文档内容组件（自身内部滚动；左侧目录在移动端自动隐藏）。
// 目录按钮在顶部标题栏右侧（MobileLayout 渲染），本页不再有独立标题栏。
import Help, { sections } from '../../pages/Help';

/* ================================================================
   帮助文档（移动端）：桌面端 Help 内容复用 + 目录抽屉（按钮在顶部标题栏右侧）
   ================================================================ */

export default function HelpPage() {
  const drawerOpen = useHelpDrawer((s) => s.open);
  const setDrawerOpen = useHelpDrawer((s) => s.setOpen);

  const jumpTo = (id: string) => {
    setDrawerOpen(false);
    // 桌面 Help 内容在内部滚动容器中，scrollIntoView 会滚动最近可滚动祖先
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="h-full">
      {/* 桌面端帮助文档内容（h-full + 内部滚动） */}
      <Help />

      {/* 目录抽屉（右侧滑出 + 遮罩） */}
      {drawerOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <div className="fixed right-0 top-0 bottom-0 z-50 w-72 max-w-[80vw] bg-white shadow-xl flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
              <span className="text-sm font-semibold text-gray-800">目录</span>
              <button
                aria-label="关闭目录"
                onClick={() => setDrawerOpen(false)}
                className="text-2xl leading-none text-gray-400 w-8 h-8 flex items-center justify-center"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {sections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => jumpTo(s.id)}
                  className="w-full text-left flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 active:bg-gray-50"
                >
                  <span>{s.icon}</span>
                  <span className="flex-1 min-w-0 truncate">{s.title}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

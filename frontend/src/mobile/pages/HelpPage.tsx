import { useNavigate } from 'react-router-dom';
// 直接复用桌面端帮助文档内容组件（自身内部滚动；左侧目录在移动端自动隐藏）
import Help from '../../pages/Help';

/* ================================================================
   帮助文档（移动端）：返回条 + 标题 + 桌面端 Help 组件内容复用
   ================================================================ */

export default function HelpPage() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col h-full">
      {/* 顶部：返回 + 标题 */}
      <div className="sticky top-0 z-20 bg-gray-50 px-2 pt-2 pb-1">
        <div className="flex items-center gap-1 min-h-10">
          <button
            aria-label="返回"
            onClick={() => navigate(-1)}
            className="shrink-0 min-w-10 h-10 flex items-center justify-center text-2xl leading-none text-gray-600"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1 text-base font-medium text-gray-900 truncate">帮助文档</div>
        </div>
      </div>
      {/* 桌面端帮助文档内容（h-full + 内部滚动） */}
      <div className="flex-1 min-h-0">
        <Help />
      </div>
    </div>
  );
}

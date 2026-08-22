import { useEffect, useRef, useState } from 'react';

export type DetailTarget = { kind: 'part' | 'document'; id: string; rev?: string };

/**
 * 详情覆盖层栈（零部件/图文档列表、看板共用）：
 * - 主界面点卡片 → openDetail 打开第一层（覆盖在主界面上，主界面不卸载、滚动位置保留）
 * - 详情内跳转（BOM 下钻 / 反查跳转零部件/图文档）→ handleDetailNavigate 逐级入栈并压入 history 哨兵
 * - 页面 ‹ 返回 / 全面屏返回手势（popstate）每次弹掉一层详情，可逐级返回
 * - 不可嵌入的目标（项目/EC 等无独立详情组件）→ 新标签打开
 */
export function useDetailOverlay() {
  const [stack, setStack] = useState<DetailTarget[]>([]);
  const overlayRef = useRef(false);
  useEffect(() => {
    overlayRef.current = stack.length > 0;
  }, [stack]);

  // 系统返回（popstate）：覆盖层开着时每次 back 弹掉栈顶一层详情（全面屏手势逐级返回）
  useEffect(() => {
    const onPop = () => {
      if (overlayRef.current) {
        setStack((prev) => prev.slice(0, -1));
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const openDetail = (t: DetailTarget) => {
    setStack([t]);
    window.history.pushState({ mobileDetailOverlay: true }, '');
  };

  /** 详情内跳转分流：零部件/图文档 → 栈内导航（压哨兵，可逐级返回）；其他 → 新标签 */
  const handleDetailNavigate = (to: string) => {
    const seg = to.split('?')[0].split('/').filter(Boolean);
    if (seg[0] === 'parts' && seg[1] && seg[1] !== 'compare') {
      setStack((prev) => [...prev, { kind: 'part', id: seg[1] }]);
      window.history.pushState({ mobileDetailOverlay: true }, '');
      return;
    }
    if (seg[0] === 'documents' && seg[1]) {
      setStack((prev) => [...prev, { kind: 'document', id: seg[1] }]);
      window.history.pushState({ mobileDetailOverlay: true }, '');
      return;
    }
    window.open(to, '_blank');
  };

  return { stack, openDetail, handleDetailNavigate };
}

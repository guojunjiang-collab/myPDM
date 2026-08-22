import { useEffect, useRef, useState } from 'react';

export type DetailTarget = { kind: 'part' | 'document'; id: string; rev?: string };

/**
 * 详情覆盖层栈（零部件/图文档列表、看板共用）：
 * - 主界面点卡片 → openDetail 打开第一层（覆盖在主界面上，主界面不卸载、滚动位置保留）
 * - 详情内跳转（BOM 下钻 / 反查跳转零部件/图文档）→ handleDetailNavigate 逐级入栈，返回逐级弹出
 * - 不可嵌入的目标（项目/EC 等无独立详情组件）→ 新标签打开
 * - 系统返回键弹哨兵后整体关闭覆盖层
 */
export function useDetailOverlay() {
  const [stack, setStack] = useState<DetailTarget[]>([]);
  const overlayRef = useRef(false);
  useEffect(() => {
    overlayRef.current = stack.length > 0;
  }, [stack]);

  // 系统返回（popstate）：弹掉哨兵后整体关闭覆盖层
  useEffect(() => {
    const onPop = () => {
      const cur = window.history.state as { mobileDetailOverlay?: boolean } | null;
      if (!cur?.mobileDetailOverlay && overlayRef.current) {
        setStack([]);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const openDetail = (t: DetailTarget) => {
    setStack([t]);
    window.history.pushState({ mobileDetailOverlay: true }, '');
  };

  const closeDetail = () => {
    setStack([]);
    window.history.back();
  };

  /** 详情内跳转分流：零部件/图文档 → 栈内导航；其他（项目/EC 等）→ 新标签 */
  const handleDetailNavigate = (to: string) => {
    const seg = to.split('?')[0].split('/').filter(Boolean);
    if (seg[0] === 'parts' && seg[1] && seg[1] !== 'compare') {
      setStack((prev) => [...prev, { kind: 'part', id: seg[1] }]);
      return;
    }
    if (seg[0] === 'documents' && seg[1]) {
      setStack((prev) => [...prev, { kind: 'document', id: seg[1] }]);
      return;
    }
    window.open(to, '_blank');
  };

  /** 弹回第 idx 层（详情页面内 ‹ 返回；idx=0 表示回到主界面） */
  const popTo = (idx: number) => setStack((prev) => prev.slice(0, idx));

  return { stack, openDetail, closeDetail, handleDetailNavigate, popTo };
}

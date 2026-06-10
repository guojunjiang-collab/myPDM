import { useCallback, useRef } from 'react';
import { useAssistantStore, ASSISTANT_MIN_SIZE } from '../stores/assistant';

/**
 * 左上角拖拽缩放：面板锚定右下角，向左上拖动放大。
 * 返回一个 onPointerDown，绑定到拖拽手柄上即可。
 */
export function useResizable() {
  const setSize = useAssistantStore((s) => s.setSize);
  const start = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const { size } = useAssistantStore.getState();
      start.current = { x: e.clientX, y: e.clientY, w: size.width, h: size.height };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        if (!start.current) return;
        const maxW = window.innerWidth * 0.9;
        const maxH = window.innerHeight * 0.85;
        const width = Math.min(maxW, Math.max(ASSISTANT_MIN_SIZE.width,
          start.current.w + (start.current.x - ev.clientX)));
        const height = Math.min(maxH, Math.max(ASSISTANT_MIN_SIZE.height,
          start.current.h + (start.current.y - ev.clientY)));
        setSize({ width, height });
      };
      const onUp = (ev: PointerEvent) => {
        start.current = null;
        (e.target as HTMLElement).releasePointerCapture?.(ev.pointerId);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [setSize],
  );

  return { onPointerDown };
}

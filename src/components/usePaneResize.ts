import { useCallback, useRef, useState } from 'react';

interface Options {
  /** 左栏初始宽度（px） */
  defaultWidth: number;
  /** 左栏最小宽度 */
  min?: number;
  /** 右栏最小宽度，用于计算左栏宽度上限 */
  minRight?: number;
}

/** 分栏中缝宽度（与 styles.css 的 .pane-divider 列宽保持一致） */
const DIVIDER_WIDTH = 10;

/**
 * 左右分栏拖动：返回左栏宽度、容器 ref 与拖动/复位回调。
 * 用法：容器 style 使用 `${width}px ${DIVIDER_WIDTH}px minmax(0, 1fr)`，
 * 两栏之间插入 <div className="pane-divider" onMouseDown={onMouseDown} onDoubleClick={reset} />。
 */
export function usePaneResize({ defaultWidth, min = 240, minRight = 320 }: Options) {
  const [width, setWidth] = useState(defaultWidth);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = widthRef.current;
      const maxWidth = () => {
        const total = containerRef.current?.clientWidth ?? window.innerWidth;
        // 预留右栏最小宽度与中缝宽度，避免把右栏挤到不可用
        return Math.max(min, total - minRight - DIVIDER_WIDTH);
      };
      let pending = startWidth;
      let raf = 0;
      const onMove = (ev: MouseEvent) => {
        pending = Math.min(maxWidth(), Math.max(min, startWidth + (ev.clientX - startX)));
        if (raf) return;
        raf = window.requestAnimationFrame(() => {
          raf = 0;
          setWidth(pending);
        });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        if (raf) {
          window.cancelAnimationFrame(raf);
          raf = 0;
        }
        setWidth(pending);
        document.body.classList.remove('col-resizing');
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      document.body.classList.add('col-resizing');
    },
    [min, minRight],
  );

  const reset = useCallback(() => setWidth(defaultWidth), [defaultWidth]);

  return { width, containerRef, onMouseDown, reset };
}

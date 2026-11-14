import { useCallback, useEffect, useRef, useState, type MouseEvent, type UIEvent } from 'react';

const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 220;
const MAX_WIDTH = 420;

/** Sidebar geometry and scroll edges, independent of navigation and product data. */
export function useSidebarFrame(isCollapsed: boolean, onToggleCollapse: () => void) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [agentScrollEdges, setAgentScrollEdges] = useState({ top: false, bottom: false });
  const agentScrollContainerRef = useRef<HTMLDivElement>(null);
  const resizeCleanupRef = useRef<() => void>(() => {});

  const handleResizeStart = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (isCollapsed) return;
      event.preventDefault();
      resizeCleanupRef.current();
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      let pendingWidth = sidebarWidth;
      let raf: number | null = null;
      setIsResizing(true);
      document.body.classList.add('select-none');
      const cleanup = () => {
        if (raf !== null) cancelAnimationFrame(raf);
        document.body.classList.remove('select-none');
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', finish);
        resizeCleanupRef.current = () => {};
      };
      const finish = () => {
        cleanup();
        setSidebarWidth(pendingWidth);
        setIsResizing(false);
      };
      const move = (next: globalThis.MouseEvent) => {
        const width = startWidth + next.clientX - startX;
        if (width < MIN_WIDTH) {
          cleanup();
          setIsResizing(false);
          onToggleCollapse();
          return;
        }
        pendingWidth = Math.min(MAX_WIDTH, width);
        if (raf !== null) return;
        raf = requestAnimationFrame(() => {
          raf = null;
          setSidebarWidth(pendingWidth);
        });
      };
      resizeCleanupRef.current = cleanup;
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', finish);
    },
    [isCollapsed, onToggleCollapse, sidebarWidth],
  );

  useEffect(() => () => resizeCleanupRef.current(), []);

  const updateScrollEdges = useCallback((element: HTMLDivElement | null) => {
    const next = element
      ? {
          top: element.scrollTop > 1,
          bottom: element.scrollHeight - element.clientHeight - element.scrollTop > 1,
        }
      : { top: false, bottom: false };
    setAgentScrollEdges(previous =>
      previous.top === next.top && previous.bottom === next.bottom ? previous : next,
    );
  }, []);
  const handleAgentScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      updateScrollEdges(event.currentTarget);
    },
    [updateScrollEdges],
  );
  useEffect(() => {
    const element = agentScrollContainerRef.current;
    if (!element) return;
    updateScrollEdges(element);
    const observer = new ResizeObserver(() => updateScrollEdges(element));
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [updateScrollEdges]);

  return {
    sidebarWidth,
    isResizing,
    agentScrollEdges,
    agentScrollContainerRef,
    handleResizeStart,
    handleAgentScroll,
  };
}

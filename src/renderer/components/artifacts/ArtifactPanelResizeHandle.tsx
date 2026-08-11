import React, { useCallback, useEffect, useRef, useState } from 'react';

import { i18nService } from '@/services/i18n';

import {
  resolveArtifactPanelKeyboardWidth,
  resolveArtifactPanelPointerWidth,
} from './artifactPanelResize';

interface ArtifactPanelResizeHandleProps {
  currentWidth: number;
  minWidth: number;
  maxWidth: number;
  onResizeFrame: (width: number) => void;
  onResizeComplete: (width: number) => void;
}

const ArtifactPanelResizeHandle: React.FC<ArtifactPanelResizeHandleProps> = ({
  currentWidth,
  minWidth,
  maxWidth,
  onResizeFrame,
  onResizeComplete,
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);
  const startClientXRef = useRef(0);
  const startWidthRef = useRef(currentWidth);
  const latestWidthRef = useRef(currentWidth);
  const frameRequestRef = useRef<number | null>(null);
  const originalCursorRef = useRef('');
  const originalUserSelectRef = useRef('');
  const removeWindowListenersRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isResizing) latestWidthRef.current = currentWidth;
  }, [currentWidth, isResizing]);

  const flushResizeFrame = useCallback(() => {
    frameRequestRef.current = null;
    onResizeFrame(latestWidthRef.current);
  }, [onResizeFrame]);

  const scheduleResizeFrame = useCallback(
    (width: number) => {
      latestWidthRef.current = width;
      if (frameRequestRef.current !== null) return;
      frameRequestRef.current = window.requestAnimationFrame(flushResizeFrame);
    },
    [flushResizeFrame],
  );

  const restoreDocumentInteraction = useCallback(() => {
    document.body.style.cursor = originalCursorRef.current;
    document.body.style.userSelect = originalUserSelectRef.current;
  }, []);

  const completeResize = useCallback(() => {
    if (!isResizingRef.current) return;
    if (frameRequestRef.current !== null) {
      window.cancelAnimationFrame(frameRequestRef.current);
      frameRequestRef.current = null;
      onResizeFrame(latestWidthRef.current);
    }
    removeWindowListenersRef.current?.();
    removeWindowListenersRef.current = null;
    isResizingRef.current = false;
    setIsResizing(false);
    restoreDocumentInteraction();
    onResizeComplete(latestWidthRef.current);
  }, [onResizeComplete, onResizeFrame, restoreDocumentInteraction]);

  useEffect(
    () => () => {
      if (frameRequestRef.current !== null) {
        window.cancelAnimationFrame(frameRequestRef.current);
      }
      removeWindowListenersRef.current?.();
      if (isResizingRef.current) restoreDocumentInteraction();
    },
    [restoreDocumentInteraction],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      startClientXRef.current = event.clientX;
      startWidthRef.current = currentWidth;
      latestWidthRef.current = currentWidth;
      originalCursorRef.current = document.body.style.cursor;
      originalUserSelectRef.current = document.body.style.userSelect;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      isResizingRef.current = true;
      setIsResizing(true);

      const pointerId = event.pointerId;
      const handle = event.currentTarget;
      const handleWindowPointerMove = (moveEvent: PointerEvent) => {
        if (!isResizingRef.current || moveEvent.pointerId !== pointerId) return;
        scheduleResizeFrame(
          resolveArtifactPanelPointerWidth(
            startWidthRef.current,
            startClientXRef.current,
            moveEvent.clientX,
            minWidth,
            maxWidth,
          ),
        );
      };
      const handleWindowPointerEnd = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return;
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
        completeResize();
      };
      const handleWindowBlur = () => completeResize();
      const removeWindowListeners = () => {
        window.removeEventListener('pointermove', handleWindowPointerMove);
        window.removeEventListener('pointerup', handleWindowPointerEnd);
        window.removeEventListener('pointercancel', handleWindowPointerEnd);
        window.removeEventListener('blur', handleWindowBlur);
      };

      removeWindowListenersRef.current = removeWindowListeners;
      window.addEventListener('pointermove', handleWindowPointerMove);
      window.addEventListener('pointerup', handleWindowPointerEnd);
      window.addEventListener('pointercancel', handleWindowPointerEnd);
      window.addEventListener('blur', handleWindowBlur);
    },
    [completeResize, currentWidth, maxWidth, minWidth, scheduleResizeFrame],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const nextWidth = resolveArtifactPanelKeyboardWidth(
        currentWidth,
        event.key,
        minWidth,
        maxWidth,
      );
      if (nextWidth === null) return;
      event.preventDefault();
      onResizeFrame(nextWidth);
      onResizeComplete(nextWidth);
    },
    [currentWidth, maxWidth, minWidth, onResizeComplete, onResizeFrame],
  );

  return (
    <div
      aria-label={i18nService.t('artifactResizePreview')}
      aria-orientation="vertical"
      aria-valuemax={Math.round(maxWidth)}
      aria-valuemin={Math.round(minWidth)}
      aria-valuenow={Math.round(currentWidth)}
      className="absolute inset-y-0 left-0 z-10 w-3 cursor-col-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      data-artifact-resize-handle=""
      data-resizing={isResizing ? '' : undefined}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={completeResize}
      onPointerDown={handlePointerDown}
      role="separator"
      tabIndex={0}
    />
  );
};

export default ArtifactPanelResizeHandle;

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseCodingSidePanelTransitionOptions {
  isNarrowViewport: boolean;
  onCloseComplete: () => void;
}

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Keep this just beyond the panel's 200ms width transition. It prevents a
// missing transitionend event from leaving the panel mounted forever.
const CLOSE_TRANSITION_FALLBACK_MS = 240;

export const useCodingSidePanelTransition = ({
  isNarrowViewport,
  onCloseComplete,
}: UseCodingSidePanelTransitionOptions) => {
  const [isPresent, setIsPresent] = useState(false);
  const [isEntering, setIsEntering] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const entryFrameRef = useRef<number | null>(null);
  const closeFallbackRef = useRef<number | null>(null);

  const cancelEntryFrame = useCallback(() => {
    if (entryFrameRef.current === null) return;
    window.cancelAnimationFrame(entryFrameRef.current);
    entryFrameRef.current = null;
  }, []);

  const cancelCloseFallback = useCallback(() => {
    if (closeFallbackRef.current === null) return;
    window.clearTimeout(closeFallbackRef.current);
    closeFallbackRef.current = null;
  }, []);

  const reset = useCallback(() => {
    cancelEntryFrame();
    cancelCloseFallback();
    setIsPresent(false);
    setIsEntering(false);
    setIsClosing(false);
  }, [cancelCloseFallback, cancelEntryFrame]);

  useEffect(() => reset, [reset]);

  useEffect(() => {
    if (isNarrowViewport) reset();
  }, [isNarrowViewport, reset]);

  const show = useCallback(() => {
    if (isNarrowViewport) return;
    cancelEntryFrame();
    setIsClosing(false);
    if (isPresent) return;

    setIsPresent(true);
    setIsEntering(true);
    entryFrameRef.current = window.requestAnimationFrame(() => {
      entryFrameRef.current = null;
      setIsEntering(false);
    });
  }, [cancelEntryFrame, isNarrowViewport, isPresent]);

  const hide = useCallback(() => {
    cancelEntryFrame();
    setIsEntering(false);
    if (!isPresent || isNarrowViewport || prefersReducedMotion()) {
      reset();
      onCloseComplete();
      return;
    }
    setIsClosing(true);
    cancelCloseFallback();
    closeFallbackRef.current = window.setTimeout(() => {
      closeFallbackRef.current = null;
      reset();
      onCloseComplete();
    }, CLOSE_TRANSITION_FALLBACK_MS);
  }, [cancelCloseFallback, cancelEntryFrame, isNarrowViewport, isPresent, onCloseComplete, reset]);

  const completeClose = useCallback(() => {
    if (!isClosing) return;
    cancelCloseFallback();
    reset();
    onCloseComplete();
  }, [cancelCloseFallback, isClosing, onCloseComplete, reset]);

  return {
    completeClose,
    hide,
    isClosing,
    isEntering,
    isPresent,
    reset,
    show,
  };
};

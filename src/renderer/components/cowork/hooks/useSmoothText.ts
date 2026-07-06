import { useEffect, useRef, useState } from 'react';

/**
 * Smoothly reveal `target` one small step per animation frame while `active`,
 * so uneven streaming chunks display at a steady, adaptive character rate.
 * When inactive, or when `target` shrinks / is not a prefix of what's shown,
 * it snaps to `target` immediately.
 */
export function useSmoothText(target: string, active: boolean): string {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const targetRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    targetRef.current = target;

    if (!active || target === displayRef.current || !target.startsWith(displayRef.current)) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    if (rafRef.current !== null) return;

    const step = () => {
      const full = targetRef.current;
      const shown = displayRef.current;
      if (shown.length >= full.length) { rafRef.current = null; return; }
      const remaining = full.length - shown.length;
      const stepSize = Math.min(40, Math.max(2, Math.ceil(remaining / 8)));
      const next = full.slice(0, shown.length + stepSize);
      displayRef.current = next;
      setDisplay(next);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [target, active]);

  return display;
}

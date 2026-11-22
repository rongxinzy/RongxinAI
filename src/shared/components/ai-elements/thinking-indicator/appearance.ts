import type { OrbTheme } from 'thinking-orbs';

export interface ThinkingIndicatorPaint {
  color: string;
  theme: Exclude<OrbTheme, 'auto'>;
}

const listeners = new Set<() => void>();
let observer: MutationObserver | undefined;
let pendingFrame: number | undefined;

/** Share one appearance subscription; settled historical indicators need no RAF. */
export function subscribeIndicatorAppearance(listener: () => void): () => void {
  listeners.add(listener);
  if (!observer) {
    observer = new MutationObserver(() => {
      if (pendingFrame !== undefined) return;
      // Read after stylesheet replacement has settled. Reading in the mutation
      // callback can still return the previous ink in Chromium.
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = undefined;
        for (const notify of listeners) notify();
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
    if (import.meta.env.DEV) {
      observer.observe(document.head, { childList: true, characterData: true, subtree: true });
    }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = undefined;
      if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
      pendingFrame = undefined;
    }
  };
}

export function readIndicatorPaint(host: HTMLElement): ThinkingIndicatorPaint | null {
  const computed = getComputedStyle(host);
  let color = computed.color;
  // The dependency accepts comma-separated RGB or hex. CSS color-mix and wide
  // gamut theme colors need conversion, rather than falling back to stock ink.
  if (!/^rgba?\(\s*[\d.]+\s*,/.test(color)) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    color = '#' + [red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('');
  }
  return {
    color,
    theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  };
}

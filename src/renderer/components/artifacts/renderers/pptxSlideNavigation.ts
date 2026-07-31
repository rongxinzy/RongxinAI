export interface PptxPreviewSlide {
  srcDoc: string;
  width: number;
  height: number;
}

const PPTX_NAVIGATION_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  ' ',
  'Spacebar',
]);

export function isPptxNavigationKey(key: string): boolean {
  return PPTX_NAVIGATION_KEYS.has(key);
}

export function resolvePptxSlideIndex(
  currentIndex: number,
  slideCount: number,
  key: string,
): number {
  if (slideCount <= 0) return 0;

  const current = Math.min(Math.max(currentIndex, 0), slideCount - 1);
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
    case 'PageDown':
    case ' ':
    case 'Spacebar':
      return Math.min(current + 1, slideCount - 1);
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return Math.max(current - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return slideCount - 1;
    default:
      return current;
  }
}

export function buildPptxSlideDocument(slideHtml: string): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'" />
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
      .pptx-preview-slide-wrapper { margin: 0 !important; }
    </style>
  </head>
  <body>${slideHtml}</body>
</html>`;
}

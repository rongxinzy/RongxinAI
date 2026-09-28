// Keep HTML out of the initial renderer bundle: a non-eager glob compiles to one dynamic import
// per example, so every bundled case lands in its own lazy chunk instead of being inlined into
// the startup graph.
const sources = import.meta.glob<string>(
  ['/scripts/case-previews/*.html', '/SKILLs/frontend-design/templates/*.html'],
  { query: '?raw', import: 'default' },
);

/**
 * Resolve one bundled example for the detail dialog.
 *
 * Every example is a complete document on its own: document cases stack eight or more 1100x688
 * pages, web cases ship their live template. The returned HTML is made safe to inline — no
 * network access, no remote images — and the document cases get a fit script so the dialog scales
 * the fixed-width pages to the viewport width while the user scrolls through the pages.
 */
export async function loadCasePreview(id: string): Promise<string | null> {
  const entry = Object.entries(sources).find(([path]) => path.endsWith(`/${id}.html`));
  if (!entry) return null;
  const html = await entry[1]();
  // Examples are isolated from application state: they cannot fetch data, submit a form or load a
  // remote image. Every bundled case is self-contained markup, so data: is the only image source
  // an example can reach.
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
  const fitCover = entry[0].startsWith('/scripts/case-previews/')
    ? // Scale by the document's own layout width, measured with the zoom cleared: scrollWidth is
      // reported in the zoomed coordinate space, so feeding it back made the page stop following the
      // viewport after the first resize (the expanded dialog kept the collapsed scale).
      `<script>function fit(){const b=document.body;b.style.zoom='';const w=b.scrollWidth||1100;b.style.zoom=Math.min(1,innerWidth/w)}addEventListener('resize',fit);fit();</script>`
    : '';
  // Thumbnail sources hide page overflow; the detail viewport must allow reading below the fold.
  const scrollStyles =
    '<style>html{height:100%!important;width:100%!important;overflow-x:hidden!important;overflow-y:auto!important}body{overflow:visible!important}</style>';
  return html
    .replace(/<head([^>]*)>/i, `<head$1>${policy}<meta name="color-scheme" content="light">`)
    .replace(/<\/head>/i, `${scrollStyles}</head>`)
    .replace(/<\/body>/i, `${fitCover}</body>`);
}

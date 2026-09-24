// Keep HTML out of the initial renderer bundle; Vite packages each bundled example separately.
const sources = import.meta.glob<string>(
  ['/scripts/case-previews/*.html', '/SKILLs/frontend-design/templates/*.html'],
  { query: '?raw', import: 'default' },
);

/** Localized copy for the generated walkthrough pages; the module owns no user-visible text. */
export interface CasePreviewCopy {
  outlineKicker: string;
  deliverableKicker: string;
  outlineFallback: string;
  deliverableTitle: string;
  deliverableIntro: string;
  deliverableItems: string[];
}

export interface CasePreviewDetails {
  label: string;
  description?: string;
  prompt: string;
  copy: CasePreviewCopy;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    character =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  );
}

function taskOutline(prompt: string): string[] {
  return prompt
    .split('\n')
    .map(line => line.trim().replace(/^\d+[.、]\s*/, ''))
    .filter(line => line.length > 6 && !line.startsWith('风格要求'))
    .slice(0, 6);
}

function continuationPages(details: CasePreviewDetails): string {
  const { copy } = details;
  const outline = taskOutline(details.prompt);
  const outlineItems = outline.length
    ? outline.map(item => `<li>${escapeHtml(item)}</li>`).join('')
    : `<li>${escapeHtml(details.description ?? copy.outlineFallback)}</li>`;
  const title = escapeHtml(details.label);
  const description = escapeHtml(details.description ?? copy.outlineFallback);
  const deliverableItems = copy.deliverableItems
    .map(item => `<li>${escapeHtml(item)}</li>`)
    .join('');

  return `<style data-case-detail-pages>
    .case-detail-page{width:1100px;min-height:688px;padding:72px 84px;background:#fff;color:#16171a;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;position:relative;border-top:1px solid #e6e6e2}
    .case-detail-kicker{font-size:13px;letter-spacing:.14em;color:#6f737b}.case-detail-page h2{margin:22px 0 14px;font-size:42px;line-height:1.2}.case-detail-page p{font-size:18px;line-height:1.7;color:#4c5058;max-width:40em}.case-detail-page ol{margin:38px 0 0;padding:0;list-style:none;display:grid;gap:16px}.case-detail-page li{font-size:20px;line-height:1.5;border-bottom:1px solid #e6e6e2;padding-bottom:14px}.case-detail-number{position:absolute;right:84px;bottom:48px;font-size:13px;color:#9a9ea6}
  </style>
  <section class="case-detail-page" data-case-detail-page="2"><div class="case-detail-kicker">${escapeHtml(copy.outlineKicker)}</div><h2>${title}</h2><p>${description}</p><ol>${outlineItems}</ol><span class="case-detail-number">02 / 03</span></section>
  <section class="case-detail-page" data-case-detail-page="3"><div class="case-detail-kicker">${escapeHtml(copy.deliverableKicker)}</div><h2>${escapeHtml(copy.deliverableTitle)}</h2><p>${escapeHtml(copy.deliverableIntro)}</p><ol>${deliverableItems}</ol><span class="case-detail-number">03 / 03</span></section>`;
}

export async function loadCasePreview(
  id: string,
  details?: CasePreviewDetails,
): Promise<string | null> {
  const entry = Object.entries(sources).find(([path]) => path.endsWith(`/${id}.html`));
  if (!entry) return null;
  const html = await entry[1]();
  // Examples are isolated from application state and cannot fetch data or submit forms.
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
  const fitCover = entry[0].startsWith('/scripts/case-previews/')
    ? `<script>function fit(){document.body.style.zoom=Math.min(1,innerWidth/1100)}addEventListener('resize',fit);fit();</script>`
    : '';
  // Thumbnail sources hide page overflow; the detail viewport must allow reading below the fold.
  const scrollStyles =
    '<style>html{height:100%!important;width:100%!important;overflow-x:hidden!important;overflow-y:auto!important}body{overflow:visible!important}</style>';
  const pages =
    entry[0].startsWith('/scripts/case-previews/') && details ? continuationPages(details) : '';
  return html
    .replace(/<head([^>]*)>/i, `<head$1>${policy}<meta name="color-scheme" content="light">`)
    .replace(/<\/head>/i, `${scrollStyles}</head>`)
    .replace(/<\/body>/i, `${pages}${fitCover}</body>`);
}

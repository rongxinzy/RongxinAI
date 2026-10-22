// Runs inside the preview page (passed to page.evaluate). Serializes the current
// screen as a static HTML document: no scripts, no handlers, only the CSS rules
// that match an element on screen, images rasterized to data URIs, scroll offsets
// and form values frozen. Fonts are added afterwards by fonts.mjs.
export async function serializeScreen() {
  const DYNAMIC =
    /(^|[^\\])::?(hover|focus|focus-visible|focus-within|active|visited|placeholder-shown|before|after|placeholder|marker|selection|backdrop|file-selector-button|-webkit-[a-z-]+|-moz-[a-z-]+)(?![\w-])/g;
  const matches = selector => {
    let probe = selector;
    for (let i = 0; i < 3; i += 1) probe = probe.replace(DYNAMIC, '$1');
    probe = probe.trim().replace(/[>+~]\s*$/, '');
    if (!probe || /^&/.test(probe)) return true;
    try {
      return document.querySelector(probe) !== null;
    } catch {
      return true;
    }
  };
  const splitList = text => {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '\\') i += 1;
      else if (ch === '(' || ch === '[') depth += 1;
      else if (ch === ')' || ch === ']') depth -= 1;
      else if (ch === ',' && depth === 0) {
        parts.push(text.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(text.slice(start));
    return parts;
  };
  const serializeRules = rules => {
    let out = '';
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        if (!splitList(rule.selectorText).some(matches)) continue;
        const nested = rule.cssRules?.length ? serializeRules(rule.cssRules) : '';
        out += `${rule.selectorText}{${rule.style.cssText}${nested}}`;
      } else if (rule instanceof CSSMediaRule) {
        if (window.matchMedia(rule.conditionText).matches) out += serializeRules(rule.cssRules);
      } else if (rule instanceof CSSKeyframesRule || rule instanceof CSSFontFaceRule) {
        continue;
      } else if (rule instanceof CSSImportRule) {
        if (rule.styleSheet) out += serializeRules(rule.styleSheet.cssRules);
      } else if (rule.cssRules) {
        const inner = serializeRules(rule.cssRules);
        if (inner) out += `${rule.cssText.slice(0, rule.cssText.indexOf('{'))}{${inner}}`;
      } else {
        out += rule.cssText;
      }
    }
    return out;
  };
  let css = '';
  for (const sheet of document.styleSheets) {
    try {
      css += serializeRules(sheet.cssRules);
    } catch {
      // Cross-origin sheets are not part of the app.
    }
  }
  // Rasterize every visible image at 3x its rendered size.
  const raster = img => {
    const rect = img.getBoundingClientRect();
    if (!img.complete || !rect.width || !rect.height) return null;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(rect.width * 3);
    canvas.height = Math.ceil(rect.height * 3);
    const g = canvas.getContext('2d');
    g.imageSmoothingQuality = 'high';
    try {
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  };
  const live = [...document.body.querySelectorAll('*')];
  live.forEach((el, index) => {
    el.setAttribute('data-snap-i', String(index));
  });
  const doc = document.documentElement.cloneNode(true);
  const byIndex = new Map(
    [...doc.querySelectorAll('[data-snap-i]')].map(el => [el.getAttribute('data-snap-i'), el]),
  );
  live.forEach((el, index) => {
    el.removeAttribute('data-snap-i');
    const copy = byIndex.get(String(index));
    if (!copy) return;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      copy.setAttribute('data-snap-drop', '');
      return;
    }
    if (el instanceof HTMLImageElement) {
      const data = raster(el);
      if (data) copy.setAttribute('src', data);
      copy.removeAttribute('srcset');
    }
    if (el instanceof HTMLTextAreaElement) {
      copy.textContent = el.value;
      copy.setAttribute('style', `${copy.getAttribute('style') ?? ''};height:${el.offsetHeight}px`);
    }
    if (el instanceof HTMLInputElement) copy.setAttribute('value', el.value);
    if (el.scrollTop > 0 || el.scrollLeft > 0) {
      const shift = doc.ownerDocument.createElement('div');
      shift.setAttribute('style', `transform:translate(${-el.scrollLeft}px,${-el.scrollTop}px)`);
      while (copy.firstChild) shift.appendChild(copy.firstChild);
      copy.appendChild(shift);
    }
  });
  doc
    .querySelectorAll('[data-snap-drop],script,style,link,noscript,iframe,template')
    .forEach(el => el.remove());
  for (const el of doc.querySelectorAll('*')) {
    el.removeAttribute('data-snap-i');
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
    if (el.tagName === 'A') el.removeAttribute('href');
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON') {
      el.setAttribute('tabindex', '-1');
      if (el.tagName !== 'BUTTON') el.setAttribute('readonly', '');
    }
    if (el.hasAttribute('autofocus')) el.removeAttribute('autofocus');
  }
  const freeze =
    'html,body{overflow:hidden!important}*{animation:none!important;transition:none!important;caret-color:transparent!important;cursor:default!important}';
  const head = doc.querySelector('head');
  head.querySelectorAll('meta[http-equiv],base').forEach(el => el.remove());
  const style = doc.ownerDocument.createElement('style');
  style.textContent = css + freeze;
  head.appendChild(style);
  return {
    html: `<!doctype html>\n${doc.outerHTML}`,
    text: [...document.querySelectorAll('input,textarea')]
      .map(el => el.value + (el.placeholder ?? ''))
      .join(''),
  };
}

// Embeds subset fonts into a static snapshot so it renders with the same glyphs as
// the PNG on every machine. The families are the ones Chromium reported for the
// capture (CDP platform fonts); Python fontTools finds them in the system font
// folders and subsets them (`pip install fonttools brotli`).
import { execFileSync } from 'node:child_process';

// Resolves each installed family Chromium reported to its font file (and named
// instance for variable fonts), then subsets it to the text drawn with it.
const SUBSET_PY = `
import base64, io, json, logging, os, sys
from fontTools import subset
from fontTools.ttLib import TTFont, TTCollection
from fontTools.varLib import instancer
logging.getLogger('fontTools').setLevel(logging.ERROR)

DIRS = ['/usr/share/fonts', '/usr/local/share/fonts', os.path.expanduser('~/.fonts'),
        os.path.expanduser('~/.local/share/fonts'), '/System/Library/Fonts', '/Library/Fonts',
        os.path.expanduser('~/Library/Fonts'), 'C:/Windows/Fonts']

def name(font, nid):
    record = font['name'].getName(nid, 3, 1) or font['name'].getName(nid, 1, 0)
    return str(record) if record else ''

def faces():
    for root in DIRS:
        for folder, _, files in os.walk(root):
            for file in files:
                path = os.path.join(folder, file)
                low = file.lower()
                try:
                    if low.endswith(('.ttc', '.otc')):
                        fonts = list(enumerate(TTCollection(path, lazy=True).fonts))
                    elif low.endswith(('.ttf', '.otf')):
                        fonts = [(0, TTFont(path, lazy=True))]
                    else:
                        continue
                except Exception:
                    continue
                for index, font in fonts:
                    try:
                        family = name(font, 16) or name(font, 1)
                        weight = font['OS/2'].usWeightClass
                        if font['OS/2'].fsSelection & 1 or font['head'].macStyle & 2:
                            continue  # snapshots use upright text only
                        yield {'family': name(font, 1), 'path': path, 'index': index, 'weight': weight, 'coords': None}
                        if family != name(font, 1):
                            yield {'family': family, 'path': path, 'index': index, 'weight': weight, 'coords': None}
                        if 'fvar' in font:
                            for inst in font['fvar'].instances:
                                sub = str(font['name'].getDebugName(inst.subfamilyNameID) or '')
                                if 'italic' in sub.lower() or inst.coordinates.get('ital', 0) or inst.coordinates.get('slnt', 0):
                                    continue
                                w = inst.coordinates.get('wght', weight)
                                for fam in {family, (family + ' ' + sub).strip()}:
                                    yield {'family': fam, 'path': path, 'index': index, 'weight': w, 'coords': dict(inst.coordinates)}
                    except Exception:
                        continue

def css_rank(target):
    # CSS Fonts 4 weight matching: which installed weight a browser picks.
    def rank(face):
        w = face['weight']
        if 400 <= target <= 500:
            order = (0, w - target) if target <= w <= 500 else ((1, target - w) if w < target else (2, w - target))
        elif target < 400:
            order = (0, target - w) if w <= target else (1, w - target)
        else:
            order = (0, w - target) if w >= target else (1, target - w)
        return (order, face['coords'] is not None)
    return rank

def load(face, weight):
    font = TTFont(face['path'], fontNumber=face['index'])
    if 'fvar' in font:
        axes = {axis.axisTag: axis.defaultValue for axis in font['fvar'].axes}
        if face['coords']:
            axes.update(face['coords'])
        elif 'wght' in axes:
            wght = [axis for axis in font['fvar'].axes if axis.axisTag == 'wght'][0]
            axes['wght'] = max(min(weight, wght.maxValue), wght.minValue)
        font = instancer.instantiateVariableFont(font, axes)
    return font

req = json.load(sys.stdin)
wanted = {job['family'] for job in req['jobs']}
index = [face for face in faces() if face['family'] in wanted]
groups = []
for job in req['jobs']:
    candidates = [face for face in index if face['family'] == job['family']]
    if not candidates:
        raise SystemExit('font not found: ' + job['family'])
    best = min(candidates, key=css_rank(job['weight']))
    key = (best['path'], best['index'], json.dumps(best['coords']), best['weight'] if best['coords'] is None and 'Variable' in best['path'] else 0)
    last = groups[-1] if groups else None
    if last and last['alias'] == job['alias'] and last['key'] == key:
        last['text'] += job['text']
        last['high'] = job['weight']
    else:
        groups.append({'alias': job['alias'], 'key': key, 'face': best, 'weight': job['weight'], 'low': job['weight'], 'high': job['weight'], 'text': job['text']})
out = []
for i, group in enumerate(groups):
    font = load(group['face'], group['weight'])
    options = subset.Options()
    options.name_IDs = []
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=''.join(sorted(set(group['text']))))
    subsetter.subset(font)
    font.flavor = 'woff2'
    buf = io.BytesIO()
    font.save(buf)
    prev_same = i > 0 and groups[i - 1]['alias'] == group['alias']
    next_same = i + 1 < len(groups) and groups[i + 1]['alias'] == group['alias']
    codes = sorted(font.getBestCmap() or {})
    spans = []
    for code in codes:
        if spans and code == spans[-1][1] + 1:
            spans[-1][1] = code
        else:
            spans.append([code, code])
    out.append({
        'alias': group['alias'],
        'range': ','.join('U+%X' % a if a == b else 'U+%X-%X' % (a, b) for a, b in spans),
        'low': group['low'] if prev_same else 1,
        'high': groups[i + 1]['low'] - 1 if next_same else 1000,
        'data': base64.b64encode(buf.getvalue()).decode(),
    })
json.dump(out, sys.stdout)
`;

/**
 * For every element, record which installed font families Chromium used, at
 * which weight, for which text. Returns Map<stack, Map<family, Map<weight, text>>>.
 */
export async function collectPlatformFonts(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: false });
  const nodes = [];
  const walk = node => {
    if (
      node.nodeType === 1 &&
      !['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'TITLE'].includes(node.nodeName)
    ) {
      const own = (node.children ?? [])
        .filter(child => child.nodeType === 3)
        .map(child => child.nodeValue)
        .join('');
      const attrs = node.attributes ?? [];
      const placeholder = attrs[attrs.indexOf('placeholder') + 1] ?? '';
      nodes.push({
        nodeId: node.nodeId,
        text: own + (attrs.includes('placeholder') ? placeholder : ''),
      });
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  const stacks = new Map();
  for (const { nodeId, text } of nodes) {
    let fonts;
    let computed;
    try {
      ({ fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId }));
      if (!fonts.length) continue;
      ({ computedStyle: computed } = await cdp.send('CSS.getComputedStyleForNode', { nodeId }));
    } catch {
      continue;
    }
    const get = name => computed.find(entry => entry.name === name)?.value ?? '';
    const stack = get('font-family');
    const weight = Math.min(
      900,
      Math.max(100, Math.round((Number(get('font-weight')) || 400) / 100) * 100),
    );
    const families = stacks.get(stack) ?? new Map();
    for (const font of fonts) {
      if (font.isCustomFont) continue;
      const weights = families.get(font.familyName) ?? new Map();
      weights.set(weight, (weights.get(weight) ?? '') + text);
      families.set(font.familyName, weights);
    }
    stacks.set(stack, families);
  }
  await cdp.detach();
  return stacks;
}

const escapeHtmlAttr = value => value.replaceAll('"', '&quot;');
const ASCII = ` !"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\`abcdefghijklmnopqrstuvwxyz{|}~…·—–“”‘’`;
const isCjkFamily = family => /CJK|Han|Hei|YaHei|PingFang|Song|Kai/i.test(family);

/**
 * Returns the snapshot HTML with subset @font-face rules prepended and every
 * captured font-family stack prefixed with the embedded faces. `extraText`
 * (form values, pseudo-element content) is added to every face.
 */
export function embedFonts(html, extraText, stacks) {
  const aliases = new Map();
  const faces = [];
  for (const [stack, families] of stacks) {
    const names = [];
    for (const [family, weights] of families) {
      if (!aliases.has(family))
        aliases.set(family, { alias: `zy-snap-${aliases.size + 1}`, weights: new Map() });
      const entry = aliases.get(family);
      for (const [weight, text] of weights)
        entry.weights.set(weight, (entry.weights.get(weight) ?? '') + text);
      names.push(entry.alias);
    }
    // Latin faces first so Chinese text falls through to the CJK face.
    names.sort((a, b) => {
      const fa = [...aliases].find(([, v]) => v.alias === a)[0];
      const fb = [...aliases].find(([, v]) => v.alias === b)[0];
      return Number(isCjkFamily(fa)) - Number(isCjkFamily(fb));
    });
    if (names.length) faces.push({ stack, names });
  }
  // One job per (family, weight); faces that resolve to the same file are merged
  // after subsetting into one @font-face with a weight range.
  const jobs = [];
  for (const [family, { alias, weights }] of aliases) {
    for (const weight of [...weights.keys()].sort((a, b) => a - b)) {
      const text = [
        ...new Set(weights.get(weight) + extraText + (isCjkFamily(family) ? '' : ASCII)),
      ].join('');
      jobs.push({ alias, family, weight, text });
    }
  }
  const faceRules = JSON.parse(
    execFileSync('python3', ['-c', SUBSET_PY], {
      input: JSON.stringify({ jobs }),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'inherit'],
    }),
  );
  const fontCss = faceRules
    .map(
      face =>
        `@font-face{font-family:"${face.alias}";src:url(data:font/woff2;base64,${face.data}) format("woff2");font-weight:${face.low} ${face.high};unicode-range:${face.range};font-display:block}`,
    )
    .join('');
  let out = html.replace('</head>', `<style>${fontCss}</style></head>`);
  // Prefix every declaration (CSS text, custom properties, inline styles) whose
  // value is exactly a captured stack.
  const escapeRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match the stack whatever quote style or spacing the source CSS used.
  const stackPattern = (stack, quote) =>
    stack
      .split(',')
      .map(token => token.trim().replace(/^["']|["']$/g, ''))
      .map(token => `(?:${quote})?${escapeRe(token)}(?:${quote})?`)
      .join('\\s*,\\s*');
  for (const { stack, names } of faces) {
    const prefix = names.map(name => `"${name}"`).join(', ');
    for (const [quote, pre] of [
      [`["']`, prefix],
      [`&quot;|'`, escapeHtmlAttr(prefix)],
    ]) {
      const re = new RegExp(
        `(:\\s*)(${stackPattern(stack, quote)})(\\s*(?:!important)?\\s*[;}"])`,
        'g',
      );
      out = out.replace(re, `$1${pre}, $2$3`);
    }
  }
  return {
    html: out,
    fontBytes: faceRules.reduce((sum, face) => sum + face.data.length * 0.75, 0),
  };
}

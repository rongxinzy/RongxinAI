import { describe, expect, test } from 'vitest';

import { imageData } from './assets.mjs';
import { bars, esc, list, metricHtml } from './html.mjs';
import { englishPrompt, promptFor, stripTail } from './prompts.mjs';
import { pageShell } from './shell.mjs';
import { caseSkin } from './styles.mjs';

const baseCase = {
  id: 'docs-api',
  skill: 'docs',
  label: '文档',
  title: '确定接入方式。',
  lead: '背景说明。',
  insight: '内容依据。',
  steps: ['第一步。', '第二步。', '第三步。'],
  metrics: [
    ['1', '指标一'],
    ['2', '指标二'],
    ['3', '指标三'],
  ],
};

describe('esc', () => {
  test('escapes markup-significant characters', () => {
    expect(esc('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  test('coerces non-string values', () => {
    expect(esc(12)).toBe('12');
  });
});

describe('metricHtml', () => {
  test('renders one metric cell per pair', () => {
    expect(
      metricHtml([
        ['42', '完成率'],
        ['<b>', 'x'],
      ]),
    ).toBe(
      '<div class="metric"><strong>42</strong><span>完成率</span></div>' +
        '<div class="metric"><strong>&lt;b&gt;</strong><span>x</span></div>',
    );
  });
});

describe('list', () => {
  test('renders items as escaped list entries', () => {
    expect(list(['甲', '<i>'])).toBe('<ul class=""><li>甲</li><li>&lt;i&gt;</li></ul>');
  });

  test('accepts a custom class', () => {
    expect(list(['a'], 'rows')).toBe('<ul class="rows"><li>a</li></ul>');
  });
});

describe('bars', () => {
  test('renders one bar per point with default month labels', () => {
    expect(bars([10, 20])).toBe(
      '<div class="bars" role="img" aria-label="演示数据趋势">' +
        '<div class="bar-col"><i style="--h:10%"></i><span>一月</span></div>' +
        '<div class="bar-col"><i style="--h:20%"></i><span>二月</span></div></div>',
    );
  });

  test('falls back to numbered labels when labels run out', () => {
    expect(bars([5, 6, 7], ['A', 'B'])).toContain('<span>03</span>');
    expect(bars([5, 6, 7], ['A', 'B'])).not.toContain('一月');
  });
});

describe('stripTail', () => {
  test('drops trailing sentence punctuation after trimming', () => {
    expect(stripTail('收尾句。')).toBe('收尾句');
    expect(stripTail('  padded?')).toBe('padded');
    expect(stripTail('  padded ?')).toBe('padded ');
    expect(stripTail('mixed。.!')).toBe('mixed');
  });

  test('keeps text without trailing punctuation and tolerates nullish input', () => {
    expect(stripTail('no tail')).toBe('no tail');
    expect(stripTail(undefined)).toBe('');
  });
});

describe('caseSkin', () => {
  test('returns empty css for cases without a palette', () => {
    expect(caseSkin({ id: 'not-a-case' })).toBe('');
  });

  test('emits palette variables and the shared mobile media query', () => {
    const css = caseSkin({ id: 'pptx-education' });
    expect(css).toContain('body[data-case="pptx-education"]');
    expect(css).toContain('--accent:#425b38');
    expect(css).toContain('--case-bg:#f5f0dc');
    expect(css).toContain('@media(max-width:760px){');
    expect(css).toContain('body[data-case="research-policy"] .report');
  });
});

describe('pageShell', () => {
  test('wraps the body with head, accent, title and case marker', () => {
    const html = pageShell(baseCase, '<p>body</p>', '.x{color:red}', 'console.log(1)');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>确定接入方式。 · 文档</title>');
    expect(html).toContain(':root{--accent:#bc8250}');
    expect(html).toContain('data-case="docs-api"');
    expect(html).toContain('.x{color:red}');
    expect(html).toContain('<script>console.log(1)</script>');
    expect(html.endsWith('</body></html>')).toBe(true);
  });
});

describe('imageData', () => {
  test('maps legacy asset aliases and embeds the jpeg as base64', () => {
    expect(imageData('camera')).toMatch(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/);
    expect(imageData('camera')).toBe(imageData('camera-launch'));
  });
});

describe('promptFor', () => {
  test('splices the case into the shared Chinese template', () => {
    const prompt = promptFor(baseCase);
    expect(prompt).toContain('使用 docx 技能');
    expect(prompt).toContain('场景：确定接入方式');
    expect(prompt).toContain('背景：背景说明');
    expect(prompt).toContain('内容依据：内容依据');
    expect(prompt).toContain('关键步骤：第一步；第二步；第三步');
    expect(prompt).toContain('需要呈现的指标：指标一=1；指标二=2；指标三=3');
    expect(prompt).toContain('所有未提供的数字标记为演示假设');
  });

  test('opens each recipe with its skill-specific instruction', () => {
    const keywords = {
      pptx: 'presentation-studio',
      excel: 'xlsx',
      website: 'frontend-design',
      research: 'deep-research',
      academic: '学术研究能力',
      docs: 'docx',
    };
    for (const [skill, keyword] of Object.entries(keywords)) {
      const prompt = promptFor({ ...baseCase, skill });
      expect(prompt).toContain(keyword);
    }
  });
});

describe('englishPrompt', () => {
  test('combines the skill ending, english scenario brief and title ask', () => {
    const c = { ...baseCase, id: 'docs-prd', title: '备用中文标题' };
    const prompt = englishPrompt(c);
    expect(prompt.startsWith('Use the document skill')).toBe(true);
    expect(prompt).toContain('Brief: Define knowledge retrieval');
    expect(prompt).toContain('Key steps: Retrieve only knowledge the user may access');
    expect(prompt).toContain('“Turn scattered experience into a reviewable proposal”');
    expect(prompt).toContain('rather than a measured result.');
  });
});

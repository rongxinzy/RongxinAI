import { describe, expect, test } from 'vitest';
import config from '../../../../public/quick-actions.json';
import { loadCasePreview } from './casePreviewSources';

describe('bundled case detail previews', () => {
  const copy = {
    outlineKicker: 'KICKER',
    deliverableKicker: 'DELIVERABLE-KICKER',
    outlineFallback: 'FALLBACK',
    deliverableTitle: 'DELIVERABLE-TITLE',
    deliverableIntro: 'DELIVERABLE-INTRO',
    deliverableItems: ['ITEM-ONE', 'ITEM-TWO', 'ITEM-THREE'],
  };
  const details = {
    label: '案例标题',
    description: '案例说明',
    prompt: '1. 第一项具体工作内容;\n2. 第二项具体工作内容;\n风格要求: 简洁清晰',
    copy,
  };

  test('every configured case has an HTML example with isolated network access', async () => {
    for (const action of config.actions) {
      for (const prompt of action.prompts) {
        const html = await loadCasePreview(prompt.id);
        expect(html, prompt.id).toContain('<!');
        expect(html, prompt.id).toContain("connect-src 'none'");
      }
    }
  });
  test('unknown cases do not resolve arbitrary paths', async () => {
    expect(await loadCasePreview('../unknown')).toBeNull();
  });

  /**
   * 生成页的文案由调用方按当前语言传入，模块自身不得再写死中文：
   * 传入的文案必须原样出现在结果里。
   */
  test('turns single-page examples into a readable three-page walkthrough', async () => {
    const html = await loadCasePreview('pptx-work-report', details);

    expect(html).toContain('data-case-detail-page="2"');
    expect(html).toContain('data-case-detail-page="3"');
    expect(html).toContain('案例标题');
    expect(html).toContain('第一项具体工作内容');
    expect(html).toContain(copy.outlineKicker);
    expect(html).toContain(copy.deliverableKicker);
    expect(html).toContain(copy.deliverableTitle);
    expect(html).toContain(copy.deliverableIntro);
    expect(html).toContain(copy.deliverableItems[1]);
  });
});

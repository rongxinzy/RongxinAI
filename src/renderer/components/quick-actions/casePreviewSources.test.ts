import { describe, expect, test } from 'vitest';
import config from '../../../../public/quick-actions.json';
import { loadCasePreview } from './casePreviewSources';

describe('bundled case detail previews', () => {
  test('every configured case has an HTML example with isolated network access', async () => {
    for (const action of config.actions) {
      for (const prompt of action.prompts) {
        const html = await loadCasePreview(prompt.id);
        expect(html, prompt.id).toContain('<!');
        expect(html, prompt.id).toContain("connect-src 'none'");
        expect(html, prompt.id).toContain('img-src data:;');
      }
    }
  });
  test('unknown cases do not resolve arbitrary paths', async () => {
    expect(await loadCasePreview('../unknown')).toBeNull();
  });

  /**
   * 文档类预览按 1100px 设计宽度注入自适应缩放。缩放必须用「未缩放的」内容宽度计算：
   * scrollWidth 在 zoom 生效后返回的是缩放坐标系下的值，把它喂回去会让对话框放大后
   * 仍停在收起时的缩放比例（展开预览不跟随视口）。
   */
  test('rescales the preview from an unzoomed measurement', async () => {
    const html = await loadCasePreview('research-supply-chain');

    expect(html).not.toBeNull();
    expect(html).toContain("b.style.zoom=''");
    expect(html).toContain('addEventListener');
  });

  /**
   * 文档类实例自己就是完整的多页文档，详情直接展示原文，不再拼接任何生成页；
   * 生成页一旦回来，预览会出现与正文无关的重复页。
   */
  test('serves the example as-is without appending generated pages', async () => {
    const html = await loadCasePreview('research-market-entry');

    expect(html).not.toBeNull();
    expect(html).not.toContain('data-case-detail-page');
  });
});

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
   * 案例预览现在是自包含的响应式独立页（viewport meta + 内联样式/脚本），
   * 详情弹窗直接按原文展示，不再注入任何缩放脚本：
   * 一旦有人把「按固定 1100px 注入 fit() 缩放」的老实现加回来，这条负向断言会失败。
   */
  test('serves redesigned research briefs as responsive standalone pages', async () => {
    const html = await loadCasePreview('research-supply-chain');

    expect(html).not.toBeNull();
    expect(html).toContain('name="viewport"');
    expect(html).toContain('EVIDENCE MAP');
    expect(html).not.toContain('style.zoom');
    expect(html).not.toContain('innerWidth/1100');
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

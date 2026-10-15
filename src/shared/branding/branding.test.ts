import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBranding } from './index';

describe('Product Branding Resolver', () => {
  const origEnv = process.env.APP_EDITION;

  beforeEach(() => {
    delete process.env.APP_EDITION;
    delete process.env.VITE_APP_EDITION;
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.APP_EDITION = origEnv;
    } else {
      delete process.env.APP_EDITION;
    }
  });

  it('defaults to ZhiYuan branding when no edition is specified', () => {
    const branding = getBranding();
    expect(branding.editionId).toBe('zhiyuan');
    expect(branding.productName).toBe('知远智能体');
    expect(branding.shortName).toBe('知远');
    expect(branding.englishName).toBe('ZhiYuan Agent');
    expect(branding.dataDirName).toBe('ZhiYuanAgent');
    expect(branding.features.enableCommunityFreeModels).toBe(true);
    expect(branding.features.enableCommunityAuth).toBe(true);
    expect(branding.features.enableAISphere).toBe(false);
  });

  it('resolves Xiaoruan branding when specified via argument or env', () => {
    const brandingFromArg = getBranding('xiaoruan');
    expect(brandingFromArg.editionId).toBe('xiaoruan');
    expect(brandingFromArg.productName).toBe('晓软AI智能体');
    expect(brandingFromArg.shortName).toBe('晓软');
    expect(brandingFromArg.englishName).toBe('XiaoRuan AI Agent');
    expect(brandingFromArg.dataDirName).toBe('XiaoRuanAIAgent');
    expect(brandingFromArg.defaultTheme).toBe('xiaoruan-light');
    expect(brandingFromArg.features.enableCommunityFreeModels).toBe(false);
    expect(brandingFromArg.features.enableCommunityAuth).toBe(false);
    expect(brandingFromArg.features.enableAISphere).toBe(true);

    process.env.APP_EDITION = 'xiaoruan';
    const brandingFromEnv = getBranding();
    expect(brandingFromEnv.editionId).toBe('xiaoruan');
  });

  it('falls back to ZhiYuan branding for unknown edition IDs', () => {
    const branding = getBranding('unknown-custom');
    expect(branding.editionId).toBe('zhiyuan');
  });
});

import { describe, expect, it } from 'vitest';

import { CHINA_PROVIDER_DEFINITIONS } from './providerDefinitionsChina';
import { ProviderName } from './constants';

describe('China Provider Definitions - Context Window Limits', () => {
  it('configures DeepSeek models with official limits (1M for V4, 64k for reasoner)', () => {
    const deepseek = CHINA_PROVIDER_DEFINITIONS.find(p => p.id === ProviderName.DeepSeek);
    expect(deepseek).toBeDefined();

    const flash = deepseek?.defaultModels.find(m => m.id === 'deepseek-v4-flash');
    expect(flash?.contextWindow).toBe(1_000_000);
    expect(flash?.maxTokens).toBe(384_000);

    const pro = deepseek?.defaultModels.find(m => m.id === 'deepseek-v4-pro');
    expect(pro?.contextWindow).toBe(1_000_000);
    expect(pro?.maxTokens).toBe(384_000);

    const reasoner = deepseek?.defaultModels.find(m => m.id === 'deepseek-reasoner');
    expect(reasoner?.contextWindow).toBe(65536);
    expect(reasoner?.maxTokens).toBe(8192);
  });

  it('configures Qianfan 8k models with exact 8192 context window', () => {
    const qianfan = CHINA_PROVIDER_DEFINITIONS.find(p => p.id === ProviderName.Qianfan);
    expect(qianfan).toBeDefined();

    const ernie8k = qianfan?.defaultModels.find(m => m.id === 'ernie-4.5-8k');
    expect(ernie8k?.contextWindow).toBe(8192);
    expect(ernie8k?.maxTokens).toBe(4096);

    const ernieTurbo8k = qianfan?.defaultModels.find(m => m.id === 'ernie-4.5-turbo-8k');
    expect(ernieTurbo8k?.contextWindow).toBe(8192);
    expect(ernieTurbo8k?.maxTokens).toBe(4096);

    const dsV32 = qianfan?.defaultModels.find(m => m.id === 'deepseek-v3.2');
    expect(dsV32?.contextWindow).toBe(65536);
    expect(dsV32?.maxTokens).toBe(8192);

    const dsR1 = qianfan?.defaultModels.find(m => m.id === 'deepseek-r1');
    expect(dsR1?.contextWindow).toBe(65536);
    expect(dsR1?.maxTokens).toBe(8192);

    const glm51 = qianfan?.codingPlanModels?.find(m => m.id === 'glm-5.1');
    expect(glm51?.contextWindow).toBe(131072);
    expect(glm51?.maxTokens).toBe(8192);
  });

  it('configures Volcengine ark-code-latest with 256k context window', () => {
    const volcengine = CHINA_PROVIDER_DEFINITIONS.find(p => p.id === ProviderName.Volcengine);
    expect(volcengine).toBeDefined();

    const autoModel = volcengine?.defaultModels.find(m => m.id === 'ark-code-latest');
    expect(autoModel?.contextWindow).toBe(256000);
    expect(autoModel?.maxTokens).toBe(128000);

    const codingModel = volcengine?.codingPlanModels?.find(m => m.id === 'ark-code-latest');
    expect(codingModel?.contextWindow).toBe(256000);
    expect(codingModel?.maxTokens).toBe(128000);
  });

  it('configures Xiaomi models with appropriate context limits', () => {
    const xiaomi = CHINA_PROVIDER_DEFINITIONS.find(p => p.id === ProviderName.Xiaomi);
    expect(xiaomi).toBeDefined();

    const ultra = xiaomi?.defaultModels.find(m => m.id === 'mimo-v2.5-pro-ultraspeed');
    expect(ultra?.contextWindow).toBe(1000000);
    expect(ultra?.maxTokens).toBe(128000);

    const v2Pro = xiaomi?.defaultModels.find(m => m.id === 'mimo-v2-pro');
    expect(v2Pro?.contextWindow).toBe(65536);
    expect(v2Pro?.maxTokens).toBe(8192);

    const v2Flash = xiaomi?.defaultModels.find(m => m.id === 'mimo-v2-flash');
    expect(v2Flash?.contextWindow).toBe(65536);
    expect(v2Flash?.maxTokens).toBe(8192);
  });
});

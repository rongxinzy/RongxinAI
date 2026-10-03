import { describe, expect, it, vi } from 'vitest';

import type { TriageConfig, TriageResult, TriageState } from '../../../shared/triage';
import { chooseTriageModelSwitch, classifyByLocalModel } from './modelTriage';
import * as piClassifierTriage from './piClassifierTriage';

vi.mock('./piClassifierTriage', () => ({
  classifyTierForTriage: vi.fn(),
}));

const config = (overrides: Partial<TriageConfig['rules']> = {}): TriageConfig => ({
  enabled: true,
  rules: {
    lightModelRef: 'llamacpp/qwen-small',
    heavyModelRef: 'zhipu/glm-5.2',
    maxConversationRoundsForTriage: 20,
    allowCrossProviderSwitch: false,
    cooldownRounds: 3,
    useLocalModelTriage: true,
    triageModelName: 'Qwen3.6-35B-A3B',
    classifierBaseUrl: 'http://172.18.5.123:8000',
    ...overrides,
  },
});

const state = (overrides: Partial<TriageState> = {}): TriageState => ({
  lastSwitchRound: 0,
  activeTier: 'standard',
  ...overrides,
});

describe('classifyByLocalModel', () => {
  it('maps confident classifier answers onto tier model refs', async () => {
    vi.mocked(piClassifierTriage.classifyTierForTriage).mockResolvedValueOnce({
      tier: 'heavy',
      confidence: 0.9,
    });

    const result = await classifyByLocalModel('refactor this module', 'Qwen3.6-35B-A3B', config());

    expect(result).toEqual({
      tier: 'heavy',
      modelRef: 'zhipu/glm-5.2',
      reason: 'llm: heavy (0.90)',
    });
    expect(piClassifierTriage.classifyTierForTriage).toHaveBeenCalledWith(
      'refactor this module',
      'http://172.18.5.123:8000',
      'Qwen3.6-35B-A3B',
    );
  });

  it('returns null without a configured server url', async () => {
    vi.mocked(piClassifierTriage.classifyTierForTriage).mockClear();
    const result = await classifyByLocalModel('hi', 'm', config({ classifierBaseUrl: '' }));
    expect(result).toBeNull();
    expect(piClassifierTriage.classifyTierForTriage).not.toHaveBeenCalled();
  });
});

describe('chooseTriageModelSwitch', () => {
  const heavy: TriageResult = { tier: 'heavy', modelRef: 'zhipu/glm-5.2', reason: 'llm' };
  const light: TriageResult = { tier: 'light', modelRef: 'llamacpp/qwen-small', reason: 'llm' };

  it('switches models within the same provider and records the round', () => {
    const decision = chooseTriageModelSwitch('zhipu/glm-5.2-air', heavy, state(), config(), 7);
    expect(decision.modelRef).toBe('zhipu/glm-5.2');
    expect(decision.state).toEqual({ lastSwitchRound: 7, activeTier: 'heavy' });
  });

  it('blocks cross-provider switches unless explicitly allowed', () => {
    expect(chooseTriageModelSwitch('openai/gpt-5.2', heavy, state(), config(), 7).modelRef).toBe(
      null,
    );
    const allowCross = config({ allowCrossProviderSwitch: true });
    expect(chooseTriageModelSwitch('openai/gpt-5.2', heavy, state(), allowCross, 7).modelRef).toBe(
      'zhipu/glm-5.2',
    );
  });

  it('respects the cooldown when switching down', () => {
    const cooled = state({ activeTier: 'heavy', lastSwitchRound: 6 });
    // round 7 within cooldown of 3 → downgrade refused
    expect(chooseTriageModelSwitch('zhipu/glm-5.2', light, cooled, config(), 7).modelRef).toBe(
      null,
    );
    // round 10 clears it
    expect(chooseTriageModelSwitch('zhipu/glm-5.2', light, cooled, config(), 10).modelRef).toBe(
      null,
    );
    // light model lives on another provider, so even past cooldown it stays
    const sameProviderLight: TriageResult = {
      tier: 'light',
      modelRef: 'zhipu/glm-air',
      reason: 'llm',
    };
    expect(
      chooseTriageModelSwitch('zhipu/glm-5.2', sameProviderLight, cooled, config(), 10).modelRef,
    ).toBe('zhipu/glm-air');
  });

  it('keeps the current model when the result matches or carries no ref', () => {
    expect(chooseTriageModelSwitch('zhipu/glm-5.2', heavy, state(), config(), 1).modelRef).toBe(
      null,
    );
    const noRef: TriageResult = { tier: 'standard', modelRef: null, reason: 'default' };
    expect(chooseTriageModelSwitch('openai/gpt-5.2', noRef, state(), config(), 1).modelRef).toBe(
      null,
    );
  });
});

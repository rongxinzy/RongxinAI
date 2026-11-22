// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { CONSOLIDATED_PROVIDER_PRESETS } from '../../../renderer/services/modelSettings/providerPresets';
import { LOCAL_GPU_MAGPIE_PROVIDER_ID } from '../../magpie/constants';
import { ProviderAvatar } from './ProviderAvatar';
import { resolveProviderAvatarKind } from './providerPresetMatcher';

describe('resolveProviderAvatarKind & ProviderAvatar', () => {
  test('renders an SVG icon (not a single-letter initial) for every preset provider', () => {
    for (const preset of CONSOLIDATED_PROVIDER_PRESETS) {
      const { container } = render(
        <ProviderAvatar name={preset.name} providerKey={preset.key} baseUrl={preset.baseUrl} />,
      );
      expect(container.querySelector('svg'), `missing svg for preset ${preset.key}`).not.toBeNull();
    }
  });

  test('resolves generated provider-* IDs back to preset brand icons via baseUrl even if renamed', () => {
    for (const preset of CONSOLIDATED_PROVIDER_PRESETS) {
      if (preset.key === 'custom') continue;
      expect(
        resolveProviderAvatarKind({
          providerKey: 'provider-m3xyz-abcd',
          name: 'My Custom Alias',
          baseUrl: preset.baseUrl,
        }),
      ).toBe(preset.key);
      if (preset.planVariant) {
        expect(
          resolveProviderAvatarKind({
            providerKey: 'provider-m3xyz-plan',
            name: 'Plan Key',
            baseUrl: preset.planVariant.baseUrl,
          }),
        ).toBe(preset.key);
      }
    }
  });

  test('resolves known preset names when baseUrl is unavailable', () => {
    expect(resolveProviderAvatarKind({ name: '阿里云百炼（通义千问）' })).toBe('qwen');
    expect(resolveProviderAvatarKind({ name: '火山方舟（豆包）' })).toBe('volcengine');
    expect(resolveProviderAvatarKind({ name: '百度千帆（文心）' })).toBe('qianfan');
    expect(resolveProviderAvatarKind({ name: '小米 MiMo' })).toBe('xiaomi');
    expect(resolveProviderAvatarKind({ name: 'xAI Grok' })).toBe('grok');
    expect(resolveProviderAvatarKind({ name: 'OpenRouter' })).toBe('openrouter');
  });

  test('maps local GPU, organization, subscription, group, and falls back to initial for unknown custom providers', () => {
    expect(resolveProviderAvatarKind({ providerKey: LOCAL_GPU_MAGPIE_PROVIDER_ID })).toBe(
      'llamacpp',
    );
    expect(resolveProviderAvatarKind({ providerKey: 'custom_aisphere' })).toBe('organization');
    expect(resolveProviderAvatarKind({ providerKey: 'zhiyuan-host-aisphere-catalog' })).toBe(
      'organization',
    );
    expect(resolveProviderAvatarKind({ providerKey: 'sub_codex' })).toBe('subscription');
    expect(resolveProviderAvatarKind({ providerKey: 'group' })).toBe('group');
    expect(
      resolveProviderAvatarKind({
        providerKey: 'provider-custom-99',
        name: '公司内部网关',
        baseUrl: 'https://llm.internal.example/v1',
      }),
    ).toBeNull();

    const { container } = render(
      <ProviderAvatar
        providerKey="provider-custom-99"
        name="公司内部网关"
        baseUrl="https://llm.internal.example/v1"
      />,
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('公');
  });
});

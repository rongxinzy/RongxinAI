// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { MagpiePreferences } from '../../../../shared/magpie/preferences';
import { i18nService } from '../../../services/i18n';
import { getModelPickerLabels } from '../../../services/modelSettings/modelCapabilities';
import { ScenarioModelsSection } from './ScenarioModelsSection';

function createPreferences(overrides: Partial<MagpiePreferences> = {}): MagpiePreferences {
  return {
    gateway: 'http://127.0.0.1:3425',
    proxy: '',
    proxyNow: '',
    proxySource: 'none',
    bareModelIDs: false,
    port: 3425,
    lan: false,
    onNetwork: false,
    lanUrls: [],
    vision: '',
    visionEffort: 'medium',
    visionEfforts: ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'off'],
    visionModels: [{ id: 'gpt-4o', name: 'GPT-4o', providerName: 'Magpie' }],
    imageGen: '',
    imageGenModels: [],
    searcher: '',
    searcherEffort: '',
    searchFirst: '',
    searchEfforts: [],
    searchChoices: [],
    searchRelays: [],
    disabledModels: [],
    redact: true,
    redactPersonal: false,
    redactKinds: {},
    redactWords: [],
    noAccountDiscovery: false,
    noAccountsEnv: false,
    ...overrides,
  };
}

describe('ScenarioModelsSection', () => {
  test('renders localized reasoning effort labels without exposing internal runtime keys', () => {
    i18nService.setLanguage('zh', { persist: false });
    const onUpdate = vi.fn().mockResolvedValue(true);

    render(
      <ScenarioModelsSection
        preferences={createPreferences()}
        pickerLabels={getModelPickerLabels()}
        onUpdate={onUpdate}
      />,
    );

    expect(screen.queryByText(/magpie/i)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '默认' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '无' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '极简' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '低' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '中' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '高' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '极高' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '最高' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '关闭' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '高' }));
    expect(onUpdate).toHaveBeenCalledWith({ visionEffort: 'high' });
  });

  test('neutralizes unknown effort values and upstream provider labels containing internal branding', () => {
    i18nService.setLanguage('zh', { persist: false });
    render(
      <ScenarioModelsSection
        preferences={createPreferences({
          visionEffort: 'magpie-turbo',
          visionEfforts: ['magpie-turbo'],
        })}
        pickerLabels={getModelPickerLabels()}
        onUpdate={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(screen.queryByText(/magpie/i)).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '模型服务-turbo' })).toBeInTheDocument();
  });
});

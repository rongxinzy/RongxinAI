// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MagpieProviderSummary } from '../../../../shared/magpie/types';
import { i18nService } from '../../../services/i18n';
import { ProviderManagerSection } from './ProviderManagerSection';

describe('ProviderManagerSection', () => {
  beforeEach(() => {
    i18nService.setLanguage('zh', { persist: false });
  });
  const mockProviders: MagpieProviderSummary[] = [
    {
      id: 'zhiyuan-host-enterprise',
      name: 'Enterprise Gateway',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:8000',
      models: ['ent-gpt4'],
      off: false,
      isHostManaged: true,
      hasKey: false,
      keyMasked: 'system-managed',
    },
    {
      id: 'custom-openai',
      name: 'My OpenAI',
      api: 'openai-completions',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o', 'gpt-4o-mini'],
      off: false,
      isHostManaged: false,
      hasKey: true,
      keyMasked: 'sk-...4567',
    },
  ];

  it('renders providers and distinguishes system-managed from custom providers', () => {
    const onRefresh = vi.fn();
    const onSave = vi.fn();
    const onToggle = vi.fn();
    const onDelete = vi.fn();

    render(
      <ProviderManagerSection
        providers={mockProviders}
        onRefresh={onRefresh}
        onSaveProvider={onSave}
        onToggleProvider={onToggle}
        onDeleteProvider={onDelete}
      />,
    );

    expect(screen.getByText('Enterprise Gateway')).toBeTruthy();
    expect(screen.getByText('My OpenAI')).toBeTruthy();
    expect(screen.getByText(i18nService.t('magpieHostManaged'))).toBeTruthy();
  });

  it('opens add provider dialog when Add button is clicked and submits payload', async () => {
    const onSave = vi.fn().mockResolvedValue(true);

    render(
      <ProviderManagerSection
        providers={mockProviders}
        onRefresh={vi.fn()}
        onSaveProvider={onSave}
        onToggleProvider={vi.fn()}
        onDeleteProvider={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText(i18nService.t('magpieAddProvider')));
    expect(screen.getByRole('dialog')).toBeTruthy();

    // Fill in required fields
    fireEvent.change(screen.getByPlaceholderText(i18nService.t('magpieProviderNamePlaceholder')), {
      target: { value: 'New Test Provider' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://api.openai.com/v1'), {
      target: { value: 'https://api.example.com/v1' },
    });

    fireEvent.click(screen.getByText(i18nService.t('save')));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Test Provider',
          baseUrl: 'https://api.example.com/v1',
        }),
      );
    });
  });

  it('opens destructive confirmation dialog when delete is clicked for a custom provider', async () => {
    const onDelete = vi.fn().mockResolvedValue(true);

    render(
      <ProviderManagerSection
        providers={mockProviders}
        onRefresh={vi.fn()}
        onSaveProvider={vi.fn()}
        onToggleProvider={vi.fn()}
        onDeleteProvider={onDelete}
      />,
    );

    const deleteBtn = screen.getByTitle(i18nService.t('magpieDeleteProviderTitle'));
    fireEvent.click(deleteBtn);

    expect(screen.getByText(i18nService.t('magpieDeleteProviderDescription'))).toBeTruthy();
    fireEvent.click(screen.getByText(i18nService.t('delete')));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('custom-openai');
    });
  });
});

// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { MagpieTestProviderResult } from '../../../../shared/magpie/types';
import { AddProviderWizard } from './AddProviderWizard';

vi.mock('../../../services/i18n', () => ({
  i18nService: { t: (key: string) => key, getLanguage: () => 'zh' },
}));

describe('AddProviderWizard', () => {
  const testProvider = vi.fn();
  const onSave = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        magpie: {
          testProvider,
        },
      },
    });
  });

  test('walks through preset -> debounced test -> /v1 fix -> model selection save', async () => {
    vi.useFakeTimers();
    const onOpenChange = vi.fn();
    onSave.mockResolvedValue(undefined);

    const htmlResult: MagpieTestProviderResult = {
      ok: false,
      errorCode: 'html-endpoint',
      error: 'Received HTML instead of JSON',
    };
    const okResult: MagpieTestProviderResult = {
      ok: true,
      discoveredModels: ['deepseek-chat', 'deepseek-reasoner'],
    };
    testProvider.mockResolvedValueOnce(htmlResult).mockResolvedValueOnce(okResult);

    render(<AddProviderWizard open onOpenChange={onOpenChange} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: /DeepSeek/i }));
    const keyInput = screen.getByPlaceholderText('magpieProviderKeyPlaceholder');

    await act(async () => {
      fireEvent.change(keyInput, { target: { value: 'sk-test-12345678' } });
      await vi.advanceTimersByTimeAsync(550);
    });

    vi.useRealTimers();

    await waitFor(() => expect(testProvider).toHaveBeenCalledTimes(1));

    // Step 2 error banner should offer one-click /v1 fix when missing /v1, or allow retry
    expect(screen.getByRole('button', { name: 'providerWizardNext' })).toBeEnabled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'providerWizardTestFirst' }));
    });
    await waitFor(() => expect(testProvider).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'providerWizardNext' }));
    expect(screen.getByText('deepseek-reasoner')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'providerWizardSaveAndEnable' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'DeepSeek',
        key: 'sk-test-12345678',
        models: expect.arrayContaining(['deepseek-chat', 'deepseek-reasoner']),
      }),
      'deepseek-chat',
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test('offers custom provider fallback when preset search has no matches', () => {
    render(<AddProviderWizard open onOpenChange={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByPlaceholderText('providerWizardSearchPlaceholder'), {
      target: { value: 'nonexistent-xyz' },
    });

    expect(screen.getByText('providerWizardSearchEmpty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'providerWizardUseCustomFallback' }));
    expect(screen.getByText('providerWizardStep2Title')).toBeInTheDocument();
    expect(screen.getByText('自定义服务商')).toBeInTheDocument();
  });

  test('saves discovered per-model context windows reported by the endpoint', async () => {
    onSave.mockResolvedValue(undefined);
    testProvider.mockResolvedValueOnce({
      ok: true,
      discoveredModels: ['qwen3-local'],
      discoveredModelContexts: { 'qwen3-local': 32768 },
    });

    render(<AddProviderWizard open onOpenChange={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByPlaceholderText('providerWizardSearchPlaceholder'), {
      target: { value: 'nonexistent-xyz' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'providerWizardUseCustomFallback' }));
    fireEvent.change(screen.getByPlaceholderText('https://api.example.com/v1'), {
      target: { value: 'http://172.18.5.188:3000/v1' },
    });
    fireEvent.change(screen.getByPlaceholderText('magpieProviderKeyPlaceholder'), {
      target: { value: 'sk-local' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'providerWizardTestFirst' }));
    });
    await waitFor(() => expect(testProvider).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'providerWizardNext' }));
    expect(screen.getByText('32768')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'providerWizardSaveAndEnable' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        contexts: { 'qwen3-local': 32768 },
      }),
      'qwen3-local',
    );
  });
});

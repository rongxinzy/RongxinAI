// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { MagpieProviderSummary } from '../../../../shared/magpie/types';
import { EditProviderDialog } from './EditProviderDialog';

vi.mock('../../../services/i18n', () => ({
  i18nService: { t: (key: string) => key },
}));

const sampleProvider: MagpieProviderSummary = {
  id: 'deepseek',
  name: 'DeepSeek',
  api: 'openai-completions',
  baseUrl: 'https://api.deepseek.com/v1',
  models: ['deepseek-chat', 'deepseek-reasoner'],
  hasKey: true,
  off: false,
  contexts: { '*': 128000 },
};

describe('EditProviderDialog', () => {
  const testProvider = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { magpie: { testProvider } },
    });
  });

  test('tests connection, discovers models, and saves parsed context window', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    testProvider.mockResolvedValue({ ok: true, discoveredModels: ['deepseek-coder'] });

    render(
      <EditProviderDialog
        open
        provider={sampleProvider}
        onOpenChange={onOpenChange}
        onSave={onSave}
      />,
    );

    expect(screen.getByDisplayValue('DeepSeek')).toBeInTheDocument();
    expect(screen.getByText('deepseek-chat')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'modelsProvidersTestAction' }));
    await waitFor(() => expect(screen.getByText('deepseek-coder')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('magpieProviderContext'), {
      target: { value: '256k' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'deepseek',
        models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
        contexts: { '*': 262144 },
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

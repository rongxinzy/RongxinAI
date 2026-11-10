// @vitest-environment jsdom
import { createElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MagpieProviderSummary } from '../../../../shared/magpie/types';
import type { MagpieTestProviderResult } from '../../../../shared/magpie/types';
import { i18nService } from '../../../services/i18n';
import { ProviderEditDialog } from './ProviderEditDialog';

const provider: MagpieProviderSummary = {
  id: 'relay',
  name: 'Relay',
  api: 'openai-completions',
  baseUrl: 'https://relay.test/v1',
  models: ['gpt-4o'],
  off: false,
  hasKey: true,
  contexts: { '*': 65536, 'gpt-4o': 131072 },
};

describe('provider context form', () => {
  beforeEach(() => {
    i18nService.setLanguage('zh', { persist: false });
  });

  it('sends an explicit empty table only after clear all', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      createElement(ProviderEditDialog, { open: true, onOpenChange: vi.fn(), provider, onSave }),
    );
    fireEvent.click(screen.getByText(i18nService.t('magpieProviderContextReset')));
    fireEvent.click(screen.getByText(i18nService.t('save')));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ contexts: {} }));
    });
  });

  it('removes a model override without discarding the default', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      createElement(ProviderEditDialog, { open: true, onOpenChange: vi.fn(), provider, onSave }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: i18nService.t('magpieProviderContextRemove') }),
    );
    fireEvent.click(screen.getByText(i18nService.t('save')));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ contexts: { '*': 65536 } }));
    });
  });

  it('reopening restores saved values and resets untouched payload semantics', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const props = { open: true, onOpenChange: vi.fn(), provider, onSave };
    const view = render(createElement(ProviderEditDialog, props));
    fireEvent.change(screen.getByDisplayValue('65536'), { target: { value: '32k' } });
    view.rerender(createElement(ProviderEditDialog, { ...props, open: false }));
    view.rerender(createElement(ProviderEditDialog, props));
    expect(screen.getByDisplayValue('65536')).toBeTruthy();
    fireEvent.click(screen.getByText(i18nService.t('save')));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('contexts');
  });

  it('disables existing context inputs and clear all while saving', async () => {
    let finishSave: (value: boolean) => void = () => {};
    const onSave = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          finishSave = resolve;
        }),
    );
    render(
      createElement(ProviderEditDialog, { open: true, onOpenChange: vi.fn(), provider, onSave }),
    );
    fireEvent.click(screen.getByText(i18nService.t('save')));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect((screen.getByDisplayValue('65536') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByDisplayValue('131072') as HTMLInputElement).disabled).toBe(true);
    expect(
      screen
        .getByRole('button', { name: i18nService.t('magpieProviderContextRemove') })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen
        .getByRole('button', { name: i18nService.t('magpieProviderContextReset') })
        .hasAttribute('disabled'),
    ).toBe(true);
    await act(async () => finishSave(false));
  });

  it('adds a model with Enter without submitting and leaves contexts untouched', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      createElement(ProviderEditDialog, { open: true, onOpenChange: vi.fn(), provider, onSave }),
    );
    const input = screen.getByPlaceholderText(i18nService.t('magpieModelAddPlaceholder'));
    fireEvent.change(input, { target: { value: 'new-model' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('new-model')).toBeTruthy();
    fireEvent.click(screen.getByText(i18nService.t('save')));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].models).toEqual(['gpt-4o', 'new-model']);
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('contexts');
  });

  it('ignores an earlier probe after closing, reopening and starting another probe', async () => {
    const finish: ((value: MagpieTestProviderResult) => void)[] = [];
    const onTest = vi.fn(
      () => new Promise<MagpieTestProviderResult>(resolve => finish.push(resolve)),
    );
    const props = { open: true, onOpenChange: vi.fn(), provider, onSave: vi.fn(), onTest };
    const view = render(createElement(ProviderEditDialog, props));
    fireEvent.click(screen.getByText(i18nService.t('magpieTestAndDiscover')));
    view.rerender(createElement(ProviderEditDialog, { ...props, open: false }));
    view.rerender(createElement(ProviderEditDialog, props));
    fireEvent.click(screen.getByText(i18nService.t('magpieTestAndDiscover')));
    expect(onTest).toHaveBeenCalledTimes(2);
    await act(async () =>
      finish[0]({ ok: true, latencyMs: 777, discoveredModels: ['stale-model'] }),
    );
    expect(screen.queryByText('(777ms)')).toBeNull();
    expect(screen.getByText(i18nService.t('magpieTesting'))).toBeTruthy();
    await act(async () =>
      finish[1]({ ok: true, latencyMs: 888, discoveredModels: ['fresh-model'] }),
    );
    fireEvent.click(screen.getByText(i18nService.t('magpieModelConflictReplace')));
    expect(screen.getByText('fresh-model')).toBeTruthy();
    expect(screen.queryByText('stale-model')).toBeNull();
  });
});

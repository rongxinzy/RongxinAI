// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { i18nService } from '../../../services/i18n';
import { ModelsPanel } from './ModelsPanel';

test('groups the running model first and keeps log and cancel available while another model loads', () => {
  const model = { id: 'first', name: 'first', model: 'first' };
  const running = { id: 'second', name: 'second', model: 'second' };
  const cancel = vi.fn();
  const log = vi.fn();
  render(
    <ModelsPanel
      loading
      loadingModelName={model.name}
      cancellingModelLoad={false}
      unloadingModelName={null}
      localModels={[model, running]}
      runningModels={[running]}
      modelPreferences={{}}
      onLoadModel={vi.fn()}
      onCancelModelLoad={cancel}
      onUnload={vi.fn()}
      onDelete={vi.fn()}
      onOpenLaunchLog={log}
    />,
  );
  const titles = screen.getAllByRole('heading');
  expect(titles[0]).toHaveTextContent(i18nService.t('localInferenceStatus_running'));
  expect(within(titles[0].parentElement!).getByText('second')).toBeVisible();
  const installed = within(titles[1].parentElement!);
  expect(installed.queryByText('second')).toBeNull();
  expect(installed.queryByRole('button', { name: i18nService.t('start') })).toBeNull();
  fireEvent.click(
    installed.getByRole('button', { name: i18nService.t('localInferenceModelLaunchLogAction') }),
  );
  fireEvent.click(
    installed.getByRole('button', { name: i18nService.t('localInferenceCancelModelLoad') }),
  );
  expect(log).toHaveBeenCalledWith(model);
  expect(cancel).toHaveBeenCalledWith(model.name);
});

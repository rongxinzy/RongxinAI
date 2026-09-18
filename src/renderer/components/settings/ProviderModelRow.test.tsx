// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { ProviderName } from '../../../shared/providers';
import { ProviderModelRow, type ProviderModelEntry } from './ProviderModelRow';
import { ModelConnectionStatus } from './useModelConnectionStatus';

const baseModel: ProviderModelEntry = { id: 'glm-4.5', name: 'GLM 4.5' };

const renderRow = (
  options: {
    providerId?: string;
    model?: ProviderModelEntry;
    connectionStatus?: ModelConnectionStatus;
  } = {},
) => {
  const onTestModel = vi.fn();
  const onEditModel = vi.fn();
  const onDeleteModel = vi.fn();
  const view = render(
    <ProviderModelRow
      providerId={options.providerId ?? ProviderName.Qwen}
      model={options.model ?? baseModel}
      connectionStatus={options.connectionStatus ?? ModelConnectionStatus.Unknown}
      onTestModel={onTestModel}
      onEditModel={onEditModel}
      onDeleteModel={onDeleteModel}
    />,
  );
  return { ...view, onTestModel, onEditModel, onDeleteModel };
};

test('colours the status dot from the connection status', () => {
  const failure = renderRow({ connectionStatus: ModelConnectionStatus.Failure });
  expect(failure.container.innerHTML).toContain('bg-destructive');
  failure.unmount();

  const success = renderRow({ connectionStatus: ModelConnectionStatus.Success });
  expect(success.container.innerHTML).toContain('bg-success');
  success.unmount();

  const unknown = renderRow({ connectionStatus: ModelConnectionStatus.Unknown });
  expect(unknown.container.innerHTML).toContain('bg-muted-foreground');
});

test('tests the model when the row body is activated', () => {
  const { onTestModel } = renderRow();

  fireEvent.click(screen.getByRole('button', { name: '测试连接 GLM 4.5' }));
  expect(onTestModel).toHaveBeenCalledWith(baseModel);

  fireEvent.keyDown(screen.getByRole('button', { name: '测试连接 GLM 4.5' }), { key: 'Enter' });
  expect(onTestModel).toHaveBeenCalledTimes(2);
});

test('routes the edit and delete buttons without triggering a connection test', () => {
  const { onTestModel, onEditModel, onDeleteModel } = renderRow();

  fireEvent.click(screen.getByLabelText('编辑模型 GLM 4.5'));
  fireEvent.click(screen.getByLabelText('删除 GLM 4.5'));

  expect(onEditModel).toHaveBeenCalledWith(baseModel);
  expect(onDeleteModel).toHaveBeenCalledWith(baseModel);
  expect(onTestModel).not.toHaveBeenCalled();
});

test('hides the delete action and the model id for local runtime models', () => {
  const { onEditModel } = renderRow({
    providerId: ProviderName.LlamaCpp,
    model: { id: 'qwen2.5-7b', name: 'qwen2.5-7b' },
  });

  expect(screen.queryByLabelText('删除 qwen2.5-7b')).toBeNull();

  fireEvent.click(screen.getByLabelText('编辑模型 qwen2.5-7b'));
  expect(onEditModel).toHaveBeenCalledTimes(1);
});

test('shows capability details only for custom providers', () => {
  const model: ProviderModelEntry = {
    ...baseModel,
    maxTokens: 8192,
    capabilities: { reasoning: 'supported' },
  };

  const custom = renderRow({ providerId: 'custom_0', model });
  expect(custom.container.textContent).toContain('最大输出');
  expect(custom.container.textContent).toContain('8K');
  expect(custom.container.textContent).toContain('推理');
  custom.unmount();

  const builtin = renderRow({ providerId: ProviderName.Qwen, model });
  expect(builtin.container.textContent).not.toContain('最大输出');
});

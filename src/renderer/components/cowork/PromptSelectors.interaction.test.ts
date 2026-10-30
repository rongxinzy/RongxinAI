// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState } from 'react';
import { beforeAll, expect, test, vi } from 'vitest';

import { CoworkPermissionMode } from '../../../shared/cowork/constants';
import { toCatalogModel } from '../../services/availableModels';
import { CoworkModelPicker } from './CoworkModelPicker';
import PermissionModeMenu from './PermissionModeMenu';

vi.mock('../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
vi.mock('../../providers/uiRegistry', () => ({ ProviderIcon: () => null }));
beforeAll(() => {
  Element.prototype.scrollIntoView ??= vi.fn();
});
const models = [
  { id: 'first', name: 'A long model name for the task', providerKey: 'openai' },
  { id: 'second', name: 'Other model', providerKey: 'anthropic' },
];

test('preserves provider search, selection, close/reset and keyboard focus in compact mode', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  function Picker() {
    const [open, setOpen] = useState(false);
    return createElement(CoworkModelPicker, {
      models,
      selectedModel: models[0],
      open,
      onOpenChange: setOpen,
      onSelect,
      compact: true,
    });
  }
  render(createElement(Picker));
  const trigger = screen.getByRole('button', { name: models[0].name });
  await user.click(trigger);
  await user.type(screen.getByPlaceholderText('searchModels'), 'anthropic');
  expect(screen.queryByRole('option', { name: models[0].name })).toBeNull();
  await user.click(screen.getByRole('option', { name: models[1].name }));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(models[1]);
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.keyboard('{Enter}');
  expect(screen.getByPlaceholderText('searchModels')).toHaveValue('');
  expect(screen.getByRole('option', { name: models[0].name })).toBeTruthy();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(trigger).toHaveFocus());
});

test('keeps an accessible empty model trigger and empty menu state', async () => {
  const user = userEvent.setup();
  function Picker() {
    const [open, setOpen] = useState(false);
    return createElement(CoworkModelPicker, {
      models: [],
      selectedModel: models[0],
      open,
      onOpenChange: setOpen,
      onSelect: vi.fn(),
      compact: true,
    });
  }
  render(createElement(Picker));
  await user.click(screen.getByRole('button', { name: 'selectModel' }));
  expect(screen.getByRole('option', { name: 'modelSelectorNone' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('searches and announces the supplier name while selecting the unchanged catalog identity', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const model = toCatalogModel(
    { id: 'exact-model-id', display_name: 'GLM-5.3-Flash', owned_by: 'provider-generated-id' },
    [
      {
        id: 'provider-generated-id',
        name: 'Zhipu GLM',
        api: 'openai-completions',
        baseUrl: 'https://example.com/v1',
        models: ['GLM-5.3-Flash'],
        off: false,
        hasKey: true,
      },
    ],
  );
  render(
    createElement(CoworkModelPicker, {
      models: [model],
      selectedModel: model,
      open: true,
      onOpenChange: vi.fn(),
      onSelect,
    }),
  );
  const search = screen.getByPlaceholderText('searchModels');
  await user.type(search, 'zhipu');
  const option = screen.getByRole('option', { name: model.name });
  expect(option).toHaveTextContent('Zhipu GLM');
  expect(option).toHaveAttribute('aria-description', 'Zhipu GLM, currentModel');
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      id: 'exact-model-id',
      providerKey: 'provider-generated-id',
    }),
  );
});

test.each([false, true])(
  'preserves permission selection and disabled behavior (compact=%s)',
  async compact => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const props = { value: CoworkPermissionMode.Ask, onChange, compact };
    const view = render(createElement(PermissionModeMenu, props));
    const trigger = screen.getByRole('button', { name: 'permissionModeAsk' });
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitemradio', { name: /permissionModeAllowAll/ }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(CoworkPermissionMode.AllowAll);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
    view.rerender(createElement(PermissionModeMenu, { ...props, disabled: true }));
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  },
);

test('distinguishes identical model names with unique catalog IDs using keyboard selection', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const duplicates = [
    { id: 'openai/shared', name: 'Same model', providerKey: 'openai', provider: 'OpenAI' },
    { id: 'anthropic/shared', name: 'Same model', providerKey: 'anthropic', provider: 'Anthropic' },
  ];
  function Picker() {
    const [open, setOpen] = useState(false);
    return createElement(CoworkModelPicker, {
      models: duplicates,
      selectedModel: duplicates[1],
      open,
      onOpenChange: setOpen,
      onSelect,
    });
  }
  render(createElement(Picker));
  await user.click(screen.getByRole('button', { name: 'Same model' }));
  const options = screen.getAllByRole('option', { name: 'Same model' });
  expect(options[0]).toHaveAttribute('aria-description', 'OpenAI');
  expect(options[1]).toHaveAttribute('aria-description', 'Anthropic, currentModel');
  expect(options[0].getAttribute('data-value')).not.toBe(options[1].getAttribute('data-value'));
  await user.click(screen.getByRole('combobox', { name: 'searchModels' }));
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(duplicates[1]);
});

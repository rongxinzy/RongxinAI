// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import type { MagpieProviderSummary } from '../../../../shared/magpie/types';
import { ModelCatalogBrowser } from './ModelCatalogBrowser';

vi.mock('../../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
afterEach(cleanup);

const provider: MagpieProviderSummary = {
  id: 'provider-internal-id',
  name: 'Zhipu GLM',
  api: 'openai-completions',
  baseUrl: 'https://example.com/v1',
  models: ['GLM-5.3-Flash'],
  off: false,
  hasKey: true,
};

test('supplier names appear in rows and details and are searchable without altering selection ids', () => {
  const model = { id: 'GLM-5.3-Flash', owned_by: provider.id };
  const props = {
    models: [model],
    providers: [provider],
    defaultModelId: model.id,
    selection: model.id,
    disabled: false,
    onSelect: vi.fn(),
  };
  const view = render(createElement(ModelCatalogBrowser, props));
  const row = within(screen.getByRole('listitem'));
  expect(row.getByText(`modelBrowseSource: ${provider.name}`)).toBeTruthy();
  const details = within(screen.getByRole('region', { name: 'modelBrowseSelection' }));
  expect(details.getByText(provider.name)).toBeTruthy();
  expect(screen.queryByText(provider.id)).toBeNull();

  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: 'zhipu' } });
  fireEvent.click(screen.getByRole('button', { name: `modelBrowseSelect ${model.id}` }));
  expect(props.onSelect).toHaveBeenCalledExactlyOnceWith(model.id);
  fireEvent.change(search, { target: { value: provider.id } });
  expect(screen.getAllByRole('listitem')).toHaveLength(1);

  view.rerender(
    createElement(ModelCatalogBrowser, {
      ...props,
      providers: [{ ...provider, name: 'Renamed supplier' }],
    }),
  );
  expect(details.getByText('Renamed supplier')).toBeTruthy();
  fireEvent.change(search, { target: { value: 'Renamed' } });
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(props.onSelect).toHaveBeenCalledTimes(1);
});

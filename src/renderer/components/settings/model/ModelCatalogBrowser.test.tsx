// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ModelCatalogBrowser } from './ModelCatalogBrowser';
import type { MagpieModel } from '../../../../shared/magpie/types';

vi.mock('../../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
afterEach(cleanup);
const models: MagpieModel[] = Array.from({ length: 23 }, (_, index) => ({
  id: `provider/${index}`,
  display_name: `Model ${index}`,
  owned_by: index === 22 ? 'Local GPU' : 'Remote',
}));

test('bounds the directory, searches name/id/source and only explicitly selects exact ids', async () => {
  const onSelect = vi.fn();
  render(
    <ModelCatalogBrowser
      models={models}
      defaultModelId="provider/0"
      selection="provider/0"
      disabled={false}
      onSelect={onSelect}
    />,
  );
  expect(screen.getAllByRole('listitem')).toHaveLength(10);
  fireEvent.click(screen.getByRole('button', { name: 'modelBrowseNext' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(10);
  expect(screen.getByRole('button', { name: 'modelBrowseSelect provider/10' })).toBeTruthy();
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: 'LOCAL gpu' } });
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(onSelect).not.toHaveBeenCalled();
  const select = screen.getByRole('button', { name: 'modelBrowseSelect provider/22' });
  select.focus();
  await userEvent.keyboard('{Enter}');
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('provider/22');
  fireEvent.change(search, { target: { value: 'provider/3' } });
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  fireEvent.change(search, { target: { value: 'Model 21' } });
  expect(screen.getByRole('button', { name: 'modelBrowseSelect provider/21' })).toBeTruthy();
  fireEvent.change(search, { target: { value: 'missing' } });
  expect(screen.getByText('modelBrowseNoMatches')).toBeTruthy();
  expect(screen.getByRole('region', { name: 'modelBrowseSelection' }).textContent).toContain(
    'provider/0',
  );
});

test('shows only real metadata, keeps false distinct from unknown and never calls a connection test', () => {
  const model: MagpieModel = {
    id: 'local/model',
    owned_by: 'Local GPU',
    context_window: 32768,
    max_output_tokens: 2048,
    reasoning: false,
    modalities: { input: ['text', 'image'], output: ['text'] },
    native_endpoints: ['openai'],
  };
  const view = render(
    <ModelCatalogBrowser
      models={[model]}
      defaultModelId={null}
      selection={model.id}
      disabled={false}
      onSelect={vi.fn()}
    />,
  );
  const region = within(screen.getByRole('region', { name: 'modelBrowseSelection' }));
  expect(region.getByText('32768')).toBeTruthy();
  expect(region.getByText('2048')).toBeTruthy();
  expect(region.getByText('text · image')).toBeTruthy();
  expect(region.getByText('modelBrowseUnsupported')).toBeTruthy();
  expect(region.getByText('modelBrowseUnsaved')).toBeTruthy();
  expect(screen.getByText('modelBrowseConnectionHint')).toBeTruthy();
  view.rerender(
    <ModelCatalogBrowser
      models={[{ id: model.id }]}
      defaultModelId={null}
      selection={model.id}
      disabled={false}
      onSelect={vi.fn()}
    />,
  );
  expect(region.queryByText('modelBrowseUnsupported')).toBeNull();
  expect(region.getAllByText('modelBrowseUnknown')).toHaveLength(8);
});

test('clamps a shrinking page and exposes a missing saved model without choosing another', () => {
  const onSelect = vi.fn();
  const view = render(
    <ModelCatalogBrowser
      models={models}
      defaultModelId="gone"
      selection="gone"
      disabled={false}
      onSelect={onSelect}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'modelBrowseNext' }));
  fireEvent.click(screen.getByRole('button', { name: 'modelBrowseNext' }));
  view.rerender(
    <ModelCatalogBrowser
      models={models.slice(0, 1)}
      defaultModelId="gone"
      selection="gone"
      disabled
      onSelect={onSelect}
    />,
  );
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(screen.getByText('modelBrowseMissingDefault')).toBeTruthy();
  expect(screen.queryByRole('region')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'modelBrowseSelect provider/0' }));
  expect(onSelect).not.toHaveBeenCalled();
});

test('keeps long identities readable and the active draft stable across theme changes', () => {
  const longId = `provider/${'long-name-'.repeat(100)}`;
  const model = { id: longId, display_name: '名称'.repeat(100) };
  const props = {
    models: [model],
    defaultModelId: null,
    selection: longId,
    disabled: false,
    onSelect: vi.fn(),
  };
  const view = render(<ModelCatalogBrowser {...props} />);
  const search = screen.getByRole('searchbox');
  fireEvent.change(search, { target: { value: 'long-name' } });
  search.focus();
  document.documentElement.classList.add('dark');
  view.rerender(<ModelCatalogBrowser {...props} />);
  expect(screen.getByRole('searchbox')).toBe(search);
  expect(document.activeElement).toBe(search);
  expect((search as HTMLInputElement).value).toBe('long-name');
  const region = screen.getByRole('region', { name: 'modelBrowseSelection' });
  expect(within(region).getByText(longId).className).toContain('break-all');
  expect(region.className).toContain('min-w-0');
  expect(view.container.querySelector('[class*="animate-"]')).toBeNull();
  expect(props.onSelect).not.toHaveBeenCalled();
  document.documentElement.classList.remove('dark');
});

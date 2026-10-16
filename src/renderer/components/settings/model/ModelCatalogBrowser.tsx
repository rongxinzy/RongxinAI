import { useId, useMemo, useState } from 'react';
import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Field, FieldLabel } from '@shared/components/ui/field';
import type { MagpieModel } from '../../../../shared/magpie/types';
import { i18nService } from '../../../services/i18n';

const PAGE_SIZE = 10;

function ModelCapabilities({ model }: { model: MagpieModel }) {
  const unknown = i18nService.t('modelBrowseUnknown');
  const number = (value?: number) =>
    value !== undefined && Number.isFinite(value) && value > 0 ? String(value) : unknown;
  const fields = [
    ['modelBrowseSource', model.owned_by || unknown],
    ['modelBrowseContext', number(model.context_window)],
    ['modelBrowseOutputLimit', number(model.max_output_tokens)],
    ['modelBrowseInput', model.modalities?.input.join(' · ') || unknown],
    ['modelBrowseOutput', model.modalities?.output.join(' · ') || unknown],
    [
      'modelBrowseReasoning',
      model.reasoning === undefined
        ? unknown
        : i18nService.t(model.reasoning ? 'modelBrowseSupported' : 'modelBrowseUnsupported'),
    ],
    ['modelBrowseProtocol', model.native_endpoints?.join(' · ') || unknown],
    [
      'modelBrowseReasoningLevels',
      model.supported_reasoning_levels?.map(level => level.effort).join(' · ') || unknown,
    ],
  ];
  return (
    <dl className="grid min-w-0 grid-cols-1 gap-2 text-sm sm:grid-cols-2">
      {fields.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-muted-foreground">{i18nService.t(label)}</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ModelCatalogBrowser({
  models,
  defaultModelId,
  selection,
  disabled,
  onSelect,
}: {
  models: MagpieModel[];
  defaultModelId: string | null;
  selection: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return models.filter(model =>
      [model.id, model.display_name, model.owned_by]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [models, query]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const saved = models.find(model => model.id === defaultModelId);
  const selected = models.find(model => model.id === selection);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2 text-sm">
        <p className="break-all">
          {i18nService.t('modelBrowseSaved')}:{' '}
          {saved?.display_name || saved?.id || i18nService.t('magpieModelUnset')}
        </p>
        {saved?.display_name && <p className="break-all text-muted-foreground">{saved.id}</p>}
        {defaultModelId && !saved && (
          <p role="status">{i18nService.t('modelBrowseMissingDefault')}</p>
        )}
        {selected && (
          <section
            aria-label={i18nService.t('modelBrowseSelection')}
            className="flex min-w-0 flex-col gap-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 break-all font-medium">
                {selected.display_name || selected.id}
              </p>
              <Badge variant="outline">
                {i18nService.t(
                  selection === defaultModelId ? 'modelBrowseSaved' : 'modelBrowseUnsaved',
                )}
              </Badge>
            </div>
            <p className="break-all text-muted-foreground">{selected.id}</p>
            <ModelCapabilities model={selected} />
          </section>
        )}
      </div>
      <Field>
        <FieldLabel htmlFor={searchId}>{i18nService.t('modelBrowseSearch')}</FieldLabel>
        <Input
          id={searchId}
          type="search"
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            setPage(0);
          }}
          placeholder={i18nService.t('modelBrowseSearchHint')}
        />
      </Field>
      <p className="text-sm text-muted-foreground">{i18nService.t('modelBrowseConnectionHint')}</p>
      <p role="status" className="text-sm text-muted-foreground">
        {i18nService.t('modelBrowseMatches')}: {filtered.length}
      </p>
      {query && !filtered.length && (
        <p className="text-sm">{i18nService.t('modelBrowseNoMatches')}</p>
      )}
      <ul className="divide-y divide-border">
        {visible.map(model => (
          <li
            key={model.id}
            className="flex min-w-0 flex-wrap items-start justify-between gap-3 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="break-all text-sm font-medium">{model.display_name || model.id}</p>
              <p className="break-all text-sm text-muted-foreground">{model.id}</p>
              <p className="break-all text-sm text-muted-foreground">
                {i18nService.t('modelBrowseSource')}:{' '}
                {model.owned_by || i18nService.t('modelBrowseUnknown')}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              aria-pressed={selection === model.id}
              aria-label={`${i18nService.t('modelBrowseSelect')} ${model.id}`}
              onClick={() => onSelect(model.id)}
            >
              {i18nService.t(selection === model.id ? 'modelBrowseSelected' : 'modelBrowseSelect')}
            </Button>
          </li>
        ))}
      </ul>
      {filtered.length > PAGE_SIZE && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            {i18nService.t('modelBrowsePrevious')}
          </Button>
          <span className="text-sm">
            {currentPage + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length}
            onClick={() => setPage(currentPage + 1)}
          >
            {i18nService.t('modelBrowseNext')}
          </Button>
        </div>
      )}
    </div>
  );
}

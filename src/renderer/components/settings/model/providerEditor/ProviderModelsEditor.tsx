import { Button } from '@shared/components/ui/button';
import { Field, FieldDescription, FieldLabel, FieldTitle } from '@shared/components/ui/field';
import { Input } from '@shared/components/ui/input';
import { Separator } from '@shared/components/ui/separator';
import { Textarea } from '@shared/components/ui/textarea';
import { ArrowRightLeft, Plus, RotateCcw, Star, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { i18nService } from '../../../../services/i18n';
import { PROVIDER_MODEL_PAGE_SIZE, ProviderModelView, parseProviderModels } from './constants';
import type { ProviderEditor } from './useProviderEditor';

export function ProviderModelsEditor({ editor }: { editor: ProviderEditor }) {
  const id = useId();
  const addRef = useRef<HTMLInputElement>(null);
  const removeRefs = useRef(new Map<string, HTMLElement>());
  const [page, setPage] = useState(0);
  const { draft, isSaving, modelView } = editor;
  const textMode = modelView === ProviderModelView.Text;
  const pageCount = Math.max(1, Math.ceil(draft.models.length / PROVIDER_MODEL_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = draft.models.slice(
    currentPage * PROVIDER_MODEL_PAGE_SIZE,
    (currentPage + 1) * PROVIDER_MODEL_PAGE_SIZE,
  );
  const fallbacks = new Set(parseProviderModels(draft.fallbackText));
  return (
    <>
      <Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FieldLabel htmlFor={`${id}-${textMode ? 'text' : 'add'}`}>
            {i18nService.t('magpieProviderModels')}
          </FieldLabel>
          <Button
            type="button"
            variant="ghost"
            disabled={isSaving}
            onClick={() =>
              editor.setModelView(textMode ? ProviderModelView.List : ProviderModelView.Text)
            }
          >
            <ArrowRightLeft className="size-4" aria-hidden="true" />
            {i18nService.t(textMode ? 'magpieModelModeChips' : 'magpieModelModeText')}
          </Button>
        </div>
        {textMode ? (
          <>
            <Textarea
              id={`${id}-text`}
              value={draft.modelsText}
              autoGrow={false}
              rows={4}
              spellCheck={false}
              onChange={event => editor.textChanged(event.target.value)}
              placeholder={i18nService.t('magpieProviderModelsHint')}
              disabled={isSaving}
            />
            <FieldDescription>{i18nService.t('magpieProviderModelsHint')}</FieldDescription>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Input
                ref={addRef}
                id={`${id}-add`}
                value={editor.newModelName}
                spellCheck={false}
                placeholder={i18nService.t('magpieModelAddPlaceholder')}
                disabled={isSaving}
                onChange={event => editor.setNewModelName(event.target.value)}
                onKeyDown={event => {
                  if (
                    event.key === 'Enter' &&
                    !event.nativeEvent.isComposing &&
                    event.nativeEvent.keyCode !== 229
                  ) {
                    event.preventDefault();
                    editor.addModel();
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={isSaving || !editor.newModelName.trim()}
                onClick={editor.addModel}
              >
                <Plus className="size-4" aria-hidden="true" />
                {i18nService.t('magpieModelAdd')}
              </Button>
            </div>
            {draft.models.length > 0 && (
              <ul
                className="flex flex-col gap-2"
                aria-label={i18nService.t('magpieProviderModels')}
              >
                {visible.map((model, index) => {
                  const preferred = draft.models[0] === model;
                  const fallback = fallbacks.has(model);
                  return (
                    <li key={model} className="flex flex-col gap-2" data-provider-model={model}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <FieldTitle className="min-w-0 break-all">{model}</FieldTitle>
                          {(preferred || fallback) && (
                            <FieldDescription>
                              {[
                                preferred ? i18nService.t('magpieModelPrimary') : null,
                                fallback ? i18nService.t('magpieModelFallback') : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </FieldDescription>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant={preferred ? 'secondary' : 'ghost'}
                            size="icon"
                            aria-pressed={preferred}
                            disabled={isSaving}
                            aria-label={`${i18nService.t('magpieModelSetAsPrimary')}: ${model}`}
                            title={i18nService.t('magpieModelSetAsPrimary')}
                            onClick={() => {
                              if (!preferred) editor.preferModel(model);
                              setPage(0);
                            }}
                          >
                            <Star className="size-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant={fallback ? 'secondary' : 'ghost'}
                            size="icon"
                            aria-pressed={fallback}
                            disabled={isSaving}
                            aria-label={`${i18nService.t('magpieModelSetAsFallback')}: ${model}`}
                            title={i18nService.t('magpieModelSetAsFallback')}
                            onClick={() => editor.toggleFallback(model)}
                          >
                            <RotateCcw className="size-4" aria-hidden="true" />
                          </Button>
                          <Button
                            ref={element => {
                              if (element) removeRefs.current.set(model, element);
                              else removeRefs.current.delete(model);
                            }}
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={isSaving}
                            aria-label={`${i18nService.t('magpieModelRemove')}: ${model}`}
                            title={i18nService.t('magpieModelRemove')}
                            onClick={() => {
                              const next = visible[index + 1] ?? visible[index - 1];
                              (removeRefs.current.get(next) ?? addRef.current)?.focus();
                              editor.removeModel(model);
                              setPage(
                                Math.min(
                                  currentPage,
                                  Math.max(
                                    0,
                                    Math.ceil(
                                      (draft.models.length - 1) / PROVIDER_MODEL_PAGE_SIZE,
                                    ) - 1,
                                  ),
                                ),
                              );
                            }}
                          >
                            <X className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                      <Separator />
                    </li>
                  );
                })}
              </ul>
            )}
            {pageCount > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isSaving || currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  {i18nService.t('modelBrowsePrevious')}
                </Button>
                <FieldDescription role="status">
                  {currentPage + 1} / {pageCount}
                </FieldDescription>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isSaving || currentPage === pageCount - 1}
                  onClick={() => setPage(currentPage + 1)}
                >
                  {i18nService.t('modelBrowseNext')}
                </Button>
              </div>
            )}
          </>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-fallback`}>
          {i18nService.t('magpieProviderFallback')}
        </FieldLabel>
        <Textarea
          id={`${id}-fallback`}
          value={draft.fallbackText}
          autoGrow={false}
          rows={2}
          spellCheck={false}
          disabled={isSaving}
          onChange={event => editor.edit({ fallbackText: event.target.value })}
          placeholder={i18nService.t('magpieProviderFallbackPlaceholder')}
          aria-describedby={`${id}-fallback-hint`}
        />
        <FieldDescription id={`${id}-fallback-hint`}>
          {i18nService.t('magpieProviderFallbackHint')}
        </FieldDescription>
      </Field>
    </>
  );
}

import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@shared/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Plus, X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { i18nService } from '../../../services/i18n';
import type { ParsedContext } from './modelContextValue';

interface ProviderContextFieldsProps {
  contextDefault: string;
  contextDefaultParsed: ParsedContext;
  contextRows: { id: string; parsed: ParsedContext }[];
  contextCandidates: string[];
  contextOverrides: Record<string, string>;
  pendingContextModel: string;
  isSaving: boolean;
  setContextsTouched: (value: boolean) => void;
  setContextDefault: (value: string) => void;
  setContextOverrides: Dispatch<SetStateAction<Record<string, string>>>;
  setPendingContextModel: (value: string) => void;
}

export function ProviderContextFields({
  contextDefault,
  contextDefaultParsed,
  contextRows,
  contextCandidates,
  contextOverrides,
  pendingContextModel,
  isSaving,
  setContextsTouched,
  setContextDefault,
  setContextOverrides,
  setPendingContextModel,
}: ProviderContextFieldsProps) {
  return (
    <FieldGroup className="gap-2">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor="provider-context-default">
          {i18nService.t('magpieProviderContext')}
        </FieldLabel>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1"
          onClick={() => {
            setContextsTouched(true);
            setContextDefault('');
            setContextOverrides({});
          }}
          disabled={isSaving}
        >
          {i18nService.t('magpieProviderContextReset')}
        </Button>
      </div>
      <Field data-invalid={!contextDefaultParsed.ok || undefined} className="gap-1.5">
        <Input
          id="provider-context-default"
          value={contextDefault}
          onChange={event => {
            setContextsTouched(true);
            setContextDefault(event.target.value);
          }}
          placeholder={i18nService.t('magpieProviderContextPlaceholder')}
          aria-invalid={!contextDefaultParsed.ok}
          disabled={isSaving}
        />
        {contextDefaultParsed.ok ? (
          <FieldDescription>
            {contextDefaultParsed.value !== undefined
              ? i18nService
                  .t('magpieProviderContextParsed')
                  .replace('{tokens}', String(contextDefaultParsed.value))
              : i18nService.t('magpieProviderContextHint')}
          </FieldDescription>
        ) : (
          <FieldError>{i18nService.t('magpieProviderContextInvalid')}</FieldError>
        )}
      </Field>
      {contextRows.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <FieldDescription>{i18nService.t('magpieProviderContextOverridesHint')}</FieldDescription>
          {contextRows.map(row => (
            <div key={row.id} className="flex flex-col gap-1">
              <Field
                orientation="horizontal"
                data-invalid={!row.parsed.ok || undefined}
                className="gap-2"
              >
                <FieldLabel
                  htmlFor={`provider-context-model-${row.id}`}
                  className="min-w-0 flex-1 truncate"
                >
                  {row.id}
                </FieldLabel>
                <Input
                  id={`provider-context-model-${row.id}`}
                  value={contextOverrides[row.id] ?? ''}
                  onChange={event => {
                    setContextsTouched(true);
                    setContextOverrides(previous => ({
                      ...previous,
                      [row.id]: event.target.value,
                    }));
                  }}
                  placeholder={i18nService.t('magpieProviderContextInherit')}
                  aria-invalid={!row.parsed.ok}
                  disabled={isSaving}
                  className="w-32"
                />
                <FieldDescription className="w-16 text-right">
                  {row.parsed.ok ? (row.parsed.value ?? '') : ''}
                </FieldDescription>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title={i18nService.t('magpieProviderContextRemove')}
                  aria-label={i18nService.t('magpieProviderContextRemove')}
                  disabled={isSaving}
                  onClick={() => {
                    setContextsTouched(true);
                    setContextOverrides(previous => {
                      const next = { ...previous };
                      delete next[row.id];
                      return next;
                    });
                  }}
                >
                  <X className="theme-composition-button-icon" />
                </Button>
              </Field>
              {!row.parsed.ok && (
                <FieldError>{i18nService.t('magpieProviderContextInvalid')}</FieldError>
              )}
            </div>
          ))}
        </div>
      )}
      {contextCandidates.length > 0 && (
        <div className="flex items-center gap-2">
          <Select
            items={Object.fromEntries(contextCandidates.map(modelId => [modelId, modelId]))}
            disabled={isSaving}
            value={pendingContextModel}
            onValueChange={value => setPendingContextModel(String(value ?? ''))}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder={i18nService.t('magpieProviderContextChoose')} />
            </SelectTrigger>
            <SelectContent>
              {contextCandidates.map(modelId => (
                <SelectItem key={modelId} value={modelId}>
                  {modelId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1"
            disabled={!pendingContextModel || isSaving}
            onClick={() => {
              setContextsTouched(true);
              setContextOverrides(previous => ({
                ...previous,
                [pendingContextModel]: '',
              }));
              setPendingContextModel('');
            }}
          >
            <Plus className="theme-composition-button-icon" />
            {i18nService.t('magpieProviderContextAdd')}
          </Button>
        </div>
      )}
    </FieldGroup>
  );
}

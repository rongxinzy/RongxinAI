import { Field, FieldDescription, FieldError, FieldLabel } from '@shared/components/ui/field';
import { Input } from '@shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { useId, type RefObject } from 'react';
import { i18nService } from '../../../../services/i18n';
import { PRESET_KEYS, PRESETS, type PresetKey } from '../providerPresets';
import { ProviderProtocol } from './constants';
import type { ProviderEditor } from './useProviderEditor';

export function ProviderConnectionFields({
  editor,
  nameRef,
}: {
  editor: ProviderEditor;
  nameRef: RefObject<HTMLInputElement | null>;
}) {
  const id = useId();
  const { draft, isSaving } = editor;
  const protocolItems = {
    [ProviderProtocol.Chat]: i18nService.t('magpieProviderApiOpenAIChat'),
    [ProviderProtocol.Messages]: i18nService.t('magpieProviderApiAnthropicMessages'),
    [ProviderProtocol.Responses]: i18nService.t('magpieProviderApiOpenAIResponses'),
  };
  const keyHint =
    editor.isEditing && editor.hasKey && editor.maskedKey
      ? i18nService.t('magpieProviderKeyMasked').replace('{masked}', editor.maskedKey)
      : !editor.isLocal && !draft.apiKey.trim()
        ? i18nService.t('magpieTestNeedKeyHint')
        : null;
  return (
    <>
      {!editor.isEditing && (
        <Field>
          <FieldLabel htmlFor={`${id}-preset`}>{i18nService.t('magpieProviderPreset')}</FieldLabel>
          <Select
            items={Object.fromEntries(
              PRESET_KEYS.map(key => [key, i18nService.t(PRESETS[key].labelKey)]),
            )}
            value={editor.preset}
            onValueChange={value => {
              if (value) editor.applyPreset(value as PresetKey);
            }}
            disabled={isSaving}
          >
            <SelectTrigger id={`${id}-preset`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESET_KEYS.map(key => (
                <SelectItem key={key} value={key}>
                  <span className="min-w-0 whitespace-normal break-words">
                    {i18nService.t(PRESETS[key].labelKey)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor={`${id}-name`}>{i18nService.t('magpieProviderName')}</FieldLabel>
        <Input
          ref={nameRef}
          id={`${id}-name`}
          value={draft.name}
          onChange={event => editor.edit({ name: event.target.value })}
          placeholder={i18nService.t('magpieProviderNamePlaceholder')}
          autoComplete="off"
          required
          disabled={isSaving}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-protocol`}>{i18nService.t('magpieProviderApi')}</FieldLabel>
        <Select
          items={protocolItems}
          value={draft.api}
          disabled={isSaving}
          onValueChange={value => {
            if (value) editor.edit({ api: value as typeof draft.api });
          }}
        >
          <SelectTrigger id={`${id}-protocol`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(protocolItems).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field data-invalid={editor.invalidUrl || undefined}>
        <FieldLabel htmlFor={`${id}-url`}>{i18nService.t('magpieProviderBaseUrl')}</FieldLabel>
        <Input
          id={`${id}-url`}
          type="url"
          value={draft.baseUrl}
          onChange={event => {
            editor.edit({ baseUrl: event.target.value });
            editor.setInvalidUrl(false);
          }}
          onBlur={event =>
            editor.setInvalidUrl(Boolean(event.target.value && !event.target.validity.valid))
          }
          onInvalid={() => editor.setInvalidUrl(true)}
          aria-invalid={editor.invalidUrl || undefined}
          aria-describedby={editor.invalidUrl ? `${id}-url-error` : undefined}
          placeholder="https://api.openai.com/v1"
          autoComplete="off"
          spellCheck={false}
          required
          disabled={isSaving}
        />
        {editor.invalidUrl && (
          <FieldError id={`${id}-url-error`}>
            {i18nService.t('magpieProviderInvalidUrl')}
          </FieldError>
        )}
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-key`}>{i18nService.t('magpieProviderKey')}</FieldLabel>
        <Input
          id={`${id}-key`}
          type="password"
          value={draft.apiKey}
          onChange={event => editor.edit({ apiKey: event.target.value })}
          placeholder={i18nService.t(
            editor.isEditing ? 'magpieProviderKeyKeepExisting' : 'magpieProviderKeyPlaceholder',
          )}
          autoComplete="new-password"
          spellCheck={false}
          disabled={isSaving}
          aria-describedby={keyHint ? `${id}-key-hint` : undefined}
        />
        {keyHint && <FieldDescription id={`${id}-key-hint`}>{keyHint}</FieldDescription>}
      </Field>
    </>
  );
}

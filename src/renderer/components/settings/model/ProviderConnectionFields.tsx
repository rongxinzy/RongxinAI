import { Input } from '@shared/components/ui/input';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@shared/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { i18nService } from '../../../services/i18n';
import type { MagpieProviderApi, MagpieProviderSummary } from '../../../../shared/magpie/types';
import { PRESET_KEYS, PRESETS, type PresetKey } from './providerPresets';

interface ProviderConnectionFieldsProps {
  isEditing: boolean;
  provider?: MagpieProviderSummary | null;
  preset: PresetKey;
  name: string;
  api: MagpieProviderApi;
  baseUrl: string;
  apiKey: string;
  isSaving: boolean;
  isLocalProvider: boolean;
  editVersionRef: { current: number };
  setName: (value: string) => void;
  setApi: (value: MagpieProviderApi) => void;
  setBaseUrl: (value: string) => void;
  setApiKey: (value: string) => void;
  handleApplyPreset: (key: PresetKey) => void;
}

export function ProviderConnectionFields({
  isEditing,
  provider,
  preset,
  name,
  api,
  baseUrl,
  apiKey,
  isSaving,
  isLocalProvider,
  editVersionRef,
  setName,
  setApi,
  setBaseUrl,
  setApiKey,
  handleApplyPreset,
}: ProviderConnectionFieldsProps) {
  return (
    <FieldGroup className="gap-4">
      {!isEditing && (
        <Field>
          <FieldLabel htmlFor="provider-preset">{i18nService.t('magpieProviderPreset')}</FieldLabel>
          <Select
            items={Object.fromEntries(
              PRESET_KEYS.map(key => [key, i18nService.t(PRESETS[key].labelKey)]),
            )}
            value={preset}
            onValueChange={val => handleApplyPreset(val as PresetKey)}
          >
            <SelectTrigger id="provider-preset" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESET_KEYS.map(key => (
                <SelectItem key={key} value={key}>
                  {i18nService.t(PRESETS[key].labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="provider-name">{i18nService.t('magpieProviderName')}</FieldLabel>
          <Input
            id="provider-name"
            value={name}
            onChange={e => {
              editVersionRef.current += 1;
              setName(e.target.value);
            }}
            placeholder={i18nService.t('magpieProviderNamePlaceholder')}
            required
            disabled={isSaving}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="provider-api">{i18nService.t('magpieProviderApi')}</FieldLabel>
          <Select
            value={api}
            onValueChange={val => {
              editVersionRef.current += 1;
              setApi(val as MagpieProviderApi);
            }}
          >
            <SelectTrigger id="provider-api" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai-completions">
                {i18nService.t('magpieProviderApiOpenAIChat')}
              </SelectItem>
              <SelectItem value="anthropic-messages">
                {i18nService.t('magpieProviderApiAnthropicMessages')}
              </SelectItem>
              <SelectItem value="openai-responses">
                {i18nService.t('magpieProviderApiOpenAIResponses')}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="provider-url">{i18nService.t('magpieProviderBaseUrl')}</FieldLabel>
        <Input
          id="provider-url"
          type="url"
          value={baseUrl}
          onChange={e => {
            editVersionRef.current += 1;
            setBaseUrl(e.target.value);
          }}
          placeholder="https://api.openai.com/v1"
          required
          disabled={isSaving}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="provider-key">{i18nService.t('magpieProviderKey')}</FieldLabel>
        <Input
          id="provider-key"
          type="password"
          value={apiKey}
          onChange={e => {
            editVersionRef.current += 1;
            setApiKey(e.target.value);
          }}
          placeholder={
            isEditing
              ? i18nService.t('magpieProviderKeyKeepExisting')
              : i18nService.t('magpieProviderKeyPlaceholder')
          }
          disabled={isSaving}
        />
        <FieldDescription className="flex flex-wrap items-center justify-between gap-1">
          {isEditing && provider?.hasKey && provider.keyMasked ? (
            <span>
              {i18nService.t('magpieProviderKeyMasked').replace('{masked}', provider.keyMasked)}
            </span>
          ) : !isLocalProvider && !apiKey.trim() ? (
            <span>{i18nService.t('magpieTestNeedKeyHint')}</span>
          ) : (
            <span />
          )}
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}

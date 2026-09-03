import { Checkbox } from '@shared/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible';
import { Field, FieldGroup, FieldLabel, FieldSet } from '@shared/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import {
  normalizeProviderModelPiRuntimeConfig,
  ProviderModelPiApi,
  ProviderModelPiCacheControlFormat,
  ProviderModelPiMaxTokensField,
  ProviderModelPiThinkingFormat,
  type ProviderModelPiRuntimeCompat,
  type ProviderModelPiRuntimeConfig,
} from '../../../shared/providers';
import { i18nService } from '../../services/i18n';
import { ChevronDown } from 'lucide-react';

const PiRuntimeSelectValue = {
  Auto: 'auto',
  Enabled: 'enabled',
  Disabled: 'disabled',
} as const;

type PiRuntimeSelectValue = (typeof PiRuntimeSelectValue)[keyof typeof PiRuntimeSelectValue];

type CompatBooleanKey = Exclude<
  {
    [Key in keyof ProviderModelPiRuntimeCompat]: ProviderModelPiRuntimeCompat[Key] extends
      | boolean
      | undefined
      ? Key
      : never;
  }[keyof ProviderModelPiRuntimeCompat],
  undefined
>;

const PI_API_OPTIONS = [
  { value: ProviderModelPiApi.OpenAICompletions, labelKey: 'piRuntimeApiOpenAICompletions' },
  { value: ProviderModelPiApi.OpenAIResponses, labelKey: 'piRuntimeApiOpenAIResponses' },
  { value: ProviderModelPiApi.AnthropicMessages, labelKey: 'piRuntimeApiAnthropicMessages' },
] as const;

const COMPAT_BOOLEAN_FIELDS = [
  { key: 'supportsDeveloperRole', labelKey: 'piRuntimeCompatSupportsDeveloperRole' },
  { key: 'supportsReasoningEffort', labelKey: 'piRuntimeCompatSupportsReasoningEffort' },
  { key: 'supportsUsageInStreaming', labelKey: 'piRuntimeCompatSupportsUsageInStreaming' },
  { key: 'supportsStrictMode', labelKey: 'piRuntimeCompatSupportsStrictMode' },
  { key: 'requiresToolResultName', labelKey: 'piRuntimeCompatRequiresToolResultName' },
  {
    key: 'requiresAssistantAfterToolResult',
    labelKey: 'piRuntimeCompatRequiresAssistantAfterToolResult',
  },
  { key: 'requiresThinkingAsText', labelKey: 'piRuntimeCompatRequiresThinkingAsText' },
  {
    key: 'requiresReasoningContentOnAssistantMessages',
    labelKey: 'piRuntimeCompatRequiresReasoningContentOnAssistantMessages',
  },
] as const satisfies ReadonlyArray<{ key: CompatBooleanKey; labelKey: string }>;

const MAX_TOKENS_FIELD_OPTIONS = [
  {
    value: ProviderModelPiMaxTokensField.MaxCompletionTokens,
    labelKey: 'piRuntimeMaxTokensFieldMaxCompletionTokens',
  },
  { value: ProviderModelPiMaxTokensField.MaxTokens, labelKey: 'piRuntimeMaxTokensFieldMaxTokens' },
] as const;

const THINKING_FORMAT_OPTIONS = Object.values(ProviderModelPiThinkingFormat).map(value => ({
  value,
  label: value,
}));

function booleanToSelectValue(value: boolean | undefined): PiRuntimeSelectValue {
  if (value === true) return PiRuntimeSelectValue.Enabled;
  if (value === false) return PiRuntimeSelectValue.Disabled;
  return PiRuntimeSelectValue.Auto;
}

function selectValueToBoolean(value: string | null): boolean | undefined {
  if (value === PiRuntimeSelectValue.Enabled) return true;
  if (value === PiRuntimeSelectValue.Disabled) return false;
  return undefined;
}

function updateCompatField<Key extends keyof ProviderModelPiRuntimeCompat>(
  value: ProviderModelPiRuntimeConfig | undefined,
  key: Key,
  nextValue: ProviderModelPiRuntimeCompat[Key] | undefined,
): ProviderModelPiRuntimeConfig | undefined {
  const compat = { ...(value?.compat ?? {}) };
  if (nextValue === undefined) {
    delete compat[key];
  } else {
    compat[key] = nextValue;
  }
  return normalizeProviderModelPiRuntimeConfig({ ...value, compat });
}

export interface PiRuntimeModelConfigProps {
  value?: ProviderModelPiRuntimeConfig;
  onChange: (value: ProviderModelPiRuntimeConfig | undefined) => void;
}

export function PiRuntimeModelConfig({ value, onChange }: PiRuntimeModelConfigProps) {
  const updateApi = (apiValue: string | null) => {
    onChange(
      normalizeProviderModelPiRuntimeConfig({
        ...value,
        api: apiValue === PiRuntimeSelectValue.Auto || apiValue === null ? undefined : apiValue,
      }),
    );
  };

  const updateReasoning = (checked: boolean) => {
    onChange(normalizeProviderModelPiRuntimeConfig({ ...value, reasoning: checked || undefined }));
  };

  return (
    <FieldSet className="rounded-lg border border-border bg-surface-raised p-3">
      <FieldGroup className="grid grid-cols-2 gap-3">
        <Field orientation="horizontal" className="items-center justify-between gap-2">
          <FieldLabel className="text-[11px] text-muted-foreground">
            {i18nService.t('piRuntimeApi')}
          </FieldLabel>
          <Select value={value?.api ?? PiRuntimeSelectValue.Auto} onValueChange={updateApi}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger>
              <SelectGroup>
                <SelectItem value={PiRuntimeSelectValue.Auto}>
                  {i18nService.t('piRuntimeApiAuto')}
                </SelectItem>
                {PI_API_OPTIONS.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {i18nService.t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field orientation="horizontal" className="items-center justify-between gap-2">
          <FieldLabel
            htmlFor="custom-model-pi-runtime-reasoning"
            className="text-[11px] text-muted-foreground"
          >
            {i18nService.t('piRuntimeReasoning')}
          </FieldLabel>
          <Checkbox
            id="custom-model-pi-runtime-reasoning"
            checked={value?.reasoning === true}
            onCheckedChange={checked => updateReasoning(checked === true)}
          />
        </Field>

        <Collapsible defaultOpen={false} className="col-span-2">
          <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-1 py-1 text-xs font-medium text-foreground hover:bg-muted">
            {i18nService.t('piRuntimeCompat')}
            <ChevronDown className="size-4 text-muted-foreground" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                {COMPAT_BOOLEAN_FIELDS.map(field => (
                  <label
                    key={field.key}
                    className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground"
                  >
                    <span className="min-w-0 leading-tight">{i18nService.t(field.labelKey)}</span>
                    <Select
                      value={booleanToSelectValue(value?.compat?.[field.key])}
                      onValueChange={nextValue =>
                        onChange(
                          updateCompatField(value, field.key, selectValueToBoolean(nextValue)),
                        )
                      }
                    >
                      <SelectTrigger className="h-8 w-24 shrink-0 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger>
                        <SelectGroup>
                          <SelectItem value={PiRuntimeSelectValue.Auto}>
                            {i18nService.t('piRuntimeCompatAuto')}
                          </SelectItem>
                          <SelectItem value={PiRuntimeSelectValue.Enabled}>
                            {i18nService.t('enabled')}
                          </SelectItem>
                          <SelectItem value={PiRuntimeSelectValue.Disabled}>
                            {i18nService.t('disabled')}
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field orientation="horizontal" className="items-center justify-between gap-2">
                  <FieldLabel className="text-[11px] text-muted-foreground">
                    {i18nService.t('piRuntimeMaxTokensField')}
                  </FieldLabel>
                  <Select
                    value={value?.compat?.maxTokensField ?? PiRuntimeSelectValue.Auto}
                    onValueChange={nextValue =>
                      onChange(
                        updateCompatField(
                          value,
                          'maxTokensField',
                          nextValue === PiRuntimeSelectValue.Auto || nextValue === null
                            ? undefined
                            : (nextValue as ProviderModelPiMaxTokensField),
                        ),
                      )
                    }
                  >
                    <SelectTrigger className="h-8 w-32 shrink-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger>
                      <SelectGroup>
                        <SelectItem value={PiRuntimeSelectValue.Auto}>
                          {i18nService.t('piRuntimeCompatAuto')}
                        </SelectItem>
                        {MAX_TOKENS_FIELD_OPTIONS.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {i18nService.t(option.labelKey)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field orientation="horizontal" className="items-center justify-between gap-2">
                  <FieldLabel className="text-[11px] text-muted-foreground">
                    {i18nService.t('piRuntimeThinkingFormat')}
                  </FieldLabel>
                  <Select
                    value={value?.compat?.thinkingFormat ?? PiRuntimeSelectValue.Auto}
                    onValueChange={nextValue =>
                      onChange(
                        updateCompatField(
                          value,
                          'thinkingFormat',
                          nextValue === PiRuntimeSelectValue.Auto || nextValue === null
                            ? undefined
                            : (nextValue as ProviderModelPiThinkingFormat),
                        ),
                      )
                    }
                  >
                    <SelectTrigger className="h-8 w-32 shrink-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger>
                      <SelectGroup>
                        <SelectItem value={PiRuntimeSelectValue.Auto}>
                          {i18nService.t('piRuntimeCompatAuto')}
                        </SelectItem>
                        {THINKING_FORMAT_OPTIONS.map(option => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field orientation="horizontal" className="items-center justify-between gap-2">
                  <FieldLabel className="text-[11px] text-muted-foreground">
                    {i18nService.t('piRuntimeCacheControlFormat')}
                  </FieldLabel>
                  <Select
                    value={value?.compat?.cacheControlFormat ?? PiRuntimeSelectValue.Auto}
                    onValueChange={nextValue =>
                      onChange(
                        updateCompatField(
                          value,
                          'cacheControlFormat',
                          nextValue === PiRuntimeSelectValue.Auto || nextValue === null
                            ? undefined
                            : ProviderModelPiCacheControlFormat.Anthropic,
                        ),
                      )
                    }
                  >
                    <SelectTrigger className="h-8 w-32 shrink-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger>
                      <SelectGroup>
                        <SelectItem value={PiRuntimeSelectValue.Auto}>
                          {i18nService.t('piRuntimeCompatAuto')}
                        </SelectItem>
                        <SelectItem value={ProviderModelPiCacheControlFormat.Anthropic}>
                          {i18nService.t('piRuntimeCacheControlAnthropic')}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </FieldGroup>
    </FieldSet>
  );
}

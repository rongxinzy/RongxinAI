import { Input } from '@shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { ModelCapabilityStatus, type ModelCapabilities } from '../../../shared/providers';
import { i18nService } from '../../services/i18n';

export const MODEL_CAPABILITY_FIELDS = [
  { key: 'toolCalling', labelKey: 'capabilityToolCalling' },
  { key: 'imageInput', labelKey: 'imageInput' },
  { key: 'videoInput', labelKey: 'capabilityVideoInput' },
  { key: 'audioInput', labelKey: 'capabilityAudioInput' },
  { key: 'documentInput', labelKey: 'capabilityDocumentInput' },
  { key: 'reasoning', labelKey: 'capabilityReasoning' },
] as const satisfies ReadonlyArray<{ key: keyof ModelCapabilities; labelKey: string }>;

export type ModelCapabilityKey = (typeof MODEL_CAPABILITY_FIELDS)[number]['key'];

type ModelCapabilitiesFieldsProps = {
  capabilities: Partial<ModelCapabilities>;
  contextWindow?: number | string;
  maxTokens?: number | string;
  contextWindowDisabled?: boolean;
  maxTokensDisabled?: boolean;
  editableCapabilities?: Partial<Record<ModelCapabilityKey, boolean>>;
  visibleCapabilities?: readonly ModelCapabilityKey[];
  onContextWindowChange?: (value: string) => void;
  onMaxTokensChange?: (value: string) => void;
  onCapabilityChange?: (key: ModelCapabilityKey, value: ModelCapabilityStatus) => void;
};

const statusLabel = (status: ModelCapabilityStatus): string => {
  switch (status) {
    case ModelCapabilityStatus.Supported:
      return i18nService.t('capabilitySupported');
    case ModelCapabilityStatus.Unsupported:
      return i18nService.t('capabilityUnsupported');
    default:
      return i18nService.t('capabilityUnknown');
  }
};

export function ModelCapabilitiesFields({
  capabilities,
  contextWindow,
  maxTokens,
  contextWindowDisabled = false,
  maxTokensDisabled = false,
  editableCapabilities,
  visibleCapabilities = MODEL_CAPABILITY_FIELDS.map(field => field.key),
  onContextWindowChange,
  onMaxTokensChange,
  onCapabilityChange,
}: ModelCapabilitiesFieldsProps) {
  const fields = MODEL_CAPABILITY_FIELDS.filter(field => visibleCapabilities.includes(field.key));

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3">
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-foreground">
          <span>{i18nService.t('modelContextWindowK')}</span>
          <Input
            type={onContextWindowChange ? 'number' : 'text'}
            min={onContextWindowChange ? 1 : undefined}
            value={contextWindow ?? ''}
            disabled={contextWindowDisabled || !onContextWindowChange}
            onChange={event => onContextWindowChange?.(event.target.value)}
            placeholder="128"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-foreground">
          <span>{i18nService.t('modelMaxOutputTokensK')}</span>
          <Input
            type={onMaxTokensChange ? 'number' : 'text'}
            min={onMaxTokensChange ? 1 : undefined}
            value={maxTokens ?? ''}
            disabled={maxTokensDisabled || !onMaxTokensChange}
            onChange={event => onMaxTokensChange?.(event.target.value)}
            placeholder="4"
          />
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map(field => {
          const status = capabilities[field.key] ?? ModelCapabilityStatus.Unknown;
          const editable = editableCapabilities
            ? editableCapabilities[field.key] === true
            : Boolean(onCapabilityChange);
          return (
            <label key={field.key} className="flex flex-col gap-1 text-sm text-foreground">
              <span>{i18nService.t(field.labelKey)}</span>
              <Select
                value={status}
                disabled={!editable}
                onValueChange={value =>
                  onCapabilityChange?.(field.key, value as ModelCapabilityStatus)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{statusLabel(status)}</SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false} sideOffset={4}>
                  <SelectItem value={ModelCapabilityStatus.Supported}>
                    {i18nService.t('capabilitySupported')}
                  </SelectItem>
                  <SelectItem value={ModelCapabilityStatus.Unsupported}>
                    {i18nService.t('capabilityUnsupported')}
                  </SelectItem>
                  <SelectItem value={ModelCapabilityStatus.Unknown}>
                    {i18nService.t('capabilityUnknown')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>
          );
        })}
      </div>
    </div>
  );
}

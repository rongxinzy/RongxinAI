import { Toggle } from '@shared/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/components/ui/tooltip';
import { Brain } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { i18nService } from '../../services/i18n';
import type { Model } from '../../store/slices/modelSlice';
import { supportsLocalThinkingToggle } from './localThinking';

type LocalThinkingToggleProps = {
  model: Model | null;
  visible: boolean;
  enabled?: boolean;
  disabled: boolean;
  onEnabledChange?: (enabled: boolean | undefined) => void;
  compact?: boolean;
};

export function LocalThinkingToggle({
  model,
  visible,
  enabled,
  disabled,
  onEnabledChange,
  compact = false,
}: LocalThinkingToggleProps) {
  const previousSupportedModelRef = useRef<string | undefined>(undefined);
  const modelIdentity = model
    ? `${model.providerKey ?? model.provider ?? ''}::${model.id}`
    : undefined;
  const supported = visible && supportsLocalThinkingToggle(model);

  useEffect(() => {
    const supportedModelIdentity = supported ? modelIdentity : undefined;
    if (previousSupportedModelRef.current === supportedModelIdentity) return;
    previousSupportedModelRef.current = supportedModelIdentity;
    onEnabledChange?.(supportedModelIdentity ? (enabled ?? false) : undefined);
  }, [enabled, modelIdentity, onEnabledChange, supported]);

  if (!supported) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            aria-label={i18nService.t('chatThinkingToggle')}
            pressed={enabled ?? false}
            onPressedChange={onEnabledChange}
            disabled={disabled}
            size="sm"
          >
            <Brain data-icon="inline-start" />
            {!compact && <span>{i18nService.t('chatThinkingToggle')}</span>}
          </Toggle>
        }
      />
      <TooltipContent>{i18nService.t('chatThinkingToggleHint')}</TooltipContent>
    </Tooltip>
  );
}

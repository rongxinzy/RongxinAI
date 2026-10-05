import { Badge } from '@shared/components/ui/badge';

import { i18nService } from '../../../services/i18n';
import { SettingsToggleRow } from '../../common/SettingsToggleRow';
import type { ProvidersConfig, ProviderType } from './constants';

const CODING_PLAN_ENTRIES = [
  {
    provider: 'zhipu',
    label: 'GLM Coding Plan',
    badgeKey: 'codingPlanBetaBadge',
    hintKey: 'zhipuCodingPlanHint',
  },
  {
    provider: 'qwen',
    label: 'Coding Plan',
    badgeKey: 'codingPlanSubscriptionBadge',
    hintKey: 'qwenCodingPlanHint',
  },
  {
    provider: 'volcengine',
    label: 'Coding Plan',
    badgeKey: 'codingPlanBetaBadge',
    hintKey: 'volcengineCodingPlanHint',
  },
  {
    provider: 'moonshot',
    label: 'Coding Plan',
    badgeKey: 'codingPlanBetaBadge',
    hintKey: 'moonshotCodingPlanHint',
  },
  {
    provider: 'qianfan',
    label: 'Coding Plan',
    badgeKey: 'codingPlanBetaBadge',
    hintKey: 'qianfanCodingPlanHint',
  },
  {
    provider: 'xiaomi',
    label: 'Coding Plan',
    badgeKey: 'codingPlanBetaBadge',
    hintKey: 'xiaomiCodingPlanHint',
  },
] as const satisfies ReadonlyArray<{
  provider: ProviderType;
  label: string;
  badgeKey: string;
  hintKey: string;
}>;

interface ProviderCodingPlanSectionProps {
  providers: ProvidersConfig;
  activeProvider: ProviderType;
  onProviderConfigChange: (provider: ProviderType, field: string, value: string) => void;
}

export default function ProviderCodingPlanSection({
  providers,
  activeProvider,
  onProviderConfigChange,
}: ProviderCodingPlanSectionProps) {
  const entry = CODING_PLAN_ENTRIES.find(item => item.provider === activeProvider);
  if (!entry) return null;

  return (
    <SettingsToggleRow
      label={
        <span className="flex items-center gap-2">
          {entry.label}
          <Badge variant="secondary">{i18nService.t(entry.badgeKey)}</Badge>
        </span>
      }
      description={i18nService.t(entry.hintKey)}
      checked={providers[entry.provider].codingPlanEnabled ?? false}
      onCheckedChange={checked =>
        onProviderConfigChange(entry.provider, 'codingPlanEnabled', checked ? 'true' : 'false')
      }
    />
  );
}

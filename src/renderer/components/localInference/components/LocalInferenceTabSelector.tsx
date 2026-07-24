import { LayeredTabsList, LayeredTabsSeparatorEdge } from '@shared/components/ui/layered-tabs';

import { i18nService } from '../../../services/i18n';
import type { LocalInferenceTab } from '../types';

const tabOptions: Array<{
  value: LocalInferenceTab;
  labelKey: 'localInferenceTabModels' | 'localInferenceTabMarketplace';
}> = [
  { value: 'models', labelKey: 'localInferenceTabModels' },
  { value: 'marketplace', labelKey: 'localInferenceTabMarketplace' },
];

export function LocalInferenceTabSelector({
  activeTab,
  isVisible = true,
}: {
  activeTab: LocalInferenceTab;
  isVisible?: boolean;
}) {
  return (
    <LayeredTabsList
      key={isVisible ? 'visible' : 'hidden'}
      value={activeTab}
      className="relative z-10 -mt-px gap-0"
      items={tabOptions.map(tab => ({
        value: tab.value,
        label: i18nService.t(tab.labelKey),
      }))}
      separatorEdge={LayeredTabsSeparatorEdge.Top}
      showSeparator={false}
    />
  );
}

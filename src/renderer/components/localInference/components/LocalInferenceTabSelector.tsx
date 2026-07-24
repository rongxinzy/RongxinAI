import {
  LayeredTabsList,
  LayeredTabsSeparatorEdge,
} from '@shared/components/ui/layered-tabs';

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
}: {
  activeTab: LocalInferenceTab;
}) {
  return (
    <LayeredTabsList
      value={activeTab}
      className="gap-0"
      items={tabOptions.map(tab => ({
        value: tab.value,
        label: i18nService.t(tab.labelKey),
      }))}
      separatorEdge={LayeredTabsSeparatorEdge.Top}
      contentClassName="mx-0 w-auto"
      listClassName="w-72"
    />
  );
}

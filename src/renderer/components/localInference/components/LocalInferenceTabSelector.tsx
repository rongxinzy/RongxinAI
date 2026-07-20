import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs';

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
  onActiveTabChange,
}: {
  activeTab: LocalInferenceTab;
  onActiveTabChange: (tab: LocalInferenceTab) => void;
}) {
  return (
    <Tabs
      data-local-inference-tabs
      value={activeTab}
      className="gap-0"
      onValueChange={value => onActiveTabChange(value as LocalInferenceTab)}
    >
      <TabsList>
        {tabOptions.map(tab => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            data-local-inference-tab={tab.value}
          >
            {i18nService.t(tab.labelKey)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

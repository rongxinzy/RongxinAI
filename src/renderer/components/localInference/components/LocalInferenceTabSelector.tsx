import {
  LayeredTabsList,
  LayeredTabsSeparatorEdge,
} from '@shared/components/ui/layered-tabs';
import { Tabs } from '@shared/components/ui/tabs';

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
      value={activeTab}
      className="gap-0"
      onValueChange={value => onActiveTabChange(value as LocalInferenceTab)}
    >
      <LayeredTabsList
        value={activeTab}
        items={tabOptions.map(tab => ({
          value: tab.value,
          label: i18nService.t(tab.labelKey),
        }))}
        separatorEdge={LayeredTabsSeparatorEdge.Top}
        className="w-auto pb-4"
        contentClassName="mx-0 w-auto"
      />
    </Tabs>
  );
}

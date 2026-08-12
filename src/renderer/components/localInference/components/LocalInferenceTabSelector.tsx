import { LayeredTabsList, LayeredTabsSeparatorEdge } from '@shared/components/ui/layered-tabs';
import { useLayoutEffect, useRef, useState } from 'react';

import { i18nService } from '../../../services/i18n';
import type { LocalInferenceTab } from '../types';

const tabOptions: Array<{
  value: LocalInferenceTab;
  labelKey: 'localInferenceTabModels' | 'localInferenceTabMarketplace';
}> = [
  { value: 'models', labelKey: 'localInferenceTabModels' },
  { value: 'marketplace', labelKey: 'localInferenceTabMarketplace' },
];

function getEntryPresentationTab(activeTab: LocalInferenceTab): LocalInferenceTab {
  return tabOptions.find(tab => tab.value !== activeTab)?.value ?? activeTab;
}

export function LocalInferenceTabSelector({
  activeTab,
  isVisible = true,
}: {
  activeTab: LocalInferenceTab;
  isVisible?: boolean;
}) {
  const [presentationTab, setPresentationTab] = useState<LocalInferenceTab>(() =>
    isVisible ? getEntryPresentationTab(activeTab) : activeTab,
  );
  const previousVisibleRef = useRef(false);

  useLayoutEffect(() => {
    const wasVisible = previousVisibleRef.current;
    previousVisibleRef.current = isVisible;

    if (!isVisible) return;
    if (wasVisible) {
      setPresentationTab(activeTab);
      return;
    }

    setPresentationTab(getEntryPresentationTab(activeTab));
    const frame = window.requestAnimationFrame(() => setPresentationTab(activeTab));
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, isVisible]);

  return (
    <LayeredTabsList
      key={isVisible ? 'visible' : 'hidden'}
      value={activeTab}
      className="relative z-10 -mt-px gap-0"
      presentationValue={presentationTab}
      items={tabOptions.map(tab => ({
        value: tab.value,
        label: i18nService.t(tab.labelKey),
      }))}
      separatorEdge={LayeredTabsSeparatorEdge.Top}
      showSeparator={false}
    />
  );
}

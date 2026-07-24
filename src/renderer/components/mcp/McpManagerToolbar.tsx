import { Badge } from '@shared/components/ui/badge';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@shared/components/ui/input-group';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { Cable, Search } from 'lucide-react';

import { i18nService } from '../../services/i18n';
import { McpTab, type McpTab as McpTabType } from './constants';

interface McpManagerToolbarProps {
  activeTab: McpTabType;
  installedCount: number;
  marketplaceCount: number;
  customCount: number;
  searchQuery: string;
  showTabs: boolean;
  onTabChange: (tab: McpTabType) => void;
  onSearchQueryChange: (searchQuery: string) => void;
}

const MCP_TAB_ITEMS = [
  { value: McpTab.Installed, labelKey: 'mcpInstalled' },
  { value: McpTab.Marketplace, labelKey: 'mcpMarketplace' },
  { value: McpTab.Custom, labelKey: 'mcpCustom' },
] as const;

function getTabCount(
  tab: McpTabType,
  installedCount: number,
  marketplaceCount: number,
  customCount: number,
) {
  switch (tab) {
    case McpTab.Installed:
      return installedCount;
    case McpTab.Marketplace:
      return marketplaceCount;
    case McpTab.Custom:
      return customCount;
  }
}

export function McpManagerToolbar({
  activeTab,
  installedCount,
  marketplaceCount,
  customCount,
  searchQuery,
  showTabs,
  onTabChange,
  onSearchQueryChange,
}: McpManagerToolbarProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-border">
      <div className="flex items-center gap-3">
        <Cable className="size-8 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{i18nService.t('connectors')}</h2>
          <p className="text-sm text-muted-foreground">{i18nService.t('connectorsDescription')}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {showTabs ? (
          <Tabs
            value={activeTab}
            onValueChange={value => onTabChange(value as McpTabType)}
            className="-mb-px self-end"
          >
            <TabsList variant="line">
              {MCP_TAB_ITEMS.map(tab => {
                const count = getTabCount(tab.value, installedCount, marketplaceCount, customCount);

                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="after:bottom-[-1px] after:h-1"
                  >
                    {i18nService.t(tab.labelKey)}
                    {count > 0 ? <Badge variant="secondary">{count}</Badge> : null}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        ) : (
          <span />
        )}

        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon>
            <InputGroupText>
              <Search />
            </InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            value={searchQuery}
            onChange={event => onSearchQueryChange(event.target.value)}
            placeholder={i18nService.t('searchMcpServers')}
            aria-label={i18nService.t('searchMcpServers')}
          />
        </InputGroup>
      </div>
    </header>
  );
}

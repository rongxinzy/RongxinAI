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
      <div className="flex items-center gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-muted">
          <Cable className="size-6 text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 className="text-xxl font-semibold text-foreground">{i18nService.t('connectors')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{i18nService.t('connectorsDescription')}</p>
        </div>
      </div>

      <InputGroup className="w-full">
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

      {showTabs ? (
        <Tabs
          value={activeTab}
          onValueChange={value => onTabChange(value as McpTabType)}
          className="-mb-px self-start"
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
      ) : null}
    </header>
  );
}

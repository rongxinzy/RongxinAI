import { Badge } from '@shared/components/ui/badge';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@shared/components/ui/input-group';
import { PageTabs } from '@shared/components/ui/page-tabs';
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
        <p className="min-w-0 text-sm text-muted-foreground">
          {i18nService.t('connectorsDescription')}
        </p>
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
        <PageTabs
          value={activeTab}
          onValueChange={onTabChange}
          className="-mb-px"
          items={MCP_TAB_ITEMS.map(tab => {
            const count = getTabCount(tab.value, installedCount, marketplaceCount, customCount);
            return {
              value: tab.value,
              label: i18nService.t(tab.labelKey),
              badge: count > 0 ? <Badge variant="secondary">{count}</Badge> : undefined,
            };
          })}
        />
      ) : null}
    </header>
  );
}

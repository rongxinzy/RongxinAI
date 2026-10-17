import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@shared/components/ui/input-group';
import { PageTabs } from '@shared/components/ui/page-tabs';
import { Cable, Cloud, FileUp, Search, Terminal } from 'lucide-react';

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
  onConfigureLocal?: () => void;
  onConfigureCloud?: () => void;
  onImportConfig?: () => void;
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
  onConfigureLocal,
  onConfigureCloud,
  onImportConfig,
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

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center justify-between">
        <InputGroup className="flex-1 max-w-md">
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

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onConfigureLocal && (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={onConfigureLocal}
              className="gap-1.5 h-9"
            >
              <Terminal className="size-4" />
              {i18nService.t('configureLocalMcp')}
            </Button>
          )}

          {onConfigureCloud && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onConfigureCloud}
              className="gap-1.5 h-9"
            >
              <Cloud className="size-4" />
              {i18nService.t('configureCloudMcp')}
            </Button>
          )}

          {onImportConfig && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onImportConfig}
              className="gap-1.5 h-9"
            >
              <FileUp className="size-4" />
              {i18nService.t('importMcpConfigJson')}
            </Button>
          )}
        </div>
      </div>

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

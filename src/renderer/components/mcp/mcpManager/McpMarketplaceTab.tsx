/**
 * Marketplace tab of the MCP manager.
 *
 * Extracted verbatim from McpManager.tsx (issue #1069); only the handler
 * references were lifted into props.
 */
import { Button } from '@shared/components/ui/button';
import { LoaderCircle, X } from 'lucide-react';

import { i18nService } from '../../../services/i18n';
import type { McpRegistryEntry } from '../../../types/mcp';
import { ListPagination } from '../../common/ListPagination';
import ClampedText from './ClampedText';
import McpIcon from './McpIcon';
import {
  MCP_ICON_BY_ID,
  TRANSPORT_BADGE_CLASS_NAME,
  getRegistryIconImageClassName,
  getStdioCommandSummary,
} from './shared';

interface McpMarketplaceTabProps {
  filteredMarketplace: McpRegistryEntry[];
  paginatedMarketplace: McpRegistryEntry[];
  installedRegistryIds: ReadonlySet<string>;
  installingRegistryId: string | null;
  pendingOfficialAuthorizationRegistryId: string | null;
  officialIcons: Record<string, string>;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  getRegistryEntryDescription: (entry: McpRegistryEntry) => string;
  onInstallFromRegistry: (entry: McpRegistryEntry) => void;
  onCancelOfficialAuthorization: () => void;
}

export function McpMarketplaceTab({
  filteredMarketplace,
  paginatedMarketplace,
  installedRegistryIds,
  installingRegistryId,
  pendingOfficialAuthorizationRegistryId,
  officialIcons,
  currentPage,
  totalPages,
  onPageChange,
  getRegistryEntryDescription,
  onInstallFromRegistry,
  onCancelOfficialAuthorization,
}: McpMarketplaceTabProps) {
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {filteredMarketplace.length === 0 ? (
          <div className="col-span-full text-center py-12 text-sm text-muted-foreground">
            {i18nService.t('noMcpServersAvailable')}
          </div>
        ) : (
          paginatedMarketplace.map(entry => (
            <div
              key={entry.id}
              className="group flex min-h-20 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted"
            >
              <McpIcon
                iconSrc={officialIcons[entry.id] || MCP_ICON_BY_ID[entry.id]}
                fallbackLabel={entry.name}
                imageClassName={getRegistryIconImageClassName(entry.id)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{entry.name}</span>
                </div>
                <ClampedText
                  text={getRegistryEntryDescription(entry)}
                  className="mt-1 line-clamp-1 text-xs text-muted-foreground"
                />
                {entry.requiredEnvKeys && entry.requiredEnvKeys.length > 0 && (
                  <span className="mt-1 block text-xs text-warning">
                    {entry.requiredEnvKeys.length} key
                    {entry.requiredEnvKeys.length > 1 ? 's' : ''}
                  </span>
                )}
                <div className="hidden">
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 font-medium ${TRANSPORT_BADGE_CLASS_NAME}`}
                  >
                    {entry.transportType}
                  </span>
                  <span className="shrink-0">·</span>
                  <span className="min-w-0 truncate">
                    {getStdioCommandSummary(entry.command, entry.defaultArgs)}
                  </span>
                  {entry.requiredEnvKeys && entry.requiredEnvKeys.length > 0 && (
                    <>
                      <span className="shrink-0">·</span>
                      <span className="shrink-0 text-warning">
                        {entry.requiredEnvKeys.length} key
                        {entry.requiredEnvKeys.length > 1 ? 's' : ''}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div
                className={`flex shrink-0 items-center gap-1.5 transition-opacity ${installingRegistryId === entry.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100'}`}
              >
                {pendingOfficialAuthorizationRegistryId === entry.id ? (
                  <div className="flex items-center gap-1">
                    <div
                      className="flex size-7 items-center justify-center"
                      aria-label={i18nService.t('mcpWaitingForAuthorization')}
                    >
                      <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="theme-action-icon-small-muted"
                      aria-label={i18nService.t('cancel')}
                      title={i18nService.t('cancel')}
                      onClick={onCancelOfficialAuthorization}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ) : installingRegistryId === entry.id ? (
                  <div
                    className="flex size-7 items-center justify-center"
                    aria-label={i18nService.t('mcpInstall')}
                  >
                    <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                  </div>
                ) : installedRegistryIds.has(entry.id) ? (
                  <span className="px-2.5 py-1 text-xs rounded-lg bg-surface text-muted-foreground">
                    {i18nService.t('mcpInstalled')}
                  </span>
                ) : (
                  <Button
                    type="button"
                    onClick={() => onInstallFromRegistry(entry)}
                    className="theme-page-mcp-manager-button-2"
                  >
                    {i18nService.t('mcpInstall')}
                  </Button>
                )}
              </div>
              <div className="hidden">
                <span
                  className={`shrink-0 rounded-md px-1.5 py-0.5 font-medium ${TRANSPORT_BADGE_CLASS_NAME}`}
                >
                  {entry.transportType}
                </span>
                <span className="shrink-0">·</span>
                <span className="truncate min-w-0">
                  {getStdioCommandSummary(entry.command, entry.defaultArgs)}
                </span>
                {entry.requiredEnvKeys && entry.requiredEnvKeys.length > 0 && (
                  <>
                    <span className="shrink-0">·</span>
                    <span className="shrink-0 text-warning">
                      {entry.requiredEnvKeys.length} key
                      {entry.requiredEnvKeys.length > 1 ? 's' : ''}
                    </span>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      <ListPagination
        page={currentPage}
        totalPages={totalPages}
        className="py-4"
        onPageChange={onPageChange}
      />
    </div>
  );
}

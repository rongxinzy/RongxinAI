/**
 * Installed-servers tab of the MCP manager.
 *
 * Extracted verbatim from McpManager.tsx (issue #1069); only the handler
 * references were lifted into props.
 */
import { Button } from '@shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { Cable, LoaderCircle, MoreHorizontal, Trash2 } from 'lucide-react';

import { i18nService } from '../../../services/i18n';
import type { McpRegistryEntry, McpServerConfig } from '../../../types/mcp';
import { ListPagination } from '../../common/ListPagination';
import ClampedText from './ClampedText';
import McpIcon from './McpIcon';
import {
  TRANSPORT_BADGE_CLASS_NAME,
  getRegistryIconImageClassName,
  getStdioCommandSummary,
} from './shared';

interface McpInstalledTabProps {
  filteredInstalled: McpServerConfig[];
  paginatedInstalled: McpServerConfig[];
  deletingServerId: string | null;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  getIconForServer: (server: McpServerConfig) => string | undefined;
  getInstalledDescription: (server: McpServerConfig) => string;
  getRegistryEntryForServer: (server: McpServerConfig) => McpRegistryEntry | undefined;
  onUseMcp: (server: McpServerConfig) => void;
  onRequestDelete: (server: McpServerConfig) => void;
  onOpenMarketplace: () => void;
}

export function McpInstalledTab({
  filteredInstalled,
  paginatedInstalled,
  deletingServerId,
  currentPage,
  totalPages,
  onPageChange,
  getIconForServer,
  getInstalledDescription,
  getRegistryEntryForServer,
  onUseMcp,
  onRequestDelete,
  onOpenMarketplace,
}: McpInstalledTabProps) {
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {filteredInstalled.length === 0 ? (
          <div className="col-span-full flex min-h-60 flex-col items-center justify-center gap-3 p-6 text-center">
            <Cable className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {i18nService.t('mcpNoInstalledServers')}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={onOpenMarketplace}>
              {i18nService.t('mcpMarketplace')}
            </Button>
          </div>
        ) : (
          paginatedInstalled.map(server => {
            const registryEntry = getRegistryEntryForServer(server);
            const installedDescription = getInstalledDescription(server);
            const isDeletingServer = deletingServerId === server.id;
            return (
              <div
                key={server.id}
                className="group flex min-h-20 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted"
              >
                <McpIcon
                  iconSrc={getIconForServer(server)}
                  fallbackLabel={server.name}
                  imageClassName={getRegistryIconImageClassName(registryEntry?.id)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {server.name}
                    </span>
                    <span
                      className={`hidden shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium sm:inline-flex ${TRANSPORT_BADGE_CLASS_NAME}`}
                    >
                      {server.transportType}
                    </span>
                  </div>
                  <ClampedText
                    text={installedDescription}
                    className="mt-1 line-clamp-1 text-xs text-muted-foreground"
                  />
                </div>
                {isDeletingServer ? (
                  <div
                    className="flex size-8 shrink-0 items-center justify-center"
                    aria-label={i18nService.t('mcpUninstall')}
                  >
                    <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => onUseMcp(server)}
                      className="theme-page-mcp-manager-button-1"
                    >
                      {i18nService.t('mcpUse')}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={i18nService.t('mcpMoreActions')}
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => onRequestDelete(server)}
                        >
                          <Trash2 />
                          {i18nService.t('mcpUninstall')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
                <div className="hidden">
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 font-medium ${TRANSPORT_BADGE_CLASS_NAME}`}
                  >
                    {server.transportType}
                  </span>
                  {server.transportType === 'stdio' && server.command && (
                    <>
                      <span className="shrink-0">·</span>
                      <span className="truncate min-w-0">
                        {getStdioCommandSummary(server.command, server.args)}
                      </span>
                    </>
                  )}
                  {(server.transportType === 'sse' || server.transportType === 'http') &&
                    server.url && (
                      <>
                        <span className="shrink-0">·</span>
                        <span className="truncate min-w-0">{server.url}</span>
                      </>
                    )}
                  {registryEntry?.requiredEnvKeys && registryEntry.requiredEnvKeys.length > 0 && (
                    <>
                      <span className="shrink-0">·</span>
                      <span className="shrink-0 text-warning">
                        {registryEntry.requiredEnvKeys.length} key
                        {registryEntry.requiredEnvKeys.length > 1 ? 's' : ''}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })
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

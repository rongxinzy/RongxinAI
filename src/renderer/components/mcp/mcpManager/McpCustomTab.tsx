/**
 * Custom (user-created) servers tab of the MCP manager.
 *
 * Extracted verbatim from McpManager.tsx (issue #1069); only the handler
 * references were lifted into props.
 */
import { Button } from '@shared/components/ui/button';
import { Switch } from '@shared/components/ui/switch';
import { Cable, Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';

import { i18nService } from '../../../services/i18n';
import type { McpServerConfig } from '../../../types/mcp';
import { ListPagination } from '../../common/ListPagination';
import ClampedText from './ClampedText';
import { TRANSPORT_BADGE_CLASS_NAME, getTransportSummary } from './shared';

interface McpCustomTabProps {
  filteredCustom: McpServerConfig[];
  paginatedCustom: McpServerConfig[];
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onOpenCreateForm: () => void;
  onOpenEditForm: (server: McpServerConfig) => void;
  onRequestDelete: (server: McpServerConfig) => void;
  onToggleEnabled: (serverId: string) => void;
  onImportConfig: () => void;
  onExportConfig: () => void;
}

export function McpCustomTab({
  filteredCustom,
  paginatedCustom,
  currentPage,
  totalPages,
  onPageChange,
  onOpenCreateForm,
  onOpenEditForm,
  onRequestDelete,
  onToggleEnabled,
  onImportConfig,
  onExportConfig,
}: McpCustomTabProps) {
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {filteredCustom.length === 0 ? (
          <div className="col-span-full flex min-h-60 flex-col items-center justify-center gap-3 p-6 text-center">
            <Cable className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{i18nService.t('mcpCustom')}</p>
            <Button type="button" size="sm" onClick={onOpenCreateForm}>
              <Plus data-icon="inline-start" />
              {i18nService.t('addMcpServer')}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={onImportConfig}>
                <Upload data-icon="inline-start" />
                {i18nService.t('mcpImportConfig')}
              </Button>
              <Button type="button" variant="outline" onClick={onExportConfig}>
                <Download data-icon="inline-start" />
                {i18nService.t('mcpExportConfig')}
              </Button>
              <Button type="button" variant="outline" onClick={onOpenCreateForm}>
                <Plus data-icon="inline-start" />
                {i18nService.t('addMcpServer')}
              </Button>
            </div>
            {paginatedCustom.map(server => (
              <div
                key={server.id}
                className="rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Cable className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <span className="text-sm font-medium text-foreground truncate">
                      {server.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onOpenEditForm(server)}
                      className="theme-page-mcp-manager-button-4"
                      title={i18nService.t('editMcpServer')}
                      aria-label={i18nService.t('editMcpServer')}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => onRequestDelete(server)}
                      className="theme-page-mcp-manager-button-5"
                      title={i18nService.t('deleteMcpServer')}
                      aria-label={i18nService.t('deleteMcpServer')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Switch
                      checked={server.enabled}
                      onCheckedChange={() => onToggleEnabled(server.id)}
                    />
                  </div>
                </div>

                <ClampedText
                  text={server.description || getTransportSummary(server)}
                  className="text-xs text-muted-foreground mb-2"
                />

                <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-0.5 font-medium ${TRANSPORT_BADGE_CLASS_NAME}`}
                  >
                    {server.transportType}
                  </span>
                  {server.transportType === 'stdio' && server.command && (
                    <>
                      <span className="shrink-0">·</span>
                      <span className="truncate min-w-0">{server.command}</span>
                    </>
                  )}
                  {(server.transportType === 'sse' || server.transportType === 'http') &&
                    server.url && (
                      <>
                        <span className="shrink-0">·</span>
                        <span className="truncate min-w-0">{server.url}</span>
                      </>
                    )}
                </div>
              </div>
            ))}
          </>
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

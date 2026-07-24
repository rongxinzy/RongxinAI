import { Button } from '@shared/components/ui/button';
import { Switch } from '@shared/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { Pencil, Plus, Plug, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { mcpCategories, mcpRegistry } from '../../data/mcpRegistry';
import { i18nService } from '../../services/i18n';
import { mcpService } from '../../services/mcp';
import { RootState } from '../../store';
import { setMcpServers } from '../../store/slices/mcpSlice';
import {
  McpMarketplaceCategoryInfo,
  McpRegistryEntry,
  McpServerConfig,
  McpServerFormData,
} from '../../types/mcp';
import Modal from '../common/Modal';
import ErrorMessage from '../ErrorMessage';
import McpServerFormModal from './McpServerFormModal';

const TRANSPORT_BADGE_COLORS: Record<string, string> = {
  stdio: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  sse: 'bg-green-500/10 text-green-600 dark:text-green-400',
  http: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
};

export type McpTab = 'installed' | 'marketplace' | 'custom';

interface McpManagerTabsProps {
  activeTab: McpTab;
  installedCount: number;
  marketplaceCount: number;
  customCount: number;
  onTabChange: (tab: McpTab) => void;
}

export const McpManagerTabs: React.FC<McpManagerTabsProps> = ({
  activeTab,
  installedCount,
  marketplaceCount,
  customCount,
  onTabChange,
}) => (
  <Tabs value={activeTab} onValueChange={value => onTabChange(value as McpTab)}>
    <TabsList className="shadow-inset">
      <TabsTrigger value="installed" className="data-active:shadow-elevated">
        {i18nService.t('mcpInstalled')}
        {installedCount > 0 && (
          <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs">
            {installedCount}
          </span>
        )}
      </TabsTrigger>
      <TabsTrigger value="marketplace" className="data-active:shadow-elevated">
        {i18nService.t('mcpMarketplace')}
        {marketplaceCount > 0 && (
          <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs">
            {marketplaceCount}
          </span>
        )}
      </TabsTrigger>
      <TabsTrigger value="custom" className="data-active:shadow-elevated">
        {i18nService.t('mcpCustom')}
        {customCount > 0 && (
          <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs">{customCount}</span>
        )}
      </TabsTrigger>
    </TabsList>
  </Tabs>
);

/**
 * Text with line-clamp-2 that shows a popover above the text when truncated.
 */
const ClampedText: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [isClamped, setIsClamped] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const checkClamp = useCallback(() => {
    const el = textRef.current;
    if (el) setIsClamped(el.scrollHeight > el.clientHeight + 1);
  }, []);

  useEffect(() => {
    checkClamp();
    window.addEventListener('resize', checkClamp);
    return () => window.removeEventListener('resize', checkClamp);
  }, [text, checkClamp]);

  const handleEnter = () => {
    if (!isClamped) return;
    timerRef.current = setTimeout(() => setShowFull(true), 400);
  };

  const handleLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setShowFull(false);
  };

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <p ref={textRef} className={`line-clamp-2 ${className}`}>
        {text}
      </p>
      {showFull && (
        <div
          className="absolute bottom-full left-0 right-0 mb-1 z-50
          rounded-lg px-3 py-2 text-xs leading-relaxed
          bg-surface-raised text-foreground
          shadow-xl border border-border"
        >
          {text}
        </div>
      )}
    </div>
  );
};

interface McpManagerProps {
  activeTab?: McpTab;
  onTabChange?: (tab: McpTab) => void;
  hideTabControl?: boolean;
}

const McpManager: React.FC<McpManagerProps> = ({
  activeTab: controlledActiveTab,
  onTabChange,
  hideTabControl = false,
}) => {
  const dispatch = useDispatch();
  const servers = useSelector((state: RootState) => state.mcp.servers);

  const [uncontrolledActiveTab, setUncontrolledActiveTab] = useState<McpTab>('installed');
  const [actionError, setActionError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<McpServerConfig | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null);
  const [installingRegistry, setInstallingRegistry] = useState<McpRegistryEntry | null>(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [dynamicRegistry, setDynamicRegistry] = useState<McpRegistryEntry[]>(mcpRegistry);
  const [dynamicCategories, setDynamicCategories] =
    useState<ReadonlyArray<{ id: string; key: string; name_zh?: string; name_en?: string }>>(
      mcpCategories,
    );
  const [bridgeSyncing, setBridgeSyncing] = useState(false);
  const [bridgeSyncResult, setBridgeSyncResult] = useState<{
    tools: number;
    error?: string;
  } | null>(null);
  const currentLanguage = i18nService.getLanguage();
  const activeTab = controlledActiveTab ?? uncontrolledActiveTab;
  const setActiveTab = (tab: McpTab) => {
    if (controlledActiveTab === undefined) {
      setUncontrolledActiveTab(tab);
    }
    onTabChange?.(tab);
  };

  useEffect(() => {
    let isActive = true;
    const loadServers = async () => {
      const loaded = await mcpService.loadServers();
      if (!isActive) return;
      dispatch(setMcpServers(loaded));
    };
    loadServers();
    return () => {
      isActive = false;
    };
  }, [dispatch]);

  useEffect(() => {
    let isActive = true;
    const fetchMarketplace = async () => {
      const result = await mcpService.fetchMarketplace();
      if (!isActive || !result) return;
      setDynamicRegistry(result.registry);
      const cats: Array<{ id: string; key: string; name_zh?: string; name_en?: string }> = [
        { id: 'all', key: 'mcpCategoryAll' },
        ...result.categories
          .filter((c: McpMarketplaceCategoryInfo) => c.id !== 'all')
          .map((c: McpMarketplaceCategoryInfo) => ({
            id: c.id,
            key: '',
            name_zh: c.name_zh,
            name_en: c.name_en,
          })),
      ];
      setDynamicCategories(cats);
    };
    fetchMarketplace();
    return () => {
      isActive = false;
    };
  }, []);

  const installedRegistryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of servers) {
      if (s.registryId) ids.add(s.registryId);
    }
    return ids;
  }, [servers]);

  const getRegistryEntryDescription = useCallback(
    (entry: McpRegistryEntry): string => {
      const remoteDescription =
        currentLanguage === 'zh' ? entry.description_zh : entry.description_en;
      if (remoteDescription) return remoteDescription;
      if (entry.descriptionKey) return i18nService.t(entry.descriptionKey);
      return '';
    },
    [currentLanguage],
  );

  const getStdioCommandSummary = (command?: string, args?: string[]): string => {
    if (!command) return '';
    if (!args || args.length === 0) return command;
    return `${command} ${args[args.length - 1]}`;
  };

  const getRegistryEntryForServer = useCallback(
    (server: McpServerConfig): McpRegistryEntry | undefined => {
      if (server.registryId) {
        return dynamicRegistry.find(entry => entry.id === server.registryId);
      }
      if (!server.isBuiltIn) return undefined;
      return dynamicRegistry.find(
        entry =>
          entry.name.toLowerCase() === server.name.toLowerCase() &&
          entry.transportType === server.transportType &&
          entry.command === server.command,
      );
    },
    [dynamicRegistry],
  );

  const getTransportSummary = (server: McpServerConfig): string => {
    if (server.transportType === 'stdio') {
      const parts = [server.command || ''];
      if (server.args && server.args.length > 0) {
        parts.push(server.args[0]);
        if (server.args.length > 1) parts.push('...');
      }
      return parts.join(' ');
    }
    return server.url || '';
  };

  const getInstalledDescription = useCallback(
    (server: McpServerConfig): string => {
      const persistedDescription = server.description?.trim();
      if (persistedDescription) return persistedDescription;
      const registryEntry = getRegistryEntryForServer(server);
      if (registryEntry) {
        const registryDescription = getRegistryEntryDescription(registryEntry).trim();
        if (registryDescription) return registryDescription;
      }
      return getTransportSummary(server);
    },
    [getRegistryEntryDescription, getRegistryEntryForServer],
  );

  const filteredInstalled = useMemo(() => {
    return servers;
  }, [servers]);

  const filteredCustom = useMemo(() => {
    return servers.filter(s => !s.isBuiltIn);
  }, [servers]);

  const filteredMarketplace = useMemo(() => {
    let entries = [...dynamicRegistry];
    if (activeCategory !== 'all') {
      entries = entries.filter(e => e.category === activeCategory);
    }
    return entries;
  }, [activeCategory, dynamicRegistry]);

  const handleToggleEnabled = async (serverId: string) => {
    const targetServer = servers.find(s => s.id === serverId);
    if (!targetServer) return;
    try {
      const updatedServers = await mcpService.setServerEnabled(serverId, !targetServer.enabled);
      dispatch(setMcpServers(updatedServers));
      setActionError('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : i18nService.t('mcpUpdateFailed'));
    }
  };

  const handleRequestDelete = (server: McpServerConfig) => {
    setActionError('');
    setPendingDelete(server);
  };

  const handleCancelDelete = () => {
    if (isDeleting) return;
    setPendingDelete(null);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete || isDeleting) return;
    setIsDeleting(true);
    setActionError('');
    const result = await mcpService.deleteServer(pendingDelete.id);
    if (!result.success) {
      setActionError(result.error || i18nService.t('mcpDeleteFailed'));
      setIsDeleting(false);
      return;
    }
    if (result.servers) {
      dispatch(setMcpServers(result.servers));
    }
    setIsDeleting(false);
    setPendingDelete(null);
  };

  const handleOpenEditForm = (server: McpServerConfig) => {
    setEditingServer(server);
    setInstallingRegistry(getRegistryEntryForServer(server) ?? null);
    setIsFormOpen(true);
  };

  const handleInstallFromRegistry = (entry: McpRegistryEntry) => {
    setEditingServer(null);
    setInstallingRegistry(entry);
    setIsFormOpen(true);
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingServer(null);
    setInstallingRegistry(null);
  };

  const handleSaveForm = async (
    data: McpServerFormData,
  ): Promise<{ success: boolean; error?: string }> => {
    if (editingServer && editingServer.id) {
      const result = await mcpService.updateServer(editingServer.id, data);
      if (!result.success) {
        return { success: false, error: result.error || i18nService.t('mcpUpdateFailed') };
      }
      if (result.servers) {
        dispatch(setMcpServers(result.servers));
      }
    } else {
      const result = await mcpService.createServer(data);
      if (!result.success) {
        return { success: false, error: result.error || i18nService.t('mcpCreateFailed') };
      }
      if (result.servers) {
        dispatch(setMcpServers(result.servers));
      }
    }
    handleCloseForm();
    return { success: true };
  };

  const handleOpenCreateForm = () => {
    setEditingServer(null);
    setInstallingRegistry(null);
    setIsFormOpen(true);
  };

  const existingNames = useMemo(() => servers.map(s => s.name), [servers]);

  /**
   * Listen for MCP bridge sync events from the main process.
   * Main process broadcasts syncStart/syncDone after server config changes.
   */
  useEffect(() => {
    let syncTimeout: ReturnType<typeof setTimeout> | null = null;

    const cleanupStart = mcpService.onBridgeSyncStart(() => {
      setBridgeSyncing(true);
      setBridgeSyncResult(null);
      // Fallback: auto-clear overlay after 40s to prevent permanent lock
      if (syncTimeout) clearTimeout(syncTimeout);
      syncTimeout = setTimeout(() => {
        setBridgeSyncing(false);
        setBridgeSyncResult({
          tools: 0,
          error: i18nService.t('mcpBridgeSyncError') || 'Sync timed out',
        });
      }, 40_000);
    });
    const cleanupDone = mcpService.onBridgeSyncDone(data => {
      if (syncTimeout) {
        clearTimeout(syncTimeout);
        syncTimeout = null;
      }
      setBridgeSyncing(false);
      setBridgeSyncResult({ tools: data.tools, error: data.error });
      if (!data.error) {
        setTimeout(() => setBridgeSyncResult(null), 5000);
      }
    });
    return () => {
      cleanupStart();
      cleanupDone();
      if (syncTimeout) clearTimeout(syncTimeout);
    };
  }, []);

  const marketplaceCount = useMemo(() => dynamicRegistry.length, [dynamicRegistry]);

  const customCount = useMemo(() => servers.filter(s => !s.isBuiltIn).length, [servers]);

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-4">
      {/* Sync overlay — blocks ALL interaction (including sidebar) while MCP bridge is refreshing */}
      {bridgeSyncing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-4 px-10 py-8 rounded-2xl bg-surface border border-border shadow-card">
            <svg
              className="animate-spin h-8 w-8 text-primary"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span className="text-sm text-foreground font-medium">
              {i18nService.t('mcpBridgeSyncing') || 'Syncing MCP tools...'}
            </span>
          </div>
        </div>
      )}

      {actionError && <ErrorMessage message={actionError} onClose={() => setActionError('')} />}

      {/* MCP Bridge sync result */}
      {!bridgeSyncing && bridgeSyncResult && (
        <div
          className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs border ${
            bridgeSyncResult.error
              ? 'dark:bg-red-500/10 bg-red-50 dark:text-red-400 text-red-600 dark:border-red-500/20 border-red-200'
              : 'dark:bg-green-500/10 bg-green-50 dark:text-green-400 text-green-600 dark:border-green-500/20 border-green-200'
          }`}
        >
          <span>
            {bridgeSyncResult.error
              ? `${i18nService.t('mcpBridgeSyncError') || 'Sync failed'}: ${bridgeSyncResult.error}`
              : `${i18nService.t('mcpBridgeSyncDone') || 'MCP tools synced'}: ${bridgeSyncResult.tools} ${bridgeSyncResult.tools === 1 ? 'tool' : 'tools'}`}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setBridgeSyncResult(null)}
            className="ml-2 h-auto w-auto opacity-60 hover:opacity-100"
          >
            <span className="text-lg leading-none">&times;</span>
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-5">
        {!hideTabControl && (
          <div className="flex justify-end">
            <McpManagerTabs
              activeTab={activeTab}
              installedCount={servers.length}
              marketplaceCount={marketplaceCount}
              customCount={customCount}
              onTabChange={setActiveTab}
            />
          </div>
        )}

        {activeTab === 'marketplace' && (
          <div className="flex flex-wrap items-center gap-1.5">
            {dynamicCategories.map(cat => (
              <Button
                key={cat.id}
                type="button"
                variant={activeCategory === cat.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveCategory(cat.id)}
                className="h-7 px-2.5 text-xs"
              >
                {(i18nService.getLanguage() === 'zh' ? cat.name_zh : cat.name_en) ||
                  i18nService.t(cat.key)}
              </Button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1">
          {/* ── Tab: Installed ──────────────────────────────── */}
          {activeTab === 'installed' && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredInstalled.length === 0 ? (
                <div className="col-span-full flex min-h-60 flex-col items-center justify-center gap-3 p-6 text-center">
                  <Plug className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {i18nService.t('mcpNoInstalledServers')}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveTab('marketplace')}
                  >
                    {i18nService.t('mcpMarketplace')}
                  </Button>
                </div>
              ) : (
                filteredInstalled.map(server => {
                  const registryEntry = getRegistryEntryForServer(server);
                  const installedDescription = getInstalledDescription(server);
                  return (
                    <div
                      key={server.id}
                      className="rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                            <Plug className="h-4 w-4 text-muted-foreground" />
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
                            onClick={() => handleOpenEditForm(server)}
                            className="h-7 w-7 text-muted-foreground hover:text-primary dark:hover:text-primary"
                            title={i18nService.t('editMcpServer')}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRequestDelete(server)}
                            className="h-7 w-7 text-muted-foreground hover:text-red-500 dark:hover:text-red-400"
                            title={i18nService.t('deleteMcpServer')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <Switch
                            checked={server.enabled}
                            onCheckedChange={() => handleToggleEnabled(server.id)}
                          />
                        </div>
                      </div>

                      <ClampedText
                        text={installedDescription}
                        className="text-xs text-muted-foreground mb-2"
                      />

                      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className={`shrink-0 px-1.5 py-0.5 rounded font-medium ${TRANSPORT_BADGE_COLORS[server.transportType] || ''}`}
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
                        {registryEntry?.requiredEnvKeys &&
                          registryEntry.requiredEnvKeys.length > 0 && (
                            <>
                              <span className="shrink-0">·</span>
                              <span className="shrink-0 text-amber-500 dark:text-amber-400">
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
          )}

          {/* ── Tab: Marketplace ────────────────────────────── */}
          {activeTab === 'marketplace' && (
            <div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredMarketplace.length === 0 ? (
                  <div className="col-span-full text-center py-12 text-sm text-muted-foreground">
                    {i18nService.t('noMcpServersAvailable')}
                  </div>
                ) : (
                  filteredMarketplace.map(entry => (
                    <div
                      key={entry.id}
                      className="rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                            <Plug className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <span className="text-sm font-medium text-foreground truncate">
                            {entry.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {installedRegistryIds.has(entry.id) ? (
                            <span className="px-2.5 py-1 text-xs rounded-lg bg-surface text-muted-foreground">
                              {i18nService.t('mcpInstalled')}
                            </span>
                          ) : (
                            <Button
                              type="button"
                              onClick={() => handleInstallFromRegistry(entry)}
                              className="h-7 px-2.5 text-xs"
                            >
                              {i18nService.t('mcpInstall')}
                            </Button>
                          )}
                        </div>
                      </div>

                      <ClampedText
                        text={getRegistryEntryDescription(entry)}
                        className="text-xs text-muted-foreground mb-2"
                      />

                      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className={`shrink-0 px-1.5 py-0.5 rounded font-medium ${TRANSPORT_BADGE_COLORS[entry.transportType] || ''}`}
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
                            <span className="shrink-0 text-amber-500 dark:text-amber-400">
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
            </div>
          )}

          {/* ── Tab: Custom ─────────────────────────────────── */}
          {activeTab === 'custom' && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredCustom.length === 0 ? (
                <div className="col-span-full flex min-h-60 flex-col items-center justify-center gap-3 p-6 text-center">
                  <Plug className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">{i18nService.t('mcpCustom')}</p>
                  <Button type="button" size="sm" onClick={handleOpenCreateForm}>
                    <Plus data-icon="inline-start" />
                    {i18nService.t('addMcpServer')}
                  </Button>
                </div>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleOpenCreateForm}
                    className="h-auto min-h-32 border-dashed text-muted-foreground"
                  >
                    <Plus data-icon="inline-start" />
                    {i18nService.t('addMcpServer')}
                  </Button>
                  {filteredCustom.map(server => (
                    <div
                      key={server.id}
                      className="rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                            <Plug className="h-4 w-4 text-muted-foreground" />
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
                            onClick={() => handleOpenEditForm(server)}
                            className="h-7 w-7 text-muted-foreground hover:text-primary dark:hover:text-primary"
                            title={i18nService.t('editMcpServer')}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRequestDelete(server)}
                            className="h-7 w-7 text-muted-foreground hover:text-red-500 dark:hover:text-red-400"
                            title={i18nService.t('deleteMcpServer')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <Switch
                            checked={server.enabled}
                            onCheckedChange={() => handleToggleEnabled(server.id)}
                          />
                        </div>
                      </div>

                      <ClampedText
                        text={server.description || getTransportSummary(server)}
                        className="text-xs text-muted-foreground mb-2"
                      />

                      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className={`shrink-0 px-1.5 py-0.5 rounded font-medium ${TRANSPORT_BADGE_COLORS[server.transportType] || ''}`}
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
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      {pendingDelete && (
        <Modal
          onClose={handleCancelDelete}
          overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          className="w-full max-w-sm mx-4 rounded-2xl bg-surface border border-border shadow-2xl p-5"
        >
          <div className="text-lg font-semibold text-foreground">
            {i18nService.t('deleteMcpServer')}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {i18nService.t('mcpDeleteConfirm').replace('{name}', pendingDelete.name)}
          </p>
          {actionError && <div className="mt-3 text-xs text-red-500">{actionError}</div>}
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancelDelete}
              disabled={isDeleting}
              className="h-8 px-3 text-xs"
            >
              {i18nService.t('cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="h-8 px-3 text-xs"
            >
              {i18nService.t('confirmDelete')}
            </Button>
          </div>
        </Modal>
      )}

      {/* Edit / Registry-install form modal */}
      <McpServerFormModal
        isOpen={isFormOpen}
        server={editingServer}
        registryEntry={installingRegistry}
        existingNames={existingNames}
        onClose={handleCloseForm}
        onSave={handleSaveForm}
      />
    </div>
  );
};

export default McpManager;

/**
 * MCP manager orchestrator: tab/search state, server CRUD handlers and the
 * connect-flow wiring. Presentation lives in the sibling `mcpManager/`
 * modules (split out of this file in issue #1069).
 */
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import { LoaderCircle } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { mcpService } from '../../services/mcp';
import { RootState } from '../../store';
import { setMcpServers } from '../../store/slices/mcpSlice';
import { McpRegistryEntry, McpServerConfig, McpServerFormData } from '../../types/mcp';
import ErrorMessage from '../ErrorMessage';
import { McpTab as McpTabValue, type McpRegistryId, type McpTab as McpTabType } from './constants';
import { McpManagerToolbar } from './McpManagerToolbar';
import { McpOfficialConnectDialog } from './McpOfficialConnectDialog';
import { McpTokenConnectDialog } from './McpTokenConnectDialog';
import McpServerFormModal from './McpServerFormModal';
import { McpCustomTab } from './mcpManager/McpCustomTab';
import { McpInstalledTab } from './mcpManager/McpInstalledTab';
import { McpMarketplaceTab } from './mcpManager/McpMarketplaceTab';
import {
  BAIDU_NETDISK_MCP_REGISTRY_ID,
  GITHUB_MCP_REGISTRY_ID,
  MCP_ICON_BY_ID,
  computeMcpPagination,
  getTransportSummary,
} from './mcpManager/shared';
import { useMcpMarketplaceData } from './mcpManager/useMcpMarketplaceData';
import { useMcpOfficialConnect } from './mcpManager/useMcpOfficialConnect';
import { useMcpTokenConnect } from './mcpManager/useMcpTokenConnect';
import { filterMcpItems, useMcpSearchQuery } from './mcpSearch';

interface McpManagerProps {
  activeTab?: McpTabType;
  onTabChange?: (tab: McpTabType) => void;
  hideTabControl?: boolean;
  onUseMcp?: (prompt?: string) => void;
  openRegistryId?: McpRegistryId;
  openMarketplace?: boolean;
}

const McpManager: React.FC<McpManagerProps> = ({
  activeTab: controlledActiveTab,
  onTabChange,
  hideTabControl = false,
  onUseMcp,
  openRegistryId,
  openMarketplace = false,
}) => {
  const dispatch = useDispatch();
  const servers = useSelector((state: RootState) => state.mcp.servers);

  const [uncontrolledActiveTab, setUncontrolledActiveTab] = useState<McpTabType>(
    McpTabValue.Installed,
  );
  const [searchQuery, setSearchQuery] = useMcpSearchQuery();
  const [actionError, setActionError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<McpServerConfig | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletingServerId, setDeletingServerId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null);
  const [installingRegistry, setInstallingRegistry] = useState<McpRegistryEntry | null>(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [installingRegistryId, setInstallingRegistryId] = useState<string | null>(null);
  const [bridgeSyncing, setBridgeSyncing] = useState(false);
  const currentLanguage = i18nService.getLanguage();
  const activeTab = controlledActiveTab ?? uncontrolledActiveTab;
  const setActiveTab = useCallback(
    (tab: McpTabType) => {
      if (controlledActiveTab === undefined) {
        setUncontrolledActiveTab(tab);
      }
      onTabChange?.(tab);
    },
    [controlledActiveTab, onTabChange],
  );

  useEffect(() => {
    if (!openRegistryId && !openMarketplace) return;
    setActiveTab(McpTabValue.Marketplace);
    setActiveCategory('all');
    setSearchQuery('');
  }, [openMarketplace, openRegistryId, setActiveTab, setSearchQuery]);

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

  const { dynamicRegistry, dynamicCategories, officialIcons } = useMcpMarketplaceData();

  const installedRegistryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of servers) {
      if (s.registryId) ids.add(s.registryId);
    }
    return ids;
  }, [servers]);

  const getRegistryEntryDescription = useCallback(
    (entry: McpRegistryEntry): string => {
      const presentationLocale = entry.presentation?.[currentLanguage === 'zh' ? 'zh' : 'en'];
      if (presentationLocale?.description) return presentationLocale.description;
      const remoteDescription =
        currentLanguage === 'zh' ? entry.description_zh : entry.description_en;
      if (remoteDescription) return remoteDescription;
      if (entry.descriptionKey) return i18nService.t(entry.descriptionKey);
      return '';
    },
    [currentLanguage],
  );

  const {
    officialConnectEntry,
    isOfficialConnecting,
    pendingOfficialAuthorizationRegistryId,
    isPreparingFeishuCli,
    isFeishuCliReady,
    beginOfficialConnect,
    handleOfficialConnect,
    handlePrepareFeishuCli,
    handleCloseOfficialConnect,
    handleCancelOfficialAuthorization,
  } = useMcpOfficialConnect({
    getRegistryEntryDescription,
    setActionError,
    setInstallingRegistryId,
  });

  const {
    tokenConnectEntry,
    isTokenConnecting,
    tokenConnectError,
    beginTokenConnect,
    handleCloseTokenConnect,
    handleSaveToken,
  } = useMcpTokenConnect({
    getRegistryEntryDescription,
    setInstallingRegistryId,
  });

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

  const getUsageExample = useCallback(
    (entry: McpRegistryEntry | undefined): string | undefined => {
      const locale = entry?.presentation?.[currentLanguage];
      const examples = locale?.examples?.filter(example => example.trim()) ?? [];
      return examples[Math.floor(Math.random() * examples.length)];
    },
    [currentLanguage],
  );

  const getIconForServer = useCallback(
    (server: McpServerConfig): string | undefined => {
      const registryEntry = getRegistryEntryForServer(server);
      const registryId = server.registryId || registryEntry?.id || '';
      return officialIcons[registryId] || MCP_ICON_BY_ID[registryId];
    },
    [getRegistryEntryForServer, officialIcons],
  );

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
    return filterMcpItems(servers, searchQuery, server =>
      [server.name, server.transportType, getInstalledDescription(server)].join(' '),
    );
  }, [getInstalledDescription, searchQuery, servers]);

  const filteredCustom = useMemo(() => {
    return filterMcpItems(
      servers.filter(server => !server.isBuiltIn),
      searchQuery,
      server =>
        [server.name, server.transportType, server.description, getTransportSummary(server)].join(
          ' ',
        ),
    );
  }, [searchQuery, servers]);

  const filteredMarketplace = useMemo(() => {
    let entries = filterMcpItems(dynamicRegistry, searchQuery, entry =>
      [
        entry.id,
        entry.name,
        entry.transportType,
        entry.category,
        getRegistryEntryDescription(entry),
      ].join(' '),
    );
    if (activeCategory !== 'all') {
      entries = entries.filter(e => e.category === activeCategory);
    }
    return entries;
  }, [activeCategory, dynamicRegistry, getRegistryEntryDescription, searchQuery]);

  const { totalPages, paginatedInstalled, paginatedMarketplace, paginatedCustom } =
    computeMcpPagination({
      activeTab,
      filteredInstalled,
      filteredMarketplace,
      filteredCustom,
      currentPage,
    });

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, activeCategory, searchQuery]);

  useEffect(() => {
    setCurrentPage(page => Math.min(page, totalPages));
  }, [totalPages]);

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
    const serverId = pendingDelete.id;
    setIsDeleting(true);
    setDeletingServerId(serverId);
    setPendingDelete(null);
    setActionError('');
    try {
      const result = await mcpService.deleteServer(serverId);
      if (!result.success) {
        setActionError(result.error || i18nService.t('mcpDeleteFailed'));
        return;
      }
      if (result.servers) {
        dispatch(setMcpServers(result.servers));
      }
    } finally {
      setIsDeleting(false);
      setDeletingServerId(null);
    }
  };

  const handleOpenEditForm = (server: McpServerConfig) => {
    setEditingServer(server);
    setInstallingRegistry(getRegistryEntryForServer(server) ?? null);
    setIsFormOpen(true);
  };

  const handleInstallFromRegistry = (entry: McpRegistryEntry) => {
    if (entry.authType === 'oauth' || entry.authType === 'cli' || entry.authType === 'external') {
      beginOfficialConnect(entry);
      return;
    }
    if (
      entry.authType === 'token' &&
      (entry.id === GITHUB_MCP_REGISTRY_ID || entry.id === BAIDU_NETDISK_MCP_REGISTRY_ID)
    ) {
      beginTokenConnect(entry);
      return;
    }
    setEditingServer(null);
    setInstallingRegistry(entry);
    setIsFormOpen(true);
  };

  const handleUseMcp = async (server: McpServerConfig) => {
    const registryEntry = getRegistryEntryForServer(server);
    // Feishu is an official CLI + Skills integration, not a stdio MCP
    // transport. Its row is only used to represent installation state.
    if (!server.enabled && registryEntry?.authType !== 'cli') {
      try {
        const updatedServers = await mcpService.setServerEnabled(server.id, true);
        dispatch(setMcpServers(updatedServers));
      } catch (error) {
        setActionError(error instanceof Error ? error.message : i18nService.t('mcpUpdateFailed'));
        return;
      }
    }
    onUseMcp?.(getUsageExample(registryEntry));
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

  const handleImportConfig = async () => {
    setActionError('');
    const result = await mcpService.importConfig();
    if (!result.success) {
      setActionError(result.error || i18nService.t('mcpImportFailed'));
      return;
    }
    if (result.servers) dispatch(setMcpServers(result.servers));
  };

  const handleExportConfig = async () => {
    setActionError('');
    const result = await mcpService.exportConfig();
    if (!result.success) setActionError(result.error || i18nService.t('mcpExportFailed'));
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
      // Fallback: auto-clear overlay after 40s to prevent permanent lock
      if (syncTimeout) clearTimeout(syncTimeout);
      syncTimeout = setTimeout(() => {
        setBridgeSyncing(false);
      }, 40_000);
    });
    const cleanupDone = mcpService.onBridgeSyncDone(() => {
      if (syncTimeout) {
        clearTimeout(syncTimeout);
        syncTimeout = null;
      }
      setBridgeSyncing(false);
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
        <div className="pointer-events-none absolute top-2 right-2 z-10 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted-foreground shadow-sm">
          <LoaderCircle className="size-3.5 animate-spin" />
          <span>{i18nService.t('mcpBridgeSyncing') || 'Syncing MCP tools...'}</span>
        </div>
      )}

      {actionError && <ErrorMessage message={actionError} onClose={() => setActionError('')} />}

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <McpManagerToolbar
          activeTab={activeTab}
          installedCount={servers.length}
          marketplaceCount={marketplaceCount}
          customCount={customCount}
          searchQuery={searchQuery}
          showTabs={!hideTabControl}
          onTabChange={setActiveTab}
          onSearchQueryChange={setSearchQuery}
        />

        {activeTab === McpTabValue.Marketplace && (
          <FluidTabs
            aria-label={i18nService.t('mcpMarketplace')}
            className="max-w-full overflow-x-auto"
            items={dynamicCategories.map(cat => ({
              value: cat.id,
              label:
                (i18nService.getLanguage() === 'zh' ? cat.name_zh : cat.name_en) ||
                i18nService.t(cat.key),
            }))}
            value={activeCategory}
            onValueChange={setActiveCategory}
          />
        )}

        <div className="min-h-0 flex-1 overflow-y-auto pr-2">
          {/* ── Tab: Installed ──────────────────────────────── */}
          {activeTab === McpTabValue.Installed && (
            <McpInstalledTab
              filteredInstalled={filteredInstalled}
              paginatedInstalled={paginatedInstalled}
              deletingServerId={deletingServerId}
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              getIconForServer={getIconForServer}
              getInstalledDescription={getInstalledDescription}
              getRegistryEntryForServer={getRegistryEntryForServer}
              onUseMcp={handleUseMcp}
              onRequestDelete={handleRequestDelete}
              onOpenMarketplace={() => setActiveTab(McpTabValue.Marketplace)}
            />
          )}

          {/* ── Tab: Marketplace ────────────────────────────── */}
          {activeTab === McpTabValue.Marketplace && (
            <McpMarketplaceTab
              filteredMarketplace={filteredMarketplace}
              paginatedMarketplace={paginatedMarketplace}
              installedRegistryIds={installedRegistryIds}
              installingRegistryId={installingRegistryId}
              pendingOfficialAuthorizationRegistryId={pendingOfficialAuthorizationRegistryId}
              officialIcons={officialIcons}
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              getRegistryEntryDescription={getRegistryEntryDescription}
              onInstallFromRegistry={handleInstallFromRegistry}
              onCancelOfficialAuthorization={handleCancelOfficialAuthorization}
            />
          )}

          {/* ── Tab: Custom ─────────────────────────────────── */}
          {activeTab === McpTabValue.Custom && (
            <McpCustomTab
              filteredCustom={filteredCustom}
              paginatedCustom={paginatedCustom}
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              onOpenCreateForm={handleOpenCreateForm}
              onOpenEditForm={handleOpenEditForm}
              onRequestDelete={handleRequestDelete}
              onToggleEnabled={handleToggleEnabled}
              onImportConfig={handleImportConfig}
              onExportConfig={handleExportConfig}
            />
          )}
        </div>
      </div>

      {pendingDelete && (
        <DestructiveConfirmDialog
          open
          title={i18nService.t('deleteMcpServer')}
          description={i18nService.t('mcpDeleteConfirm').replace('{name}', pendingDelete.name)}
          cancelLabel={i18nService.t('cancel')}
          confirmLabel={i18nService.t('confirmDelete')}
          isConfirming={isDeleting}
          onCancel={handleCancelDelete}
          onConfirm={handleConfirmDelete}
        />
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
      <McpOfficialConnectDialog
        entry={officialConnectEntry}
        iconSrc={officialConnectEntry ? officialIcons[officialConnectEntry.id] : undefined}
        isConnecting={isOfficialConnecting}
        isFeishuCliReady={isFeishuCliReady}
        isPreparing={isPreparingFeishuCli}
        error={actionError}
        onClose={handleCloseOfficialConnect}
        onConnect={handleOfficialConnect}
        onPrepare={handlePrepareFeishuCli}
      />
      <McpTokenConnectDialog
        entry={tokenConnectEntry}
        isSaving={isTokenConnecting}
        error={tokenConnectError}
        onClose={handleCloseTokenConnect}
        onSave={handleSaveToken}
      />
    </div>
  );
};

export default McpManager;

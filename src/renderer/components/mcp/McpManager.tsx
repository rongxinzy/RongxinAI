import { Button } from '@shared/components/ui/button';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import { Switch } from '@shared/components/ui/switch';
import { Cable, LoaderCircle, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { mcpCategories, mcpRegistry } from '../../data/mcpRegistry';
import gitlabIcon from '../../assets/mcp-icons/gitlab.png';
import tavilyIcon from '../../assets/mcp-icons/tavily.png';
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
import ErrorMessage from '../ErrorMessage';
import { ListPagination } from '../common/ListPagination';
import {
  McpTab as McpTabValue,
  MCP_PAGE_SIZE,
  type McpRegistryId,
  type McpTab as McpTabType,
} from './constants';
import { McpManagerToolbar } from './McpManagerToolbar';
import { filterMcpItems, useMcpSearchQuery } from './mcpSearch';
import { McpOfficialConnectDialog } from './McpOfficialConnectDialog';
import { McpTokenConnectDialog } from './McpTokenConnectDialog';
import McpServerFormModal from './McpServerFormModal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';

export { McpTab } from './constants';

const TRANSPORT_BADGE_CLASS_NAME = 'bg-muted text-muted-foreground';

const MCP_ICON_BY_ID: Record<string, string> = {
  tavily: tavilyIcon,
  gitlab: gitlabIcon,
};
const FEISHU_MCP_REGISTRY_ID = 'feishu';
const GITHUB_MCP_REGISTRY_ID = 'github';
const BAIDU_NETDISK_MCP_REGISTRY_ID = 'baidu-netdisk';
const OFFICIAL_MCP_CONNECT_TIMEOUT_MS = 60_000;
const OFFICIAL_MCP_DIALOG_CLOSE_DELAY_MS = 2_500;

const McpIcon: React.FC<{
  iconSrc?: string;
  fallbackLabel?: string;
  fallbackIcon?: React.ComponentType<{ className?: string }>;
  fallbackIconClassName?: string;
  imageClassName?: string;
}> = ({
  iconSrc,
  fallbackLabel,
  fallbackIcon: FallbackIcon = Cable,
  fallbackIconClassName = 'size-5 text-muted-foreground',
  imageClassName = 'size-9',
}) => (
  <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
    {iconSrc ? (
      <img src={iconSrc} alt="" className={`${imageClassName} object-contain`} />
    ) : fallbackLabel ? (
      <span className="text-lg font-semibold text-foreground">
        {fallbackLabel.trim().charAt(0).toUpperCase()}
      </span>
    ) : (
      <FallbackIcon className={fallbackIconClassName} />
    )}
  </div>
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
  const [dynamicRegistry, setDynamicRegistry] = useState<McpRegistryEntry[]>(mcpRegistry);
  const [officialConnectEntry, setOfficialConnectEntry] = useState<McpRegistryEntry | null>(null);
  const [isOfficialConnecting, setIsOfficialConnecting] = useState(false);
  const [installingRegistryId, setInstallingRegistryId] = useState<string | null>(null);
  const [pendingOfficialAuthorizationRegistryId, setPendingOfficialAuthorizationRegistryId] =
    useState<string | null>(null);
  const [tokenConnectEntry, setTokenConnectEntry] = useState<McpRegistryEntry | null>(null);
  const [isTokenConnecting, setIsTokenConnecting] = useState(false);
  const [tokenConnectError, setTokenConnectError] = useState('');
  const [isPreparingFeishuCli, setIsPreparingFeishuCli] = useState(false);
  const [isFeishuCliReady, setIsFeishuCliReady] = useState(false);
  const officialConnectAttemptRef = useRef(0);
  const officialAuthorizationRequestRef = useRef<string | null>(null);
  const [officialIcons, setOfficialIcons] = useState<Record<string, string>>({});
  const [dynamicCategories, setDynamicCategories] =
    useState<ReadonlyArray<{ id: string; key: string; name_zh?: string; name_en?: string }>>(
      mcpCategories,
    );
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

  useEffect(() => {
    let isActive = true;
    const loadIcons = async () => {
      const entries = await Promise.all(
        dynamicRegistry
          .filter(entry => entry.iconPath)
          .map(async entry => ({ id: entry.id, icon: await mcpService.loadIcon(entry.iconPath!) })),
      );
      if (!isActive) return;
      setOfficialIcons(
        Object.fromEntries(entries.flatMap(entry => (entry.icon ? [[entry.id, entry.icon]] : []))),
      );
    };
    loadIcons();
    return () => {
      isActive = false;
    };
  }, [dynamicRegistry]);

  useEffect(() => {
    if (officialConnectEntry?.id !== FEISHU_MCP_REGISTRY_ID) return;
    let isActive = true;
    void mcpService
      .getFeishuCliStatus()
      .then(({ installed }) => {
        if (isActive) setIsFeishuCliReady(installed);
      })
      .catch(error => {
        if (isActive)
          setActionError(error instanceof Error ? error.message : i18nService.t('mcpCreateFailed'));
      });
    return () => {
      isActive = false;
    };
  }, [officialConnectEntry]);

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

  const customPageItemCount = filteredCustom.length > 0 ? filteredCustom.length + 1 : 0;
  const activeItemCount =
    activeTab === McpTabValue.Installed
      ? filteredInstalled.length
      : activeTab === McpTabValue.Marketplace
        ? filteredMarketplace.length
        : customPageItemCount;
  const totalPages = Math.max(1, Math.ceil(activeItemCount / MCP_PAGE_SIZE));
  const pageStart = (currentPage - 1) * MCP_PAGE_SIZE;
  const paginatedInstalled = filteredInstalled.slice(pageStart, pageStart + MCP_PAGE_SIZE);
  const paginatedMarketplace = filteredMarketplace.slice(pageStart, pageStart + MCP_PAGE_SIZE);
  const customPageStart = currentPage === 1 ? 0 : pageStart - 1;
  const paginatedCustom = filteredCustom.slice(
    customPageStart,
    customPageStart + (currentPage === 1 ? MCP_PAGE_SIZE - 1 : MCP_PAGE_SIZE),
  );

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
      setActionError('');
      setIsFeishuCliReady(false);
      setOfficialConnectEntry(entry);
      return;
    }
    if (
      entry.authType === 'token' &&
      (entry.id === GITHUB_MCP_REGISTRY_ID || entry.id === BAIDU_NETDISK_MCP_REGISTRY_ID)
    ) {
      setTokenConnectError('');
      setTokenConnectEntry(entry);
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

  const handleOfficialConnect = async () => {
    if (!officialConnectEntry || isOfficialConnecting) return;
    const entry = officialConnectEntry;
    const attempt = ++officialConnectAttemptRef.current;
    const requestId = crypto.randomUUID();
    officialAuthorizationRequestRef.current = requestId;
    setIsOfficialConnecting(true);
    setInstallingRegistryId(entry.id);
    setPendingOfficialAuthorizationRegistryId(entry.id);
    setActionError('');
    let result: { success: boolean; servers?: McpServerConfig[]; error?: string };
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const dialogCloseTimer = window.setTimeout(() => {
      if (attempt !== officialConnectAttemptRef.current) return;
      setIsOfficialConnecting(false);
      setOfficialConnectEntry(null);
    }, OFFICIAL_MCP_DIALOG_CLOSE_DELAY_MS);
    try {
      try {
        result = await Promise.race([
          mcpService.authorize(
            {
              name: entry.name,
              description: getRegistryEntryDescription(entry),
              transportType: entry.transportType,
              command: entry.command,
              args: entry.defaultArgs,
              url: entry.url,
              headers: entry.headers,
              isBuiltIn: true,
              registryId: entry.id,
            },
            requestId,
          ),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              void mcpService.cancelAuthorize(requestId);
              reject(new Error(i18nService.t('mcpConnectTimedOut')));
            }, OFFICIAL_MCP_CONNECT_TIMEOUT_MS);
          }),
        ]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
      if (!result.success) {
        if (attempt !== officialConnectAttemptRef.current) return;
        officialAuthorizationRequestRef.current = null;
        setIsOfficialConnecting(false);
        setInstallingRegistryId(null);
        setPendingOfficialAuthorizationRegistryId(null);
        setActionError(result.error || i18nService.t('mcpCreateFailed'));
        return;
      }
      if (result.servers) dispatch(setMcpServers(result.servers));
      if (attempt !== officialConnectAttemptRef.current) return;
      officialAuthorizationRequestRef.current = null;
      setIsOfficialConnecting(false);
      setInstallingRegistryId(null);
      setPendingOfficialAuthorizationRegistryId(null);
      setOfficialConnectEntry(null);
    } catch (error) {
      if (attempt === officialConnectAttemptRef.current) {
        officialAuthorizationRequestRef.current = null;
        setIsOfficialConnecting(false);
        setInstallingRegistryId(null);
        setPendingOfficialAuthorizationRegistryId(null);
        setActionError(error instanceof Error ? error.message : i18nService.t('mcpCreateFailed'));
      }
    } finally {
      window.clearTimeout(dialogCloseTimer);
    }
  };

  const handlePrepareFeishuCli = async () => {
    if (isPreparingFeishuCli) return;
    setIsPreparingFeishuCli(true);
    setActionError('');
    try {
      await mcpService.prepareFeishuCli();
      setIsFeishuCliReady(true);
    } catch (error) {
      console.error('[MCP] Feishu connector installation failed:', error);
      const detail = error instanceof Error ? error.message : '';
      setActionError(
        detail
          ? `${i18nService.t('mcpFeishuInstallFailed')} ${detail}`
          : i18nService.t('mcpFeishuInstallFailed'),
      );
    } finally {
      setIsPreparingFeishuCli(false);
    }
  };

  const handleSaveToken = async (token: string) => {
    if (!tokenConnectEntry || isTokenConnecting) return;
    const entry = tokenConnectEntry;
    setIsTokenConnecting(true);
    setInstallingRegistryId(entry.id);
    setTokenConnectEntry(null);
    setTokenConnectError('');
    const data: McpServerFormData = {
      name: entry.name,
      description: getRegistryEntryDescription(entry),
      transportType: entry.transportType,
      url: entry.url,
      headers: { Authorization: `Bearer ${token}` },
      isBuiltIn: true,
      registryId: entry.id,
    };
    try {
      const probe = await mcpService.testConnection(data);
      if (!probe.success) {
        const error = probe.error || i18nService.t('mcpCreateFailed');
        setTokenConnectError(error);
        setActionError(error);
        return;
      }
      const result = await mcpService.createServer(data);
      if (!result.success || !result.servers) {
        const error = result.error || i18nService.t('mcpCreateFailed');
        setTokenConnectError(error);
        setActionError(error);
        return;
      }
      const servers = result.servers;
      dispatch(setMcpServers(servers));
    } catch (error) {
      setTokenConnectError(
        error instanceof Error ? error.message : i18nService.t('mcpCreateFailed'),
      );
      setActionError(error instanceof Error ? error.message : i18nService.t('mcpCreateFailed'));
    } finally {
      setIsTokenConnecting(false);
      setInstallingRegistryId(null);
    }
  };

  const handleCloseOfficialConnect = () => {
    if (isOfficialConnecting && officialAuthorizationRequestRef.current) {
      handleCancelOfficialAuthorization();
      return;
    }
    setIsOfficialConnecting(false);
    setIsPreparingFeishuCli(false);
    setIsFeishuCliReady(false);
    setOfficialConnectEntry(null);
  };

  const handleCancelOfficialAuthorization = () => {
    const requestId = officialAuthorizationRequestRef.current;
    if (!requestId) return;

    officialConnectAttemptRef.current += 1;
    officialAuthorizationRequestRef.current = null;
    setIsOfficialConnecting(false);
    setInstallingRegistryId(null);
    setPendingOfficialAuthorizationRegistryId(null);
    setOfficialConnectEntry(null);
    void mcpService.cancelAuthorize(requestId);
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
            <div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {filteredInstalled.length === 0 ? (
                  <div className="col-span-full flex min-h-60 flex-col items-center justify-center gap-3 p-6 text-center">
                    <Cable className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {i18nService.t('mcpNoInstalledServers')}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setActiveTab(McpTabValue.Marketplace)}
                    >
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
                          imageClassName={
                            registryEntry?.id === 'supabase'
                              ? 'size-full'
                              : registryEntry?.id === 'feishu' || registryEntry?.id === 'jinshuju'
                                ? 'size-11'
                                : undefined
                          }
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
                              onClick={() => handleUseMcp(server)}
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
                                  onClick={() => handleRequestDelete(server)}
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
              <ListPagination
                page={currentPage}
                totalPages={totalPages}
                className="py-4"
                onPageChange={setCurrentPage}
              />
            </div>
          )}

          {/* ── Tab: Marketplace ────────────────────────────── */}
          {activeTab === McpTabValue.Marketplace && (
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
                        imageClassName={
                          entry.id === 'supabase'
                            ? 'size-full'
                            : entry.id === 'feishu' || entry.id === 'jinshuju'
                              ? 'size-11'
                              : undefined
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {entry.name}
                          </span>
                        </div>
                        <ClampedText
                          text={getRegistryEntryDescription(entry)}
                          className="mt-1 line-clamp-1 text-xs text-muted-foreground"
                        />
                        {entry.requiredEnvKeys && entry.requiredEnvKeys.length > 0 && (
                          <span className="mt-1 block text-xs text-amber-500 dark:text-amber-400">
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
                              <span className="shrink-0 text-amber-500 dark:text-amber-400">
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
                              onClick={handleCancelOfficialAuthorization}
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
                            onClick={() => handleInstallFromRegistry(entry)}
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
              <ListPagination
                page={currentPage}
                totalPages={totalPages}
                className="py-4"
                onPageChange={setCurrentPage}
              />
            </div>
          )}

          {/* ── Tab: Custom ─────────────────────────────────── */}
          {activeTab === McpTabValue.Custom && (
            <div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {filteredCustom.length === 0 ? (
                  <div className="col-span-full flex min-h-60 flex-col items-center justify-center gap-3 p-6 text-center">
                    <Cable className="size-8 text-muted-foreground" />
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
                      className="theme-page-mcp-manager-button-3"
                    >
                      <Plus data-icon="inline-start" />
                      {i18nService.t('addMcpServer')}
                    </Button>
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
                              onClick={() => handleOpenEditForm(server)}
                              className="theme-page-mcp-manager-button-4"
                              title={i18nService.t('editMcpServer')}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRequestDelete(server)}
                              className="theme-page-mcp-manager-button-5"
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
                onPageChange={setCurrentPage}
              />
            </div>
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
        onClose={() => !isTokenConnecting && setTokenConnectEntry(null)}
        onSave={handleSaveToken}
      />
    </div>
  );
};

export default McpManager;
